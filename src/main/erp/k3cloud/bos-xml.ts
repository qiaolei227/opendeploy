/**
 * Pure helpers for K/3 Cloud extension FKERNELXML manipulation. Extracted
 * from `bos-writer.ts` so the XML logic can be unit-tested without a DB.
 *
 * Extension deltas are tiny (~400 chars) compared to the 1 MB base-form
 * FKERNELXML, and they follow a fixed shape:
 *
 *   <FormMetadata><BusinessInfo><BusinessInfo><Elements>
 *     <Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">
 *       <Id>{ext-uuid}</Id>
 *       <FormPlugins>
 *         <PlugIn ElementType="0" ElementStyle="0">
 *           <ClassName>…</ClassName>
 *           <PlugInType>1</PlugInType>         <!-- Python only -->
 *           <PyScript>…</PyScript>             <!-- Python only -->
 *           <OrderId>N</OrderId>               <!-- DLL only -->
 *         </PlugIn>
 *         …more <PlugIn> children…
 *       </FormPlugins>
 *     </Form>
 *   </Elements></BusinessInfo></BusinessInfo></FormMetadata>
 *
 * We build this via string templates (deterministic, no dependency) and
 * parse it with a depth-tracking tokenizer (same style as queries.ts).
 * Shipping a full XML parser is overkill for content we produce ourselves
 * and only ever skim from the DB.
 */

import { randomUUID } from 'node:crypto';
import type { PluginMeta } from '@shared/erp-types';

// ─── Field type registry ────────────────────────────────────────────────
//
// Plan 5.12.1 expanded `kingdee_add_field` from text-only to 16 BOS field
// types. Type names are stable agent-facing identifiers; xmlTag / csClass
// are the BOS truth — class name (= XML tag) reverse-engineered from
// Kingdee.BOS.Core.dll (see capability-catalog.md section 1).
//
// `requiredExtraProps` lists the spec fields *beyond* the universal
// {key, caption}. The tool layer validates these before dispatching.

