import { iterateTagTokens, findLastTopLevelChildText } from '../fkernel-parsers';

/**
 * Business-rule HeadEntity overlay templates for SaveForIDEV9.
 *
 * Path A (TS string-template overlay) — the v0.1 solution validated by
 * `.scratch/probes/spike-bizrule-writeback.ts` for Plan 5.12.3b Task 3.1.
 *
 * Why string templates instead of bridge-emitted DCXML:
 *   - A real BOS extension's FKERNELXML is a tiny stub `<Form action="edit"
 *     oid="BOS_BillModel">` (~361 chars), with empty BusinessInfo. The
 *     HeadEntity that owns EntityServiceRules / Field UpdateActions lives
 *     in the **parent** object (e.g. SAL_SaleOrder). Bridge ops that try
 *     to walk the extension's BusinessInfo throw "no HeadEntity found" on
 *     real-shape inputs — they're tuned for fixture XML.
 *   - The wire BOS Designer ships on Save is a minimal HeadEntity overlay
 *     keyed on the parent's HeadEntity oid plus an `action="edit"`
 *     attribute. Server merges this delta into the persisted FKERNELXML.
 *     Spike confirmed:
 *       * Server accepts the overlay
 *       * Round-trip read returns the rule with server-assigned defaults
 *       * `<EntityServiceRule action="remove" oid="..."/>` deletes by id
 *
 * Architecture debt: hard-coding BOS wire shape in TS means BOS major
 * upgrades that tighten format requirements will surface here first. v0.2
 * may revisit by porting the BOS DCXML emitter or by capturing baselines
 * per BOS version. Live with it for v0.1.
 *
 * Field-level UpdateAction overlay (`<Field action="edit" oid="...">
 * <UpdateActions>...`) is **not** in this module yet — Plan 5.12.3b
 * Task 3.5 owns spiking and adding it.
 */

/**
 * One business service inside an EntityServiceRule's
 * `<WhenTrueBusinessServices>` collection.
 *
 * `className` is the BOS internal element name — verified shapes:
 *   - `FormBusinessService`            (base class — entity-level Calculate, ActionId=2)
 *   - `GetInvStockBusinessServiceMeta` (subclass — GetInvStock, ActionId=67)
 *
 * `properties` is a flat name → value map serialized as `<Name>value</Name>`
 * children. Values are XML-escaped before emission. Subclass-specific
 * properties (e.g. `<StockQtyField>` for GetInvStock) go here.
 */
export interface EntityServiceRuleService {
  className: string;
  actionId: number;
  /** 32-hex-char service id (caller-generated GUID, lowercased without dashes). */
  id: string;
  description?: string;
  properties?: Record<string, unknown>;
}

export interface EntityServiceRuleArgs {
  /** Caller-generated rule GUID (dashed form recommended; both accepted). */
  ruleId: string;
  description: string;
  /** IronPython expression. `'True'` is the "always fire" sentinel. */
  preCondition: string;
  /** Optional human description; server fills with setnull when omitted. */
  preConditionDesc?: string;
  /**
   * Sequence index. Defaults to 1 when omitted — BOS Designer ships 1 for
   * a single-rule extension and re-numbers on save.
   */
  seq?: number;
  services: EntityServiceRuleService[];
}

/**
 * XML-escape a string value bound for an element body or attribute. Order
 * matters — `&` must be first or it would double-escape the entities we
 * emit on the next pass.
 */
