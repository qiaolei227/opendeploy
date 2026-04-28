/**
 * Pure XML parsers for K/3 Cloud's `FKERNELXML` blob — no SQL, no fetch.
 *
 * The same FKERNELXML string ships from two sources:
 *   - SQL: `SELECT FKERNELXML FROM T_META_OBJECTTYPE WHERE FID = @id`
 *   - RPC: `<XmlData ColName="FKERNELXML">` block from `GetBusinessObjectMetaData`
 *
 * Either way, the bytes are identical so this file owns the parsing.
 *
 * Why a hand-rolled tokenizer (rather than xmldom or fast-xml-parser):
 *   - SAL_SaleOrder ships ~1 MB of kernel XML; full DOM walk is ~5x slower
 *   - `<` followed by alpha can appear inside CDATA-wrapped Python scripts
 *     (`if x<i: pass`), so we strip CDATA before tokenizing
 *   - The tokenizer + element-depth stack lets us pick out depth-0 children
 *     of a field node, avoiding the many same-named tags nested deeper
 *     (e.g. `<RefProperty><Key>FOther</Key></RefProperty>`)
 */

import type { FieldMeta, PluginMeta } from '@shared/erp-types';

// ─── GUID helpers ──────────────────────────────────────────────────────

/**
 * BOS extension FIDs come in two flavors and the DB stores both:
 *   - 32-hex compact   (e.g. "631a71d7f48249fca4e78daa74e0b925")
 *   - 8-4-4-4-12 dashed (e.g. "df5bdd0d-fcbc-427c-87bd-a178f65a56e6")
 *
 * Callers that need to look up either form can use this helper to get both
 * variants. Returns `primary` = caller's input verbatim, `alt` = the other
 * form when input is a 32-hex GUID, else `null`.
 */
export function guidVariants(id: string): { primary: string; alt: string | null } {
  const compact = id.replace(/-/g, '').toLowerCase();
  if (compact.length !== 32 || !/^[0-9a-f]{32}$/.test(compact)) {
    return { primary: id, alt: null };
  }
  const dashed =
    `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-` +
    `${compact.slice(16, 20)}-${compact.slice(20)}`;
  return id === dashed
    ? { primary: dashed, alt: compact }
    : id === compact
      ? { primary: compact, alt: dashed }
      : { primary: id, alt: compact };
}

// ─── Tag tokenizer ─────────────────────────────────────────────────────

const FIELD_TAG_RE = /Field$/;
/**
 * Source pattern for the tag tokenizer. Compiled to a FRESH `RegExp` each
 * time `iterateTagTokens` is called — the parser nests tokenizer iterations
 * (the outer walk invokes `findLastTopLevelChildText` on each field body),
 * so sharing a `/g` regex across calls would corrupt `lastIndex`.
 */
const TAG_TOKEN_PATTERN = '<(\\/?)([A-Za-z][A-Za-z0-9]*)\\b[^>]*?(\\/?)>';

export interface TagToken {
  tag: string;
  isClose: boolean;
  isSelfClose: boolean;
  start: number;
  end: number;
}

export function* iterateTagTokens(xml: string): Generator<TagToken> {
  const re = new RegExp(TAG_TOKEN_PATTERN, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    yield {
      tag: m[2],
      isClose: m[1] === '/',
      isSelfClose: m[3] === '/',
      start: m.index,
      end: m.index + m[0].length,
    };
  }
}

/**
 * Return the text inside the LAST `<tagName>...</tagName>` that sits at depth
 * 0 of `body` (i.e., a direct child, not nested inside another element).
 * Returns undefined when no such child exists.
 */
export function findLastTopLevelChildText(body: string, tagName: string): string | undefined {
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
  if (lastStart >= 0 && lastEnd > lastStart) {
    return body.substring(lastStart, lastEnd).trim() || undefined;
  }
  return undefined;
}

// ─── parseFieldsFromKernelXml ──────────────────────────────────────────

type Frame =
  | { kind: 'plain'; tag: string }
  | { kind: 'field'; tag: string; bodyStart: number };