// reference_property is intentionally NOT in this list. The BOS C# class
// `ReferencePropertyField` exists (ElementType=250) but BOS rejects
// `<ReferencePropertyField>` as "未能找到对应的数据类型" during deserialization
// — 2026-04-26 user demo实证 on SAL_SaleOrder. Likely the type needs a
// non-standard parent context (it's never used in any sampled standard bill,
// 0 hits in SAL_SaleOrder FKERNELXML). v0.1 drops it; revisit when we have a
// real-XML sample showing where it's actually accepted.
export const FIELD_TYPES = [
  'text',
  'large_text',
  'int',
  'decimal',
  'amount',
  'qty',
  'date',
  'datetime',
  'checkbox',
  'combo',
  'mul_combo',
  'base_data',
  'base_property',
  'color',
  'mobile'
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldTypeSpec {
  /** XML tag emitted into FKERNELXML. Same as the BOS C# class name. */
  xmlTag: string;
  /** Full BOS C# class name. Identical to xmlTag for now; kept separate so
   *  future variants (e.g., a CheckBox sub-type of TextField) can deviate. */
  csClass: string;
  /** `ElementType="N"` numeric attribute on the FIELD node (e.g.
   *  `<QtyField ElementType="22">`). Reverse-engineered from real
   *  SAL_SaleOrder FKERNELXML — see memory `bos_field_xml_realities.md`. */
  elementType: number;
  /** `ElementType="N"` numeric attribute on the APPEARANCE node (e.g.
   *  `<QtyFieldAppearance ElementType="22">`). Usually equals `elementType`
   *  but BaseDataField is the exception: field=13, appearance=7. */
  appearanceElementType: number;
  /** Whether the appearance node should emit `<EmptyText action="setnull"/>`.
   *  CheckBoxFieldAppearance does NOT have it (no placeholder concept for a
   *  yes/no widget); every other appearance does. Default true. */
  appearanceHasEmptyText: boolean;
  /** Spec field names that the caller MUST supply beyond {key, caption}.
   *  Tool-layer validates; XML renderer can assume these are present. */
  requiredExtraProps: readonly string[];
  /** date vs datetime share the DateTimeField class — this flag distinguishes. */
  dateOnly?: boolean;
}

const FIELD_TYPE_SPECS: Record<FieldType, FieldTypeSpec> = {
  text:               { xmlTag: 'TextField',              csClass: 'TextField',              elementType: 1,   appearanceElementType: 1,   appearanceHasEmptyText: true,  requiredExtraProps: [] },
  large_text:         { xmlTag: 'LargeRichTextField',     csClass: 'LargeRichTextField',     elementType: 1,   appearanceElementType: 1,   appearanceHasEmptyText: true,  requiredExtraProps: [] },
  int:                { xmlTag: 'IntegerField',           csClass: 'IntegerField',           elementType: 3,   appearanceElementType: 3,   appearanceHasEmptyText: true,  requiredExtraProps: [] },
  decimal:            { xmlTag: 'DecimalField',           csClass: 'DecimalField',           elementType: 2,   appearanceElementType: 2,   appearanceHasEmptyText: true,  requiredExtraProps: [] },
  amount:             { xmlTag: 'AmountField',            csClass: 'AmountField',            elementType: 21,  appearanceElementType: 21,  appearanceHasEmptyText: true,  requiredExtraProps: [] },
  qty:                { xmlTag: 'QtyField',               csClass: 'QtyField',               elementType: 22,  appearanceElementType: 22,  appearanceHasEmptyText: true,  requiredExtraProps: [] },
  date:               { xmlTag: 'DateTimeField',          csClass: 'DateTimeField',          elementType: 5,   appearanceElementType: 5,   appearanceHasEmptyText: true,  requiredExtraProps: [], dateOnly: true },
  datetime:           { xmlTag: 'DateTimeField',          csClass: 'DateTimeField',          elementType: 5,   appearanceElementType: 5,   appearanceHasEmptyText: true,  requiredExtraProps: [], dateOnly: false },
  checkbox:           { xmlTag: 'CheckBoxField',          csClass: 'CheckBoxField',          elementType: 8,   appearanceElementType: 8,   appearanceHasEmptyText: false, requiredExtraProps: [] },
  combo:              { xmlTag: 'ComboField',             csClass: 'ComboField',             elementType: 9,   appearanceElementType: 9,   appearanceHasEmptyText: true,  requiredExtraProps: ['comboItems'] },
  mul_combo:          { xmlTag: 'MulComboField',          csClass: 'MulComboField',          elementType: 9,   appearanceElementType: 9,   appearanceHasEmptyText: true,  requiredExtraProps: ['comboItems'] },
  // BaseDataField is the only type where field-node and appearance-node ElementType differ
  // (field=13, appearance=7 — verified against real SAL_SaleOrder F客户).
  base_data:          { xmlTag: 'BaseDataField',          csClass: 'BaseDataField',          elementType: 13,  appearanceElementType: 7,   appearanceHasEmptyText: true,  requiredExtraProps: ['refBaseDataObjectKey'] },
  base_property:      { xmlTag: 'BasePropertyField',      csClass: 'BasePropertyField',      elementType: 14,  appearanceElementType: 14,  appearanceHasEmptyText: true,  requiredExtraProps: ['sourceField', 'srcDisplayFieldName'] },
  // reference_property removed in v0.1 — BOS rejects <ReferencePropertyField> on
  // standard bills. See FIELD_TYPES comment above.
  color:              { xmlTag: 'ColorField',             csClass: 'ColorField',             elementType: 1,   appearanceElementType: 1,   appearanceHasEmptyText: true,  requiredExtraProps: [] },
  mobile:             { xmlTag: 'MobileField',            csClass: 'MobileField',            elementType: 1,   appearanceElementType: 1,   appearanceHasEmptyText: true,  requiredExtraProps: [] }
};

export function getFieldTypeSpec(type: FieldType): FieldTypeSpec {
  const spec = FIELD_TYPE_SPECS[type];
  if (!spec) throw new Error(`unknown field type: ${type}`);
  return spec;
}

// ─── XML helpers ────────────────────────────────────────────────────────

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Render one <PlugIn> node. Python / DLL shapes differ per `plugin.type`. */
function renderPluginNode(plugin: PluginMeta): string {
  const parts = [
    '<PlugIn ElementType="0" ElementStyle="0">',
    `<ClassName>${xmlEscape(plugin.className)}</ClassName>`
  ];
  if (plugin.type === 'python') {
    parts.push('<PlugInType>1</PlugInType>');
    parts.push(`<PyScript>${xmlEscape(plugin.pyScript ?? '')}</PyScript>`);
  } else if (plugin.orderId !== undefined) {
    parts.push(`<OrderId>${plugin.orderId}</OrderId>`);
  }
  parts.push('</PlugIn>');
  return parts.join('');
}

/**
 * Build a full extension-delta FKERNELXML with the given plugin list. When
 * `plugins` is empty we still emit an empty `<FormPlugins/>` section —
 * BOS Designer expects the tag to exist even on freshly-created extensions
 * that carry nothing.
 */
export function buildExtensionKernelXml(extId: string, plugins: PluginMeta[]): string {
  const pluginNodes = plugins.map(renderPluginNode).join('');
  const formPluginsTag = plugins.length > 0
    ? `<FormPlugins>${pluginNodes}</FormPlugins>`
    : '<FormPlugins/>';
  return (
    '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
    '<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">' +
    `<Id>${xmlEscape(extId)}</Id>` +
    formPluginsTag +
    '</Form>' +
    '</Elements></BusinessInfo></BusinessInfo></FormMetadata>'
  );
}

// ─── Parsing ────────────────────────────────────────────────────────────

const TAG_TOKEN_PATTERN = '<(\\/?)([A-Za-z][A-Za-z0-9]*)\\b[^>]*?(\\/?)>';

interface TagToken {
  tag: string;
  isClose: boolean;
  isSelfClose: boolean;
  /** Offset of the `<`. */
  start: number;
  /** Offset just after the `>`. */
  end: number;
}

function* iterateTagTokens(xml: string): Generator<TagToken> {
  // Fresh regex per call — `lastIndex` on a shared /g instance corrupts
  // across nested iterations (queries.ts hit this bug).
  const re = new RegExp(TAG_TOKEN_PATTERN, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    yield {
      tag: m[2],
      isClose: m[1] === '/',
      isSelfClose: m[3] === '/',
      start: m.index,
      end: m.index + m[0].length
    };
  }
}

/** Text of the LAST direct-child <tagName>…</tagName> in `body`, or undefined. */
function findLastTopLevelChildText(body: string, tagName: string): string | undefined {
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
    return xmlUnescape(body.substring(lastStart, lastEnd)).trim() || undefined;
  }
  return undefined;
}