function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Escape only the structurally significant XML characters (`&`, `<`, `>`)
 * for use inside element TEXT content. Used by the field-level
 * UpdateAction overlay's `<Parameters>` and `<Description>` bodies — recon
 * req-120 (2026-05-04) shows BOS preserves raw `"` inside element text
 * (the JSON-encoded array's quotes ship unescaped). Attributes still need
 * `xmlEscape` because `"` is the attribute delimiter.
 */
function xmlEscapeText(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * BOS XML element names are restricted to the C-identifier shape (the
 * .NET DCXML serializer reflects against type/property names). LLM-fed
 * `properties` keys are interpolated as element tags (`<Foo>val</Foo>`),
 * so we validate at the boundary — escaping doesn't help on tag names.
 */
const ELEMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertElementName(name: string, context: string): void {
  if (!ELEMENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `${context}: '${name}' is not a valid BOS element name (expected C-identifier shape /^[A-Za-z_][A-Za-z0-9_]*$/)`,
    );
  }
}

/**
 * Build the `<HeadEntity action="edit" oid="...">` overlay that adds one
 * EntityServiceRule (with N services in `<WhenTrueBusinessServices>`).
 *
 * Caller injects the result into the extension's FKERNELXML before
 * `</Elements>` via `injectOverlay`.
 */
export function buildAddEntityRuleOverlay(
  parentHeadOid: string,
  rule: EntityServiceRuleArgs,
): string {
  if (!parentHeadOid) throw new Error('buildAddEntityRuleOverlay: parentHeadOid is empty');
  if (!rule.ruleId) throw new Error('buildAddEntityRuleOverlay: rule.ruleId is empty');

  const seq = rule.seq ?? 1;
  const preConditionDescElement = rule.preConditionDesc
    ? `<PreConditionDesc>${xmlEscape(rule.preConditionDesc)}</PreConditionDesc>`
    : '';

  const servicesXml = rule.services
    .map((svc) => {
      assertElementName(svc.className, 'buildAddEntityRuleOverlay: service className');
      // BOS Designer renders the rule editor's service list using <Description>
      // as the row label; missing → blank row (cosmetic). Fall back to the
      // BOS-Designer-default text for known classes, else omit (unknown class
      // shouldn't be in v0.1 anyway — schema covers 2 + 67).
      const description =
        svc.description ?? DEFAULT_SERVICE_DESCRIPTION_BY_CLASSNAME[svc.className];
      const descElement = description
        ? `<Description>${xmlEscape(description)}</Description>`
        : '';
      // Property keys are agent-facing camelCase (per business-rule-schemas.ts
      // contract). BOS server reflection on SimpleProperty expects PascalCase
      // wire elements (`<StockQtyField>` not `<stockQtyField>`); a lowercase
      // tag is silently dropped during deserialization, so the property
      // value never reaches the persisted metadata. Capitalize the first
      // character at the boundary. Empirical: 2026-05-05 demo scenario 3 —
      // F_TestStock supplied as stockQtyField was missing entirely from
      // T_META_OBJECTTYPE.FKERNELXML after Save.
      const propsXml = svc.properties
        ? Object.entries(svc.properties)
            .map(([k, v]) => {
              assertElementName(k, 'buildAddEntityRuleOverlay: service property name');
              const wireKey = k.charAt(0).toUpperCase() + k.slice(1);
              return `<${wireKey}>${xmlEscape(v)}</${wireKey}>`;
            })
            .join('')
        : '';
      return (
        `<${svc.className}>` +
        `<ActionId>${svc.actionId}</ActionId>` +
        descElement +
        `<Id>${xmlEscape(svc.id)}</Id>` +
        propsXml +
        `</${svc.className}>`
      );
    })
    .join('');

  return (
    `<HeadEntity action="edit" oid="${xmlEscape(parentHeadOid)}" ElementType="34" ElementStyle="0">` +
    `<EntityServiceRules>` +
    `<EntityServiceRule>` +
    `<Id>${xmlEscape(rule.ruleId)}</Id>` +
    `<Description>${xmlEscape(rule.description)}</Description>` +
    `<PreCondition>${xmlEscape(rule.preCondition)}</PreCondition>` +
    preConditionDescElement +
    `<Seq>${seq}</Seq>` +
    `<WhenTrueBusinessServices>` +
    servicesXml +
    `</WhenTrueBusinessServices>` +
    `</EntityServiceRule>` +
    `</EntityServiceRules>` +
    `</HeadEntity>`
  );
}

/**
 * Build the remove overlay for an entity-level rule. Server resolves the
 * EntityServiceRule by its oid and detaches it; we don't have to know
 * which HeadEntity it came from beyond the parent oid we're scoping to.
 */
export function buildRemoveEntityRuleOverlay(
  parentHeadOid: string,
  ruleId: string,
): string {
  if (!parentHeadOid) throw new Error('buildRemoveEntityRuleOverlay: parentHeadOid is empty');
  if (!ruleId) throw new Error('buildRemoveEntityRuleOverlay: ruleId is empty');
  return (
    `<HeadEntity action="edit" oid="${xmlEscape(parentHeadOid)}" ElementType="34" ElementStyle="0">` +
    `<EntityServiceRules>` +
    `<EntityServiceRule action="remove" oid="${xmlEscape(ruleId)}" />` +
    `</EntityServiceRules>` +
    `</HeadEntity>`
  );
}

/**
 * Splice an overlay XML fragment into the extension's FKERNELXML, just
 * before the closing `</Elements>` tag. Throws when the marker is absent —
 * a malformed extension XML or a BOS format change that drops `<Elements>`
 * would otherwise silently produce a no-op save.
 */
export function injectOverlay(extKernelXml: string, overlayXml: string): string {
  const marker = '</Elements>';
  if (!extKernelXml.includes(marker)) {
    throw new Error(`injectOverlay: extension XML has no </Elements> marker — cannot inject overlay`);
  }
  return extKernelXml.replace(marker, overlayXml + marker);
}

/**
 * Pull the `oid` attribute from the (single) `<HeadEntity ...>` tag in a
 * parent object's FKERNELXML. Returns null when the parent's XML doesn't
 * declare a HeadEntity (rare — most BillModels do).
 *
 * Caller is expected to feed the **parent** (e.g. SAL_SaleOrder) FKERNELXML
 * here, not the extension's stub. The oid we read is the value the
 * `action="edit"` overlay needs to target.
 */
export function extractHeadEntityOid(parentKernelXml: string): string | null {
  const match = parentKernelXml.match(/<HeadEntity[^>]*\boid="([^"]+)"/);
  return match?.[1] ?? null;
}

