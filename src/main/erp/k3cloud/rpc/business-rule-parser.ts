/**
 * Pure-TS list_business_rules — parses an extension's FKERNELXML and emits
 * the same shape the bridge-backed ListBusinessRules used to return.
 *
 * Why TS instead of bridge: bridge.ListBusinessRules deserializes the XML via
 * BOS's DcxmlSerializer, which interprets `<HeadEntity action="edit"
 * oid="...">` as a **delta marker**. With no baseline metadata loaded
 * (bridge runs offline, no live K/3 connection), the deserializer silently
 * drops the overlay element — so entity-level EntityServiceRule blocks we
 * just wrote via the SaveForIDEV9 wire shape are invisible on read-back.
 * Capture / DB inspection (2026-05-05 demo scenario 3) confirmed both rules
 * sat in T_META_OBJECTTYPE.FKERNELXML but bridge returned empty entityRules.
 *
 * Wire forms this parser handles (all observed in real captures or our own
 * SaveForIDEV9 emissions):
 *
 *   1. **Entity-level rule** — overlay shape inside `<HeadEntity action="edit">`:
 *
 *        <HeadEntity action="edit" oid="..." ElementType="34" ElementStyle="0">
 *          <EntityServiceRules>
 *            <EntityServiceRule>
 *              <Id>3f126961-...</Id>
 *              <Description>...</Description>
 *              <PreCondition>...</PreCondition>
 *              <PreConditionDesc>...</PreConditionDesc>
 *              <Seq>1</Seq>
 *              <WhenTrueBusinessServices>
 *                <GetInvStockBusinessServiceMeta>
 *                  <ActionId>67</ActionId>
 *                  <Id>9bcc...</Id>
 *                </GetInvStockBusinessServiceMeta>
 *              </WhenTrueBusinessServices>
 *            </EntityServiceRule>
 *          </EntityServiceRules>
 *        </HeadEntity>
 *
 *   2. **Field-level UpdateAction (inline)** — extension self-defined field
 *      with UpdateActions emitted inside the field block (capture req-120,
 *      `inlineFieldUpdateActionInExt` for extension fields):
 *
 *        <DecimalField ElementType="2" ElementStyle="0">
 *          <FireUpdateEvent>1</FireUpdateEvent>
 *          <PropertyName>F_TestQty</PropertyName>
 *          <FieldName>F_TESTQTY</FieldName>
 *          <UpdateActions>
 *            <FormBusinessService>
 *              <Parameters>[" F_X = F_Y * 2 "]</Parameters>
 *              <ActionId>2</ActionId>
 *              <Id>...</Id>
 *            </FormBusinessService>
 *          </UpdateActions>
 *          <Key>F_TestQty</Key>
 *        </DecimalField>
 *
 *   3. **Field-level UpdateAction (overlay)** — parent original field with
 *      `<XField action="edit" oid="...">` overlay (`buildFieldUpdateActionOverlay`
 *      for parent fields). Same structure as (2) but the wrapper carries
 *      `action="edit"` and the field's `<Key>` lives in the parent XML, not
 *      this overlay; we emit `fieldKey: ''` for these and let the caller
 *      enrich with parent metadata if needed.
 */

import { iterateTagTokens, findLastTopLevelChildText } from '../fkernel-parsers';

export interface EntityRuleSummary {
  ruleId: string;
  entityKey: string;
  preCondition: string;
  preConditionDesc?: string;
  description?: string;
  seq?: number;
  services: Array<{
    branch: string;
    actionId: number;
    className: string;
    serviceId: string;
  }>;
}

export interface FieldUpdateActionSummary {
  fieldKey: string;
  actionId: number;
  className: string;
  serviceId: string;
  parameters?: string;
}

export interface ListBusinessRulesResult {
  entityRules: EntityRuleSummary[];
  fieldUpdateActions: FieldUpdateActionSummary[];
}

/**
 * Walk an extension's FKERNELXML and return both entity-level rules and
 * field-level UpdateActions. Pure string operation — no I/O, no reflection.
 */
export function parseBusinessRules(extKernelXml: string): ListBusinessRulesResult {
  const entityRules = collectEntityRules(extKernelXml);
  const fieldUpdateActions = collectFieldUpdateActions(extKernelXml);
  return { entityRules, fieldUpdateActions };
}

/**
 * Walk the XML, find every `<XEntity ...>` block whose body contains
 * `<EntityServiceRules>`, and emit one summary per `<EntityServiceRule>`.
 * Matches the entity tag by suffix (`Entity` or `HeadEntity`) so HeadEntity /
 * EntryEntity / SubEntryEntity all surface; entity-level rules attach to the
 * entity that owns them (BOS Designer typically lands them on HeadEntity).
 */