/**
 * Extract every <PlugIn> child inside the first <FormPlugins> block. Returns
 * an empty array when the XML has no <FormPlugins> or when it's `<FormPlugins/>`.
 *
 * Classifies as `python` when the node has `<PlugInType>1</PlugInType>`
 * (direct child, at depth 0 of the PlugIn body). Everything else is `dll`.
 */
export function parseFormPluginsFromKernelXml(xml: string): PluginMeta[] {
  if (!xml) return [];

  // Locate the <FormPlugins>…</FormPlugins> block. We handle the self-closing
  // `<FormPlugins/>` case up front since there's nothing to scan inside.
  const openIdx = xml.indexOf('<FormPlugins>');
  const closeIdx = xml.indexOf('</FormPlugins>');
  if (openIdx < 0 || closeIdx < 0 || closeIdx < openIdx) return [];
  const body = xml.substring(openIdx + '<FormPlugins>'.length, closeIdx);

  const plugins: PluginMeta[] = [];
  // Walk direct-child <PlugIn> nodes. Stack tracks depth so nested
  // <PlugIn> (if any) isn't double-picked.
  type Frame = { tag: string; bodyStart: number; isPlugIn: boolean };
  const stack: Frame[] = [];

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
    const pyScript = findLastTopLevelChildText(nodeBody, 'PyScript');
    const orderIdText = findLastTopLevelChildText(nodeBody, 'OrderId');
    const isPython = plugInType === '1' || pyScript !== undefined;

    plugins.push({
      className,
      type: isPython ? 'python' : 'dll',
      ...(isPython ? { pyScript: pyScript ?? '' } : {}),
      ...(orderIdText !== undefined && !isNaN(Number(orderIdText))
        ? { orderId: Number(orderIdText) }
        : {})
    });
  }
  return plugins;
}