/**
 * Walk an FKERNELXML blob and emit every field declaration.
 *
 * K/3 Cloud declares each field's identity via CHILD elements — the tag
 * name itself encodes the type (`<TextField>`, `<BaseDataField>`, etc.).
 * Critical layout choice: all real fields sit FLAT at the top level of
 * `<Elements>`. Entry affiliation is a direct-child `<EntityKey>` on the
 * field, NOT nesting inside an `<EntryEntity>` tag. (EntryEntity nodes
 * exist but only carry entry-level metadata — table name, seq, key — not
 * the field declarations themselves.)
 *
 *   <BaseDataField ElementType="13" ElementStyle="0">
 *     ...nested metadata that may also contain <Key> tags...
 *     <EntityKey>FSaleOrderEntry</EntityKey>  ← entry affiliation (absent → head)
 *     <Name>物料编码</Name>
 *     <Id>uuid…</Id>
 *     <Key>FMaterialId</Key>
 *   </BaseDataField>
 *
 * Fields lacking a direct-child <Name> are treated as pseudo-field metadata
 * markers (e.g. internal tags like `<QKFField>` that happen to end in
 * "Field") and skipped. They would otherwise clutter output with unnamed
 * entries and, due to first-wins dedup, steal the slot from real fields.
 */
export function parseFieldsFromKernelXml(xml: string): FieldMeta[] {
  const fields: FieldMeta[] = [];
  const seen = new Set<string>();
  const stack: Frame[] = [];

  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;

    if (!tk.isClose) {
      if (FIELD_TAG_RE.test(tk.tag)) {
        stack.push({ kind: 'field', tag: tk.tag, bodyStart: tk.end });
      } else {
        stack.push({ kind: 'plain', tag: tk.tag });
      }
      continue;
    }

    // Close token: pop tolerantly (malformed XML shouldn't abort the parse).
    const frame = stack.pop();
    if (!frame || frame.kind !== 'field') continue;

    const body = xml.substring(frame.bodyStart, tk.start);
    const key = findLastTopLevelChildText(body, 'Key');
    if (!key || seen.has(key)) continue;
    const name = findLastTopLevelChildText(body, 'Name');
    if (!name) continue;
    const entityKey = findLastTopLevelChildText(body, 'EntityKey');

    seen.add(key);
    fields.push({
      key,
      name,
      type: frame.tag,
      isEntryField: entityKey !== undefined,
      entryKey: entityKey,
    });
  }

  return fields;
}

// ─── parseFormPluginsFromKernelXml ─────────────────────────────────────

/**
 * Replace every `<![CDATA[...]]>` block with a placeholder token, returning
 * the stripped XML and the recovered values keyed by token. Used by
 * parseFormPluginsFromKernelXml so the regex tokenizer doesn't trip on `<`
 * followed by alpha inside Python scripts (e.g. `if x<i: pass` would
 * otherwise be parsed as a stray `<i:` tag and corrupt depth tracking).
 *
 * Tokens use a sequence the tokenizer cannot accidentally produce or
 * mistake for tag content: `CDATA<n>`.
 */
export function stripCdataSections(xml: string): { stripped: string; values: string[] } {
  const values: string[] = [];
  const stripped = xml.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, (_match, body: string) => {
    const idx = values.length;
    values.push(body);
    return `CDATA${idx}`;
  });
  return { stripped, values };
}

/** Restore CDATA placeholders to bare text (no `<![CDATA[]]>` wrap). For
 * scalar field bodies. Use {@link restoreCdataInChunk} when re-emitting raw
 * XML — that one keeps the wrapper. */
export function restoreCdata(text: string | undefined, values: string[]): string | undefined {
  if (text === undefined) return undefined;
  return text.replace(/CDATA(\d+)/g, (_m, n: string) => values[Number(n)] ?? '');
}

/** Restore CDATA placeholders inside a raw XML chunk that will be re-emitted
 * verbatim (e.g. round-tripping `<PlugIn><PyScript><![CDATA[...]]></PyScript></PlugIn>`).
 * Keeps the `<![CDATA[]]>` wrap so the chunk remains valid XML. */
export function restoreCdataInChunk(text: string, values: string[]): string {
  return text.replace(/CDATA(\d+)/g, (_m, n: string) => {
    const v = values[Number(n)];
    return v === undefined ? '' : `<![CDATA[${v}]]>`;
  });
}

/**
 * Extract every `<PlugIn>` child inside the first `<FormPlugins>` block.
 * Returns empty array when there's no `<FormPlugins>` block or when it's
 * self-closing. Classifies each plugin:
 *   - `python` when `<PlugInType>1</PlugInType>` is present (or `<PyScript>`
 *     exists, since BOS Designer always emits both together for Python)
 *   - `dll` otherwise (PlugInType=0 / absent + DLL fully-qualified ClassName)
 *
 * Wire format reference: 2026-04-27 capture req-75 + tests/erp/rpc/dcxml.test.ts.
 *
 * CDATA-safe: PyScript bodies with `<` followed by alpha (e.g. `if x<i:`)
 * get extracted before tokenizing so they can't fool the tokenizer.
 */
