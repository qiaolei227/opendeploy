/**
 * TS-side parser for `<FormOperations>` + `<BarButtonItem>` extraction
 * from raw extension FKERNELXML.
 *
 * **Why TS-side instead of bridge `list_operations`**:
 * The bridge's `BosContext.ListOperations` calls
 * `DcxmlSerializer.DeserializeFromString(xml)` without a parent baseline.
 * For an extension's FKERNELXML the Form node is `<Form action="edit" oid=
 * "BOS_BillModel">` — and per memory `bos_form_metadata_deserialize_quirks.md`
 * finding #1, BOS's serializer SILENTLY DROPS `action="edit"` when no baseline
 * is provided. So the bridge sees the deserialized `formMeta` but
 * `formMeta.BusinessInfo.GetForm().FormOperations` is empty even though the
 * raw XML clearly carries the operation. Discovered via real-server smoke
 * 2026-05-07 — was the root cause of all five "5.12.6 silent-drop" rounds.
 *
 * This parser walks the XML directly with the same indexOf-style helpers
 * `existing-elements.ts` uses; no DcxmlSerializer involved, so the
 * baseline-drop pitfall does not apply.
 *
 * **Coverage**: matches what the bridge would have returned but DOES return —
 * same DTO shape (`ListOperationsResult` from `operation-types.ts`). Bridge's
 * `list_operations` op kept for back-compat but `connector.listOperations`
 * now routes through this parser. Bridge fix is tracked separately.
 */

import type {
  ListOperationsResult,
  ParsedFormOperation,
  ParsedServicePlugin,
  ParsedToolbarButton,
} from './operation-types';

/**
 * Parse FKERNELXML → ListOperationsResult. Empty extension XML returns
 * empty arrays. Malformed XML returns whatever was successfully parsed
 * (no exceptions — this is a read path).
 */
export function parseOperationsFromKernelXml(xml: string): ListOperationsResult {
  if (!xml) return { operations: [], toolbarButtons: [] };

  return {
    operations: parseFormOperations(xml),
    toolbarButtons: parseToolbarButtons(xml),
  };
}

// ── FormOperation parsing ────────────────────────────────────────────────

const FORM_OPERATION_RE = /<FormOperation\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/FormOperation>/g;

function parseFormOperations(xml: string): ParsedFormOperation[] {
  const out: ParsedFormOperation[] = [];
  for (const m of xml.matchAll(FORM_OPERATION_RE)) {
    const body = m[1];
    const operationKey = matchTextChild(body, 'Id');
    if (!operationKey) continue;
    out.push({
      operationKey,
      operationId: Number(matchTextChild(body, 'OperationId') ?? '0'),
      operationName: matchTextChild(body, 'OperationName') ?? undefined,
      expressValue: matchInsideOperationParameter(body, 'ExpressValue'),
      operEleIds: matchTextChild(body, 'OperEleIds') ?? undefined,
      servicePlugins: parseServicePlugins(body),
    });
  }
  return out;
}

function matchInsideOperationParameter(
  formOpBody: string,
  childTag: string,
): string | undefined {
  // OperationParameter sits under <Parmeter>; pull the named child from inside it.
  const op = formOpBody.match(/<OperationParameter\b[^>]*>([\s\S]*?)<\/OperationParameter>/);
  if (!op) return undefined;
  return matchTextChild(op[1], childTag) ?? undefined;
}

const SERVICE_PLUGIN_BLOCK_RE =
  /<ServicePlugins\b[^>]*>([\s\S]*?)<\/ServicePlugins>/;
const PLUGIN_RE = /<PlugIn\b[^>]*>([\s\S]*?)<\/PlugIn>/g;