/**
 * Add a new <PlugIn> to an extension's FKERNELXML. Throws if a plugin with
 * the same `className` already exists — callers that want to overwrite
 * should first `removePluginFromKernelXml` then add.
 */
export function addPluginToKernelXml(xml: string, plugin: PluginMeta): string {
  const existing = parseFormPluginsFromKernelXml(xml);
  if (existing.some((p) => p.className === plugin.className)) {
    throw new Error(`plugin "${plugin.className}" already registered`);
  }
  const next = [...existing, plugin];
  // Rebuild the block rather than patch — simpler and still tiny.
  // Find the extension FID from the <Id>…</Id> of the Form node.
  const idMatch = xml.match(/<Id>([^<]+)<\/Id>/);
  if (!idMatch) throw new Error('kernel XML is missing the extension <Id>');
  return buildExtensionKernelXml(idMatch[1], next);
}

/**
 * Remove the <PlugIn> whose ClassName matches. Returns the XML unchanged
 * (but normalized) when no such plugin exists. Caller decides whether a
 * missing plugin is a soft no-op or an error.
 */
export function removePluginFromKernelXml(xml: string, className: string): string {
  const existing = parseFormPluginsFromKernelXml(xml);
  const next = existing.filter((p) => p.className !== className);
  const idMatch = xml.match(/<Id>([^<]+)<\/Id>/);
  if (!idMatch) throw new Error('kernel XML is missing the extension <Id>');
  return buildExtensionKernelXml(idMatch[1], next);
}

// ─── Field insertion ──────────────────────────────────────────────────

/**
 * Universal field spec — covers all 16 BOS field types by carrying optional
 * type-specific extras alongside the universal {key, caption}. Per-type
 * required props are validated by `insertFieldIntoKernelXml` per the spec
 * declared in `getFieldTypeSpec(type).requiredExtraProps`.
 */
export interface FieldSpec {
  /** Universal field Key (e.g. F_CUSTOM_AMOUNT). */
  key: string;
  /** Universal Chinese label shown in BOS Designer / on the form. */
  caption: string;
  /** Internal Name, defaults to caption. */
  name?: string;
  /** PropertyName, defaults to key. */
  propertyName?: string;
  /** DB column FieldName, defaults to key.toUpperCase(). */
  fieldName?: string;
  /** Layout container Key, defaults to 'FTAB_P0' (main tab). */
  containerKey?: string;
  /** Width in pixels, default 300. */
  width?: number;
  /** Label width in pixels, default 100. */
  labelWidth?: number;
  /** Top pixel position, default 10 (left-upper corner). */
  top?: number;
  /** Left pixel position, default 10. */
  left?: number;
  // ─── Type-specific extras (validated per type) ─────────────────────
  /** combo / mul_combo: dropdown items. */
  comboItems?: ReadonlyArray<{ value: string; caption: string }>;
  /** base_data: target base-data object key (e.g. 'BD_Customer'). */
  refBaseDataObjectKey?: string;
  /** base_property / reference_property: source BaseDataField key on same bill. */
  sourceField?: string;
  /** base_property: source base data property to display (e.g. 'FName'). */
  srcDisplayFieldName?: string;
}

/** Back-compat alias. New code should use `FieldSpec`. */
export interface TextFieldSpec {
  /** 表单 Key, 如 'F_TEST01'. BOS Designer 显示/绑定控件的唯一标识. */
  key: string;
  /** 显示标签 (label), 如 '客户编号'. */
  caption: string;
  /** 内部名称 (BOS Designer 的"名称"栏), 默认 = caption. */
  name?: string;
  /** PropertyName, 默认 = key. */
  propertyName?: string;
  /** DB 列名 FieldName, 默认 = key 的大写. */
  fieldName?: string;
  /** 布局容器 Key, 默认 'FTAB_P0' (主页签). */
  containerKey?: string;
  /** 控件宽度 px, 默认 300. */
  width?: number;
  /** 标签宽度 px, 默认 100. */
  labelWidth?: number;
  /** 字段在容器中的 Top 像素位置,默认 10(左上角)。用户在 BOS Designer 中拖到合适位置;
   * agent 真知道目标坐标时通过此参数显式指定。*/
  top?: number;
  /** 字段在容器中的 Left 像素位置,默认 10(左上角)。*/
  left?: number;
}