export function parseFormPluginsFromKernelXml(xml: string): PluginMeta[] {
  if (!xml) return [];

  const { stripped, values } = stripCdataSections(xml);

  const openIdx = stripped.indexOf('<FormPlugins>');
  const closeIdx = stripped.indexOf('</FormPlugins>');
  if (openIdx < 0 || closeIdx < 0 || closeIdx < openIdx) return [];
  const body = stripped.substring(openIdx + '<FormPlugins>'.length, closeIdx);

  const plugins: PluginMeta[] = [];
  type PFrame = { tag: string; bodyStart: number; isPlugIn: boolean };
  const stack: PFrame[] = [];

  for (const tk of iterateTagTokens(body)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      stack.push({ tag: tk.tag, bodyStart: tk.end, isPlugIn: tk.tag === 'PlugIn' });
      continue;
    }
    const frame = stack.pop();
    if (!frame || !frame.isPlugIn) continue;

    const nodeBody = body.substring(frame.bodyStart, tk.start);
    const className = findLastTopLevelChildText(nodeBody, 'ClassName');
    if (!className) continue;
    const plugInType = findLastTopLevelChildText(nodeBody, 'PlugInType');
    const pyScript = restoreCdata(findLastTopLevelChildText(nodeBody, 'PyScript'), values);
    const orderIdText = findLastTopLevelChildText(nodeBody, 'OrderId');
    const isPython = plugInType === '1' || pyScript !== undefined;

    plugins.push({
      className,
      type: isPython ? 'python' : 'dll',
      ...(isPython ? { pyScript: pyScript ?? '' } : {}),
      ...(orderIdText !== undefined && !isNaN(Number(orderIdText))
        ? { orderId: Number(orderIdText) }
        : {}),
    });
  }
  return plugins;
}

// ─── Appearance geometry ───────────────────────────────────────────────

export interface AppearanceGeometry {
  /** Element tag name, e.g. "TextFieldAppearance", "SubHeadEntityAppearance",
   * "TabControlAppearance". Consumers filter by this — typically only
   * `*FieldAppearance` nodes should drive layout decisions, since region /
   * tab / sub-entity nodes carry container-wide bounding boxes that would
   * inflate maxRight far past where original-vendor fields actually paint. */
  tag: string;
  /** Container key the appearance lives in, e.g. "FTAB_P0". */
  container: string;
  /** Left pixel offset within the container; 0 when absent. */
  left: number;
  /** Top pixel offset within the container; 0 when absent. */
  top: number;
  /** Width in pixels; 0 when absent. */
  width: number;
}

/**
 * Walk every appearance node (anything inside `<Appearances>...</Appearances>`)
 * and emit its container/left/top/width. Used by the placement engine in
 * `kingdee_add_fields` to find the rightmost edge of existing layout in a
 * given container — we drop new fields just past it so they don't overlap.
 *
 * Why "any appearance with a Container":
 *   - Real BOS forms have appearances of type *FieldAppearance,
 *     TabPageAppearance, TabControlAppearance, GroupAppearance, ...
 *   - Most carry Container + Left + Top + Width as direct children
 *   - We don't care which kind it is; only the geometry, scoped by container
 *
 * Missing children are coerced to 0 (BOS itself treats unset Top as 0, and
 * SAL_SaleOrder's BillNoFieldAppearance shows this in the wild).
 */
export function parseAppearanceGeometry(xml: string): AppearanceGeometry[] {
  if (!xml) return [];
  const out: AppearanceGeometry[] = [];

  // Locate the LAST <Appearances>...</Appearances> body — the parent
  // FKERNELXML can contain multiple LayoutInfos in older forms; the
  // last one is the active layout.
  const openTag = '<Appearances>';
  const closeTag = '</Appearances>';
  const openIdx = xml.lastIndexOf(openTag);
  const closeIdx = xml.lastIndexOf(closeTag);
  if (openIdx < 0 || closeIdx <= openIdx) return [];
  const body = xml.substring(openIdx + openTag.length, closeIdx);

  let depth = 0;
  let frameStart = -1;
  let frameTag = '';
  for (const tk of iterateTagTokens(body)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      if (depth === 0) {
        frameStart = tk.end;
        frameTag = tk.tag;
      }
      depth++;
    } else {
      depth--;
      if (depth === 0 && frameStart >= 0) {
        const nodeBody = body.substring(frameStart, tk.start);
        const container = findLastTopLevelChildText(nodeBody, 'Container');
        if (container) {
          const left = Number(findLastTopLevelChildText(nodeBody, 'Left') ?? '0') || 0;
          const top = Number(findLastTopLevelChildText(nodeBody, 'Top') ?? '0') || 0;
          const width = Number(findLastTopLevelChildText(nodeBody, 'Width') ?? '0') || 0;
          out.push({ tag: frameTag, container, left, top, width });
        }
        frameStart = -1;
        frameTag = '';
      }
    }
  }
  return out;
}