function collectEntityRules(xml: string): EntityRuleSummary[] {
  const out: EntityRuleSummary[] = [];
  const stack: Array<{ tag: string; bodyStart: number } | null> = [];

  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      const isEntity = tk.tag === 'HeadEntity' || /Entity$/.test(tk.tag);
      stack.push(isEntity ? { tag: tk.tag, bodyStart: tk.end } : null);
      continue;
    }
    const frame = stack.pop();
    if (!frame) continue;
    const body = xml.substring(frame.bodyStart, tk.start);
    // Resolve elemKey from the entity's <Key> child (post-init shape) — may
    // be absent on overlay-only HeadEntity blocks; fall back to tag name.
    const elemKey = findLastTopLevelChildText(body, 'Key') ?? frame.tag;
    const rulesBody = extractTopLevelChildBody(body, 'EntityServiceRules');
    if (rulesBody === undefined) continue;
    for (const ruleBody of iterateChildBodies(rulesBody, 'EntityServiceRule')) {
      const ruleId = findLastTopLevelChildText(ruleBody, 'Id') ?? '';
      const preCondition = findLastTopLevelChildText(ruleBody, 'PreCondition') ?? '';
      const preConditionDesc = findLastTopLevelChildText(ruleBody, 'PreConditionDesc');
      const description = findLastTopLevelChildText(ruleBody, 'Description');
      const seqText = findLastTopLevelChildText(ruleBody, 'Seq');
      const seq = seqText !== undefined ? Number.parseInt(seqText, 10) : undefined;

      const services: EntityRuleSummary['services'] = [];
      for (const branch of ['WhenTrueBusinessServices', 'WhenFalseBusinessServices'] as const) {
        const branchBody = extractTopLevelChildBody(ruleBody, branch);
        if (branchBody === undefined) continue;
        for (const svc of iterateServiceChildren(branchBody)) {
          services.push({ ...svc, branch });
        }
      }
      out.push({
        ruleId,
        entityKey: elemKey,
        preCondition,
        preConditionDesc,
        description,
        seq: Number.isFinite(seq) ? seq : undefined,
        services,
      });
    }
  }
  return out;
}

/**
 * Walk every `<XField ...>` block and emit one summary per
 * `<FormBusinessService>` (or other action class) found inside its
 * `<UpdateActions>`. Inline (extension's own field) and overlay (parent
 * field with `action="edit"`) shapes both surface here — wrapper attribute
 * doesn't change the inner structure.
 */
function collectFieldUpdateActions(xml: string): FieldUpdateActionSummary[] {
  const out: FieldUpdateActionSummary[] = [];
  const stack: Array<{ tag: string; bodyStart: number } | null> = [];

  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      const isField = /Field$/.test(tk.tag);
      stack.push(isField ? { tag: tk.tag, bodyStart: tk.end } : null);
      continue;
    }
    const frame = stack.pop();
    if (!frame) continue;
    const body = xml.substring(frame.bodyStart, tk.start);
    const fieldKey = findLastTopLevelChildText(body, 'Key') ?? '';
    const actionsBody = extractTopLevelChildBody(body, 'UpdateActions');
    if (actionsBody === undefined) continue;
    for (const svc of iterateServiceChildren(actionsBody)) {
      const params = findLastTopLevelChildText(actionsBody, 'Parameters'); // legacy fallback
      out.push({
        fieldKey,
        actionId: svc.actionId,
        className: svc.className,
        serviceId: svc.serviceId,
        parameters: svc.parameters ?? params,
      });
    }
  }
  return out;
}

/**
 * Top-level children of a body that look like service classes
 * (`FormBusinessService`, `GetInvStockBusinessServiceMeta`, etc.). Each
 * carries `<ActionId>`, `<Id>`, optional `<Parameters>`.
 */
function* iterateServiceChildren(body: string): Generator<{
  className: string;
  actionId: number;
  serviceId: string;
  parameters?: string;
}> {
  for (const child of iterateTopLevelChildren(body)) {
    const actionIdText = findLastTopLevelChildText(child.body, 'ActionId');
    const actionId = actionIdText !== undefined ? Number.parseInt(actionIdText, 10) : NaN;
    if (!Number.isFinite(actionId)) continue;
    const serviceId = findLastTopLevelChildText(child.body, 'Id') ?? '';
    const parameters = findLastTopLevelChildText(child.body, 'Parameters');
    yield { className: child.tag, actionId, serviceId, parameters };
  }
}

/**
 * Extract the inner text of the LAST top-level child element with the given
 * tag name. Returns undefined when no such child exists. Mirrors
 * `findLastTopLevelChildText` semantics but returns the body span unaltered
 * (no trim) — caller decides whether to trim.
 */
function extractTopLevelChildBody(body: string, tagName: string): string | undefined {
  let depth = 0;
  let lastStart = -1;
  let lastEnd = -1;
  for (const tk of iterateTagTokens(body)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      if (depth === 0 && tk.tag === tagName) lastStart = tk.end;
      depth++;
    } else {
      depth--;
      if (depth === 0 && tk.tag === tagName && lastStart >= 0) lastEnd = tk.start;
    }
  }
  if (lastStart >= 0 && lastEnd >= lastStart) {
    return body.substring(lastStart, lastEnd);
  }
  return undefined;
}

/**
 * Iterate all top-level elements with the given tag name in `body`. Yields
 * one body string per occurrence (suitable for nested traversal).
 */
function* iterateChildBodies(body: string, tagName: string): Generator<string> {
  let depth = 0;
  let openStart = -1;
  for (const tk of iterateTagTokens(body)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      if (depth === 0 && tk.tag === tagName) openStart = tk.end;
      depth++;
    } else {
      depth--;
      if (depth === 0 && tk.tag === tagName && openStart >= 0) {
        yield body.substring(openStart, tk.start);
        openStart = -1;
      }
    }
  }
}

/**
 * Yield each top-level child element with its tag name and inner body.
 * Used by `iterateServiceChildren` because service class names vary by
 * ActionId (no fixed tag set to filter on).
 */
function* iterateTopLevelChildren(body: string): Generator<{ tag: string; body: string }> {
  let depth = 0;
  let frame: { tag: string; bodyStart: number } | null = null;
  for (const tk of iterateTagTokens(body)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      if (depth === 0) frame = { tag: tk.tag, bodyStart: tk.end };
      depth++;
    } else {
      depth--;
      if (depth === 0 && frame !== null && frame.tag === tk.tag) {
        yield { tag: frame.tag, body: body.substring(frame.bodyStart, tk.start) };
        frame = null;
      }
    }
  }
}