export interface InsertTextFieldOptions {
  spec: TextFieldSpec;
  /** 测试注入: 32-char GUID (无 dash) 生成器. 默认用 randomUUID stripped. */
  idGenerator?: () => string;
  /** 测试注入: 位次相关数值生成器. 生产环境默认值较大避开 Designer 0-1000 常用区间. */
  numericGenerator?: () => { listTabIndex: number; zOrderIndex: number; tabindex: number };
}

/** Universal options for `insertFieldIntoKernelXml`. Same shape as
 *  `InsertTextFieldOptions` but the spec is the universal `FieldSpec`. */
export interface InsertFieldOptions {
  spec: FieldSpec;
  idGenerator?: () => string;
  numericGenerator?: () => { listTabIndex: number; zOrderIndex: number; tabindex: number };
}

function defaultIdGenerator(): string {
  return randomUUID().replace(/-/g, '');
}

function defaultNumericGenerator() {
  // listTabIndex / tabindex 是顺序号,给个不和常见字段 (0-1000) 撞的大值
  // 即可,Designer 打开后会自动重整。zOrderIndex 走 BOS Designer 默认值
  // 99,意味着新字段视觉上"叠"在原厂字段同层,用户 F5 后立刻能看到这是
  // 个待处理的新东西,然后手动拖到合适位置。
  return { listTabIndex: 9999, zOrderIndex: 99, tabindex: 9999 };
}

/** Per-type body extras inserted between the universal field body and the
 *  closing tag. Reverse-engineered from real SAL_SaleOrder FKERNELXML
 *  (see memory `bos_field_xml_realities.md`):
 *  - date emits `<EditFormat>` (datetime does not)
 *  - combo/mul_combo wrap items in `<ComboItems><ComboItem>…</ComboItem>…`
 *  - base_data emits `<LookUpObjectID>{guid}</LookUpObjectID>` — the agent
 *    passes a GUID via `spec.refBaseDataObjectKey` (tool layer translates
 *    user-friendly keys like "BD_Customer" to GUIDs before getting here)
 *  - base_property emits `<ControlFieldKey>` (NOT `<SourceField>`!) +
 *    `<SrcDisplayFieldName>` + `<SrcBaseDataDisplayType action="setnull"/>`
 *  - reference_property emits `<ControlFieldKey>` per the same convention */
function renderFieldExtras(type: FieldType, spec: FieldSpec): string {
  const typeSpec = getFieldTypeSpec(type);
  if (typeSpec.dateOnly) {
    return '<EditFormat>yyyy-MM-dd</EditFormat>';
  }
  if (type === 'combo' || type === 'mul_combo') {
    const items = spec.comboItems ?? [];
    const itemsXml = items
      .map(
        (it) =>
          '<ComboItem>' +
          `<Value>${xmlEscape(it.value)}</Value>` +
          `<Caption>${xmlEscape(it.caption)}</Caption>` +
          '</ComboItem>'
      )
      .join('');
    return `<ComboItems>${itemsXml}</ComboItems>`;
  }
  if (type === 'base_data') {
    return `<LookUpObjectID>${xmlEscape(spec.refBaseDataObjectKey ?? '')}</LookUpObjectID>`;
  }
  if (type === 'base_property') {
    return (
      `<ControlFieldKey>${xmlEscape(spec.sourceField ?? '')}</ControlFieldKey>` +
      `<SrcDisplayFieldName>${xmlEscape(spec.srcDisplayFieldName ?? '')}</SrcDisplayFieldName>` +
      '<SrcBaseDataDisplayType action="setnull"/>'
    );
  }
  return '';
}