function parseServicePlugins(formOpBody: string): ParsedServicePlugin[] {
  const block = formOpBody.match(SERVICE_PLUGIN_BLOCK_RE);
  if (!block) return [];
  const plugins: ParsedServicePlugin[] = [];
  for (const m of block[1].matchAll(PLUGIN_RE)) {
    const body = m[1];
    const className = matchTextChild(body, 'ClassName');
    if (!className) continue;
    plugins.push({
      className,
      plugInType: Number(matchTextChild(body, 'PlugInType') ?? '0'),
      hasPyScript: /<PyScript\b/.test(body),
    });
  }
  return plugins;
}

// ── BarButtonItem parsing ────────────────────────────────────────────────

// Each appearance block (FormAppearance / EntryEntityAppearance) carries an
// inner Menu/BarDataManager with BarItems + BarItemLinks. Walk every
// appearance, then within it walk every BarButtonItem.
const APPEARANCE_RE =
  /<(FormAppearance|EntryEntityAppearance)\b[^>]*>([\s\S]*?)<\/\1>/g;
const BAR_BUTTON_RE = /<BarButtonItem\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/BarButtonItem>/g;
const BAR_ITEM_LINK_RE = /<BarItemLink\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/BarItemLink>/g;
const FORM_BUSINESS_SERVICE_RE =
  /<FormBusinessService\b[^>]*>([\s\S]*?)<\/FormBusinessService>/;
const PARAMETERS_RE = /<Parameters>(\[[^<]*\])<\/Parameters>/;

function parseToolbarButtons(xml: string): ParsedToolbarButton[] {
  const out: ParsedToolbarButton[] = [];
  for (const apM of xml.matchAll(APPEARANCE_RE)) {
    const apKind = apM[1];
    const apBody = apM[2];
    // Entry-level menus carry the entity's own <Key> child as
    // parentEntityKey. FormAppearance has no equivalent (the toolbar is the
    // form's primary one).
    const parentEntityKey =
      apKind === 'EntryEntityAppearance' ? matchTextChild(apBody, 'Key') ?? null : null;

    // Index BarItemLinks by BarItemKey for binding lookup.
    const linkByButtonKey = new Map<string, { id?: string; parentKey?: string }>();
    for (const linkM of apBody.matchAll(BAR_ITEM_LINK_RE)) {
      const lb = linkM[1];
      const k = matchTextChild(lb, 'BarItemKey');
      if (!k) continue;
      linkByButtonKey.set(k, {
        id: matchTextChild(lb, 'Id') ?? undefined,
        parentKey: matchTextChild(lb, 'ParentKey') ?? undefined,
      });
    }

    for (const btnM of apBody.matchAll(BAR_BUTTON_RE)) {
      const body = btnM[1];
      const buttonKey = matchTextChild(body, 'Key');
      if (!buttonKey) continue;

      const link = linkByButtonKey.get(buttonKey);
      const fbs = body.match(FORM_BUSINESS_SERVICE_RE);
      let boundOperationKey: string | null = null;
      if (fbs) {
        const params = fbs[1].match(PARAMETERS_RE)?.[1];
        if (params) {
          try {
            const arr = JSON.parse(params);
            if (Array.isArray(arr) && typeof arr[0] === 'string') boundOperationKey = arr[0];
          } catch {
            // Parameters didn't parse as JSON array — treat as orphan shell.
          }
        }
      }

      out.push({
        buttonKey,
        buttonId: matchTextChild(body, 'Id') ?? undefined,
        caption: matchTextChild(body, 'Caption') ?? undefined,
        description: matchTextChild(body, 'Description') ?? undefined,
        seq: Number(matchTextChild(body, 'Seq') ?? '0'),
        parentEntityKey,
        boundOperationKey,
        barItemLinkId: link?.id ?? null,
        toolbarKey: link?.parentKey ?? null,
      });
    }
  }
  return out;
}

// ── Tiny shared helpers ──────────────────────────────────────────────────

/** Match `<Tag>text</Tag>` as a direct child by tag name; returns the text or null. */
function matchTextChild(body: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const m = body.match(re);
  return m ? m[1] : null;
}