// ─── Field-level UpdateAction overlay (Plan 5.12.3b Task 3.5) ──────────
//
// Wire shape (Tier B recon §1, 2026-05-04 capture req-120):
//
//   <IntegerField action="edit" oid="<field-oid>">
//     <UpdateActions>
//       <FormBusinessService>
//         <Parameters>[" F_X = F_Y * 2 "]</Parameters>
//         <ActionId>2</ActionId>
//         <Description>计算定义公式的值并填写到指定列</Description>
//         <RaiseValueChanged>DisableRaise</RaiseValueChanged>
//         <RaiseItemReset>DisableRaise</RaiseItemReset>
//         <RaiseReset>DisableRaise</RaiseReset>
//         <Id>afc25ea1-5732-4803-9f54-516a22fb0b09</Id>
//       </FormBusinessService>
//     </UpdateActions>
//   </IntegerField>
//
// Wrapper element name varies by FieldMeta.type (`IntegerField` /
// `TextField` / `DecimalField` / etc.). The field oid lives in the
// **parent's** FKERNELXML — the extension stub doesn't carry it — so
// `extractFieldOid` walks the parent XML and returns both the oid and the
// wrapper tag name to use.

/**
 * One UpdateAction service inside a field's `<UpdateActions>` collection.
 *
 * v0.1 supports only base `FormBusinessService` (Calculate, ActionId 2);
 * subclass-specific UpdateActions are out-of-scope. `className` is left
 * extensible for v0.2 — when omitted, the wrapper element name is the bare
 * `<FormBusinessService>` (matches the recon shape).
 *
 * `parameters` is JSON-stringified into the wire `<Parameters>` body.
 * BOS preserves whitespace inside the JSON-encoded strings — caller does
 * NOT trim them; the agent's own spacing carries through.
 *
 * `disabledEvents` toggle 8 known BOS Raise events (default = `EnableRaise`,
 * we emit `DisableRaise` for each name in the list). Recon req-120 ships
 * `RaiseValueChanged` / `RaiseItemReset` / `RaiseReset` for a typical
 * Calculate; the others are accepted for parity with BOS Designer's full
 * 8-event toggle set.
 */