function renderFieldNode(
  type: FieldType,
  spec: FieldSpec,
  id: string,
  listTabIndex: number
): string {
  const typeSpec = getFieldTypeSpec(type);
  const tag = typeSpec.xmlTag;
  const elementType = typeSpec.elementType;
  const name = spec.name ?? spec.caption;
  const propertyName = spec.propertyName ?? spec.key;
  const fieldName = spec.fieldName ?? spec.key.toUpperCase();
  const extras = renderFieldExtras(type, spec);
  return (
    `<${tag} ElementType="${elementType}" ElementStyle="0">` +
    '<ConditionType>0</ConditionType>' +
    `<PropertyName>${xmlEscape(propertyName)}</PropertyName>` +
    `<FieldName>${xmlEscape(fieldName)}</FieldName>` +
    `<ListTabIndex>${listTabIndex}</ListTabIndex>` +
    `<Name>${xmlEscape(name)}</Name>` +
    `<Id>${xmlEscape(id)}</Id>` +
    `<Key>${xmlEscape(spec.key)}</Key>` +
    extras +
    `</${tag}>`
  );
}

function renderFieldAppearanceNode(
  type: FieldType,
  spec: FieldSpec,
  id: string,
  zOrderIndex: number,
  tabindex: number
): string {
  const typeSpec = getFieldTypeSpec(type);
  const tag = `${typeSpec.xmlTag}Appearance`;
  const elementType = typeSpec.appearanceElementType;
  const container = spec.containerKey ?? 'FTAB_P0';
  const width = spec.width ?? 300;
  const labelWidth = spec.labelWidth ?? 100;
  const top = spec.top ?? 10;
  const left = spec.left ?? 10;
  // CheckBoxFieldAppearance does not have an EmptyText element — no
  // placeholder concept for a yes/no widget. Other types include it
  // ("setnull" = "no placeholder configured"; matches real BOS XML).
  const emptyText = typeSpec.appearanceHasEmptyText
    ? '<EmptyText action="setnull"/>'
    : '';
  return (
    `<${tag} ElementType="${elementType}" ElementStyle="1">` +
    emptyText +
    `<Key>${xmlEscape(spec.key)}</Key>` +
    '<ListDefaultWidth>100</ListDefaultWidth>' +
    `<Container>${xmlEscape(container)}</Container>` +
    `<ZOrderIndex>${zOrderIndex}</ZOrderIndex>` +
    `<Tabindex>${tabindex}</Tabindex>` +
    `<Left>${left}</Left>` +
    `<Top>${top}</Top>` +
    `<LabelWidth>${labelWidth}</LabelWidth>` +
    `<Width>${width}</Width>` +
    '<Visible>1023</Visible>' +
    '<VisibleExt>100</VisibleExt>' +
    `<Caption>${xmlEscape(spec.caption)}</Caption>` +
    `<Id>${xmlEscape(id)}</Id>` +
    `</${tag}>`
  );
}

function validateRequiredExtras(type: FieldType, spec: FieldSpec): void {
  for (const prop of getFieldTypeSpec(type).requiredExtraProps) {
    const v = (spec as unknown as Record<string, unknown>)[prop];
    if (v === undefined || v === null) {
      throw new Error(`field type "${type}" requires spec.${prop}`);
    }
    if (prop === 'comboItems' && Array.isArray(v) && v.length === 0) {
      throw new Error(`field type "${type}" requires non-empty spec.comboItems`);
    }
  }
}

/**
 * 往扩展的 FKERNELXML 里插入一个字段(任意 16 种类型):
 *   - 新的 <{Tag}> 作为 Elements 下 Form 的兄弟节点
 *   - 新的 <{Tag}Appearance> 作为 LayoutInfos/LayoutInfo/Appearances 的子节点
 *
 * 扩展首次加字段时 <LayoutInfos> 整块不存在 —— 此函数会创建。
 * 已有时追加进 Appearances, 不重建 (避免冲掉其他字段的 Appearance).
 */