// ─── Form layout containers ────────────────────────────────────────────

export interface FormTabContainer {
  /** Tab key, e.g. "FTAB_P0" or "FTab_P0" (case as-emitted). */
  key: string;
  /** Display caption from `<Caption>`, e.g. "基本信息". */
  caption: string;
  /** Owning TabControl key, e.g. "FTab" or "FTab1" — null when absent. */
  parentControl: string | null;
}

export interface FormEntryContainer {
  /** Entity key (== EntityKey field for child fields), e.g. "FSaleOrderEntry". */
  key: string;
  /** Display name from `<Name>`, e.g. "明细信息". */
  name: string;
  /** SQL table name, e.g. "T_SAL_ORDERENTRY". */
  tableName: string | null;
  /** "entry" (single-level) or "sub-entry" (nested). */
  kind: 'entry' | 'sub-entry';
}

export interface FormLayout {
  tabs: FormTabContainer[];
  entries: FormEntryContainer[];
}

/**
 * Enumerate the parent form's container catalog: every TabPageAppearance and
 * every EntryEntity / SubEntryEntity, with their Chinese display labels.
 *
 * Used by `kingdee_get_form_layout` so the agent can ask the user "which tab
 * (基本信息 / 客户信息 / 财务信息 ...)" or "which entry (订单条款 / 明细信息 ...)" rather
 * than blind-defaulting to FTAB_P0.
 *
 * Tab parentControl lets the agent group head-side tabs (under FTab) vs
 * entry-side tabs (under FTab1) when the captions are ambiguous; in
 * SAL_SaleOrder both head and entries have a "财务信息" tab, the parentControl
 * disambiguates.
 *
 * EntryEntity parsing tolerates duplicate occurrences (the parsed kernel XML
 * sometimes repeats them across cumulative ancestor models); first-wins by
 * Key dedup — same as parseFieldsFromKernelXml.
 */
export function parseFormLayoutContainers(xml: string): FormLayout {
  if (!xml) return { tabs: [], entries: [] };

  // ── tabs ──
  const tabs: FormTabContainer[] = [];
  const seenTabKeys = new Set<string>();
  const tabRe = /<TabPageAppearance\b[^>]*?>([\s\S]*?)<\/TabPageAppearance>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tabRe.exec(xml)) !== null) {
    const inner = tm[1];
    const key = findLastTopLevelChildText(inner, 'Key');
    if (!key || seenTabKeys.has(key)) continue;
    const caption = findLastTopLevelChildText(inner, 'Caption') ?? '';
    const parentControl = findLastTopLevelChildText(inner, 'Container') ?? null;
    seenTabKeys.add(key);
    tabs.push({ key, caption, parentControl });
  }

  // ── entries ──
  // EntryEntity / SubEntryEntity nodes nest entries; same parser handles
  // both via the tag suffix (matches the `parseFieldsFromKernelXml`
  // approach). Tag is recognized by `EntryEntity` or `SubEntryEntity` tail.
  const entries: FormEntryContainer[] = [];
  const seenEntryKeys = new Set<string>();
  type EFrame = { tag: string; bodyStart: number };
  const stack: EFrame[] = [];
  const isEntryTag = (t: string) => t === 'EntryEntity' || t === 'SubEntryEntity';

  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      stack.push({ tag: tk.tag, bodyStart: tk.end });
      continue;
    }
    const frame = stack.pop();
    if (!frame || !isEntryTag(frame.tag)) continue;
    const inner = xml.substring(frame.bodyStart, tk.start);
    const key = findLastTopLevelChildText(inner, 'Key');
    if (!key || seenEntryKeys.has(key)) continue;
    const name = findLastTopLevelChildText(inner, 'Name') ?? '';
    const tableName = findLastTopLevelChildText(inner, 'TableName') ?? null;
    seenEntryKeys.add(key);
    entries.push({
      key,
      name,
      tableName,
      kind: frame.tag === 'SubEntryEntity' ? 'sub-entry' : 'entry',
    });
  }

  return { tabs, entries };
}