export interface FieldUpdateActionService {
  /** Currently always 'FormBusinessService' for v0.1 (Calculate base class).
   *  Omit → bare `<FormBusinessService>` element. */
  className?: string;
  actionId: number;
  /** Caller-generated dashed UUID for the FormBusinessService.Id. */
  id: string;
  description?: string;
  /** IronPython assignment strings — wire-emitted as JSON-stringified array. */
  parameters: string[];
  /** Subset of: 'Initialized', 'ItemAdded', 'ItemRemoved',
   *  'SelectRowChanged', 'SelectRowExtChanged', 'ValueChanged', 'ItemReset',
   *  'Reset'. Each maps to <Raise{Name}>DisableRaise</Raise{Name}>. */
  disabledEvents?: string[];
}

const KNOWN_RAISE_EVENTS = new Set([
  'Initialized',
  'ItemAdded',
  'ItemRemoved',
  'SelectRowChanged',
  'SelectRowExtChanged',
  'ValueChanged',
  'ItemReset',
  'Reset',
]);

const DEFAULT_CALC_DESCRIPTION = '计算定义公式的值并填写到指定列';

/**
 * BOS Designer's rule editor renders the service list using each service's
 * `<Description>` text as the row label — when omitted, the row appears
 * blank (cosmetic only; double-click into edit shows the data is there).
 * recon req-120 captured the BOS-Designer-default text per className; we
 * fall back to it when the tool layer doesn't pass an explicit description.
 */
const DEFAULT_SERVICE_DESCRIPTION_BY_CLASSNAME: Record<string, string> = {
  FormBusinessService: '计算定义公式的值并填写到指定列',
  GetInvStockBusinessServiceMeta: '获取即时库存信息',
};

/**
 * Build a `<{FieldType} action="edit" oid="...">` overlay that adds one
 * Calculate UpdateAction to a field. Caller injects via `injectOverlay`.
 *
 * Validation rejects malformed field type / className / event names so
 * agent-supplied data can't smuggle non-C-identifier strings into the wire
 * tag positions where XML escaping doesn't help.
 */
export function buildFieldUpdateActionOverlay(
  fieldType: string,
  fieldOid: string,
  service: FieldUpdateActionService,
): string {
  if (!fieldType) throw new Error('buildFieldUpdateActionOverlay: fieldType is empty');
  assertElementName(fieldType, 'buildFieldUpdateActionOverlay: fieldType');
  if (!fieldOid) throw new Error('buildFieldUpdateActionOverlay: fieldOid is empty');
  validateService(service, 'buildFieldUpdateActionOverlay');

  return (
    `<${fieldType} action="edit" oid="${xmlEscape(fieldOid)}">` +
    buildUpdateActionsBlock(service) +
    `</${fieldType}>`
  );
}

function validateService(service: FieldUpdateActionService, fnName: string): void {
  if (!service.id) throw new Error(`${fnName}: service.id is empty`);
  if (!Array.isArray(service.parameters) || service.parameters.length < 1) {
    throw new Error(
      `${fnName}: service.parameters must contain at least one IronPython assignment`,
    );
  }
  const className = service.className ?? 'FormBusinessService';
  assertElementName(className, `${fnName}: service className`);
  const disabled = service.disabledEvents ?? [];
  for (const evt of disabled) {
    if (!KNOWN_RAISE_EVENTS.has(evt)) {
      throw new Error(
        `${fnName}: unknown Raise event '${evt}' — known: ${[...KNOWN_RAISE_EVENTS].join(', ')}`,
      );
    }
  }
}

function buildUpdateActionsBlock(service: FieldUpdateActionService): string {
  const className = service.className ?? 'FormBusinessService';
  const disabled = service.disabledEvents ?? [];
  // JSON.stringify first (so quotes / brackets get JSON-encoded), then
  // xml-escape structurally significant chars. Recon req-120 shows BOS
  // preserves raw double-quotes inside element text — we don't escape `"`
  // for <Parameters> body (only attribute values need that).
  const parametersJson = JSON.stringify(service.parameters);
  const description = service.description ?? DEFAULT_CALC_DESCRIPTION;
  const raiseElements = disabled
    .map((evt) => `<Raise${evt}>DisableRaise</Raise${evt}>`)
    .join('');
  return (
    `<UpdateActions>` +
    `<${className}>` +
    `<Parameters>${xmlEscapeText(parametersJson)}</Parameters>` +
    `<ActionId>${service.actionId}</ActionId>` +
    `<Description>${xmlEscapeText(description)}</Description>` +
    raiseElements +
    `<Id>${xmlEscape(service.id)}</Id>` +
    `</${className}>` +
    `</UpdateActions>`
  );
}