export function insertFieldIntoKernelXml(
  xml: string,
  type: FieldType,
  options: InsertFieldOptions
): string {
  const { spec } = options;
  if (!spec.key || spec.key.trim() === '') {
    throw new Error('FieldSpec.key must not be empty');
  }
  validateRequiredExtras(type, spec);
  const formCloseIdx = xml.indexOf('</Form>');
  if (formCloseIdx < 0) throw new Error('kernel XML is not an extension (no </Form>)');

  const idGen = options.idGenerator ?? defaultIdGenerator;
  const numGen = options.numericGenerator ?? defaultNumericGenerator;
  const nums = numGen();

  const fieldId = idGen();
  const appearanceId = idGen();

  const fieldXml = renderFieldNode(type, spec, fieldId, nums.listTabIndex);
  const appearanceXml = renderFieldAppearanceNode(
    type,
    spec,
    appearanceId,
    nums.zOrderIndex,
    nums.tabindex
  );

  const afterFormClose = formCloseIdx + '</Form>'.length;
  let out = xml.slice(0, afterFormClose) + fieldXml + xml.slice(afterFormClose);

  const appearancesCloseIdx = out.indexOf('</Appearances>');
  if (appearancesCloseIdx >= 0) {
    out =
      out.slice(0, appearancesCloseIdx) + appearanceXml + out.slice(appearancesCloseIdx);
  } else {
    const layoutOid = randomUUID();
    const layoutInfosBlock =
      '<LayoutInfos>' +
      `<LayoutInfo action="edit" oid="${layoutOid}">` +
      '<Appearances>' +
      appearanceXml +
      '</Appearances>' +
      '</LayoutInfo>' +
      '</LayoutInfos>';
    const metadataCloseIdx = out.indexOf('</FormMetadata>');
    if (metadataCloseIdx < 0) throw new Error('kernel XML has no </FormMetadata> close tag');
    out = out.slice(0, metadataCloseIdx) + layoutInfosBlock + out.slice(metadataCloseIdx);
  }

  return out;
}

/** Back-compat: delegates to `insertFieldIntoKernelXml(xml, 'text', options)`.
 *  Old callers (`bos-writer.ts`, existing tests) keep working unchanged. */
export function insertTextFieldIntoKernelXml(
  xml: string,
  options: InsertTextFieldOptions
): string {
  return insertFieldIntoKernelXml(xml, 'text', options);
}

// ─── Field reading ────────────────────────────────────────────────────

export interface ExtensionFieldMeta {
  /** 表单 Key, 如 'F_DEMO' (BOS Designer 中的"字段标识")。*/
  key: string;
  /** Plan 5.12.1 起识别 16 个 BOS 字段类型。`unknown` 兜底:遇到未来 BOS
   *  新增 / 我们没建模的标签时仍把字段返回(只是 type 不准),agent 闭环
   *  反查至少能确认字段存在。*/
  type: FieldType | 'unknown';
  /** 显示标签;优先取 Appearance 的 Caption,次取 field 节点的 Name。*/
  caption: string;
  propertyName: string;
  fieldName: string;
  /** 布局容器 Key (如 'FTAB_P0'), Appearance 缺失时 undefined。*/
  container: string | undefined;
}

/** Reverse-lookup `xmlTag → FieldType`. Built from `FIELD_TYPE_SPECS` so
 *  registry stays single source of truth. DateTimeField has two members
 *  (`date` and `datetime`) — the parser disambiguates by looking for
 *  `<EditFormat>yyyy-MM-dd</EditFormat>`. We pick `datetime` as the default
 *  here and post-process. */
const FIELD_TAGS = (() => {
  const map: Record<string, FieldType> = {};
  for (const [type, spec] of Object.entries(FIELD_TYPE_SPECS)) {
    // Last write wins is fine — the only collision is DateTimeField,
    // which we resolve below via EditFormat sniffing.
    map[spec.xmlTag] = type as FieldType;
  }
  return map;
})();

/**
 * 解析扩展 FKERNELXML 里的扩展字段定义,识别所有 16 类 BOS 字段。
 * 流程:① 遍历 Elements 直接子级的字段节点 (TextField / IntegerField /
 *      BaseDataField / ... ),按 key → {type, base info} 入 map;
 * ② 在 LayoutInfos/Appearances/<TypeTag>Appearance 里按 Key 配对捞
 *    Caption / Container,以 Appearance 出现顺序为最终输出顺序——这是 BOS
 *    Designer 里用户感知的字段顺序;`insertFieldIntoKernelXml` 把新字段插在
 *    `</Form>` 之后,文档里字段顺序与插入顺序相反,但 Appearance 是追加进
 *    `</Appearances>` 之前,顺序正向。
 * ③ 没有 Appearance 的字段兜底按文档出现顺序追加,保证 parser 不丢字段。
 */