/**
 * Inject a Calculate UpdateAction directly into an extension's own field
 * declaration block in its FKERNELXML. Returns the full new FKERNELXML.
 *
 * Why this and not the `<XField action="edit" oid=...>` overlay: extension
 * fields don't exist in the parent's base metadata, so a `action="edit"`
 * delta has no oid to merge into — BOS server fails deserialization with
 * "未能找到 {FieldType} 对应的数据类型". Capture req-120 (2026-05-04 recon)
 * shows BOS Designer's wire format for extension fields: UpdateActions sits
 * **inside** the field's own definition, alongside `<FireUpdateEvent>1</...>`
 * which is the marker that flips the field into "fire UpdateActions on
 * value change" mode. Both are absent from a freshly-emitted extension
 * field, so this function adds them by rewriting the field's body.
 *
 * Idempotence: throws if `<UpdateActions>` is already present in the
 * targeted field block — v0.1 supports one Calculate per field. Append /
 * overwrite is left for v0.2 when we have a real client request shape.
 *
 * Empirical position rules (from req-120 IntegerField sample):
 *   - `<FireUpdateEvent>1</FireUpdateEvent>` immediately before `<PropertyName>`
 *   - `<UpdateActions>` immediately after `</FieldName>`
 */
export function inlineFieldUpdateActionInExt(
  extKernelXml: string,
  fieldType: string,
  fieldOid: string,
  service: FieldUpdateActionService,
): string {
  if (!fieldType) throw new Error('inlineFieldUpdateActionInExt: fieldType is empty');
  assertElementName(fieldType, 'inlineFieldUpdateActionInExt: fieldType');
  if (!fieldOid) throw new Error('inlineFieldUpdateActionInExt: fieldOid is empty');
  validateService(service, 'inlineFieldUpdateActionInExt');

  // Locate the <{fieldType}>...</{fieldType}> block whose top-level <Id>
  // matches fieldOid. Walk with the shared tag tokenizer to handle nested
  // elements correctly (e.g. <DefValue><FunctionDefaultValue>...</...> inside
  // a field body).
  const stack: Array<{ tag: string; tagEnd: number; bodyStart: number } | null> = [];
  let blockStart = -1;
  let blockBodyStart = -1;
  let blockBodyEnd = -1;
  let blockEnd = -1;
  for (const tk of iterateTagTokens(extKernelXml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      const isField = tk.tag === fieldType;
      stack.push(isField ? { tag: tk.tag, tagEnd: tk.end, bodyStart: tk.end } : null);
      continue;
    }
    const frame = stack.pop();
    if (!frame) continue;
    const body = extKernelXml.substring(frame.bodyStart, tk.start);
    const id = findLastTopLevelChildText(body, 'Id');
    if (id !== fieldOid) continue;
    blockStart = frame.tagEnd - extKernelXml.substring(0, frame.tagEnd).match(/<[^>]+>$/)![0].length;
    blockBodyStart = frame.bodyStart;
    blockBodyEnd = tk.start;
    blockEnd = tk.end;
    break;
  }
  if (blockBodyStart < 0) {
    throw new Error(
      `inlineFieldUpdateActionInExt: ${fieldType} block with oid="${fieldOid}" not found in extension XML`,
    );
  }

  const body = extKernelXml.substring(blockBodyStart, blockBodyEnd);

  if (body.includes('<UpdateActions>')) {
    throw new Error(
      `inlineFieldUpdateActionInExt: field oid="${fieldOid}" already has <UpdateActions> — v0.1 supports one Calculate per field`,
    );
  }

  // Inject FireUpdateEvent before <PropertyName> (capture req-120 ordering)
  // unless already present.
  let newBody = body;
  if (!newBody.includes('<FireUpdateEvent>')) {
    const propMatch = newBody.match(/<PropertyName>/);
    if (!propMatch) {
      throw new Error(
        `inlineFieldUpdateActionInExt: field block missing <PropertyName> — unexpected wire shape`,
      );
    }
    newBody =
      newBody.substring(0, propMatch.index!) +
      `<FireUpdateEvent>1</FireUpdateEvent>` +
      newBody.substring(propMatch.index!);
  }

  // Inject <UpdateActions> immediately after </FieldName> (capture req-120
  // ordering). FieldName is mandatory on real fields, but BasePropertyField
  // doesn't have it — UpdateActions on BasePropertyField isn't supported in
  // v0.1 (no real-world demand surfaced).
  const fieldNameClose = '</FieldName>';
  const fnIdx = newBody.indexOf(fieldNameClose);
  if (fnIdx < 0) {
    throw new Error(
      `inlineFieldUpdateActionInExt: field block missing </FieldName> — type ${fieldType} may not support inline UpdateActions in v0.1`,
    );
  }
  const insertAt = fnIdx + fieldNameClose.length;
  newBody =
    newBody.substring(0, insertAt) +
    buildUpdateActionsBlock(service) +
    newBody.substring(insertAt);

  return (
    extKernelXml.substring(0, blockBodyStart) +
    newBody +
    extKernelXml.substring(blockBodyEnd)
  );
}