export function parseFieldsFromKernelXml(xml: string): ExtensionFieldMeta[] {
  if (!xml) return [];

  // Step 1: 取 Appearance 的 Key → {caption, container} 映射(保留出现顺序)
  const appearanceByKey = new Map<string, { caption?: string; container?: string }>();
  collectAppearances(xml, appearanceByKey);

  // Step 2: 收所有顶层字段节点的 base info, 按 key → meta 入 map。
  type Base = {
    type: FieldType | 'unknown';
    propertyName: string;
    fieldName: string;
    name: string;
  };
  const baseByKey = new Map<string, Base>();
  const baseOrder: string[] = [];
  type Frame = { tag: string; bodyStart: number; mappedType: FieldType | undefined };
  const stack: Frame[] = [];
  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      stack.push({ tag: tk.tag, bodyStart: tk.end, mappedType: FIELD_TAGS[tk.tag] });
      continue;
    }
    const frame = stack.pop();
    if (!frame || frame.mappedType === undefined) continue;
    // 字段定义节点是 <Elements> 的直接子。任何嵌得更深(LayoutInfos /
    // Appearances / 未来可能的 wrapper)的同名节点都不是字段定义本身。
    const parent = stack[stack.length - 1];
    if (!parent || parent.tag !== 'Elements') continue;
    const body = xml.substring(frame.bodyStart, tk.start);
    const key = findLastTopLevelChildText(body, 'Key');
    if (!key || baseByKey.has(key)) continue;
    // DateTimeField — pick `date` if `<EditFormat>yyyy-MM-dd</EditFormat>` is
    // present, otherwise `datetime`. This is the same marker
    // `renderFieldExtras` emits for the date variant.
    let resolvedType: FieldType = frame.mappedType;
    if (frame.tag === 'DateTimeField') {
      const isDateOnly = /<EditFormat>\s*yyyy-MM-dd\s*<\/EditFormat>/.test(body);
      resolvedType = isDateOnly ? 'date' : 'datetime';
    }
    baseByKey.set(key, {
      type: resolvedType,
      propertyName: findLastTopLevelChildText(body, 'PropertyName') ?? key,
      fieldName: findLastTopLevelChildText(body, 'FieldName') ?? key.toUpperCase(),
      name: findLastTopLevelChildText(body, 'Name') ?? key
    });
    baseOrder.push(key);
  }

  // Step 3: 优先按 Appearance 顺序输出, 没 Appearance 的按字段文档顺序兜底
  const fields: ExtensionFieldMeta[] = [];
  const emitted = new Set<string>();
  const emit = (key: string) => {
    const base = baseByKey.get(key);
    if (!base || emitted.has(key)) return;
    emitted.add(key);
    const app = appearanceByKey.get(key);
    fields.push({
      key,
      type: base.type,
      caption: app?.caption ?? base.name,
      propertyName: base.propertyName,
      fieldName: base.fieldName,
      container: app?.container
    });
  };
  for (const key of appearanceByKey.keys()) emit(key);
  for (const key of baseOrder) emit(key);
  return fields;
}

/** Reverse-lookup tag set: `<{Tag}Appearance>` → owning field type. */
const APPEARANCE_TAGS = new Set(
  Object.values(FIELD_TYPE_SPECS).map((s) => `${s.xmlTag}Appearance`)
);

function collectAppearances(
  xml: string,
  out: Map<string, { caption?: string; container?: string }>
): void {
  type Frame = { tag: string; bodyStart: number; isAppearance: boolean };
  const stack: Frame[] = [];
  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      stack.push({
        tag: tk.tag,
        bodyStart: tk.end,
        isAppearance: APPEARANCE_TAGS.has(tk.tag)
      });
      continue;
    }
    const frame = stack.pop();
    if (!frame || !frame.isAppearance) continue;
    const body = xml.substring(frame.bodyStart, tk.start);
    const key = findLastTopLevelChildText(body, 'Key');
    if (!key) continue;
    out.set(key, {
      caption: findLastTopLevelChildText(body, 'Caption'),
      container: findLastTopLevelChildText(body, 'Container')
    });
  }
}