/**
 * Locate a field by `<Key>fieldKey</Key>` in a parent's FKERNELXML and
 * return its oid (the field's `<Id>` element value) along with the wrapper
 * element tag name (e.g. `IntegerField`, `TextField`).
 *
 * The extension stub (returned by `getKernelXml(extensionFid)`) doesn't
 * carry oids for parent-original fields — those live only in the parent
 * (SAL_SaleOrder etc.) FKERNELXML. The field-level UpdateAction overlay
 * must target that parent oid via `action="edit" oid="<field-oid>"`.
 *
 * Implementation: walk the kernel XML with the shared tag tokenizer
 * (`iterateTagTokens` from `fkernel-parsers.ts`), find each
 * `<XField>...</XField>` block, and match its TOP-LEVEL `<Key>` only —
 * never a `<Key>` nested inside `<RefProperty>` or other sub-elements.
 *
 * Returns null on miss; caller surfaces a clear error naming the fieldKey
 * + parent. Field XML is "flat" at top of `<Elements>` (see
 * `parseFieldsFromKernelXml` in `fkernel-parsers.ts`), so we don't need
 * to descend into EntryEntity wrappers.
 */
export function extractFieldOid(
  parentKernelXml: string,
  fieldKey: string,
): { oid: string; fieldType: string } | null {
  if (!parentKernelXml || !fieldKey) return null;

  // Walk every `<XField>...</XField>` block at any depth via the shared
  // tokenizer, then resolve its identity via top-level child lookups.
  // findLastTopLevelChildText is critical here: real BOS BillModel XML
  // commonly has `<RefProperty><Key>FOther</Key></RefProperty>` nested
  // inside another field's body; a naive `<Key>fieldKey</Key>` regex
  // bleeds the wrong field. See parseFieldsFromKernelXml for the same
  // discipline applied at scale.
  const stack: Array<{ tag: string; bodyStart: number } | null> = [];
  for (const tk of iterateTagTokens(parentKernelXml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      const isField = /Field$/.test(tk.tag);
      stack.push(isField ? { tag: tk.tag, bodyStart: tk.end } : null);
      continue;
    }
    const frame = stack.pop();
    if (!frame) continue;
    const body = parentKernelXml.substring(frame.bodyStart, tk.start);
    const key = findLastTopLevelChildText(body, 'Key');
    if (key !== fieldKey) continue;
    const oid = findLastTopLevelChildText(body, 'Id');
    if (!oid) continue;
    return { oid, fieldType: frame.tag };
  }
  return null;
}
