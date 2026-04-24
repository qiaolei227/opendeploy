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
}

export interface InsertTextFieldOptions {
  spec: TextFieldSpec;
  /** 测试注入: 32-char GUID (无 dash) 生成器. 默认用 randomUUID stripped. */
  idGenerator?: () => string;
  /** 测试注入: 位次相关数值生成器. 生产环境默认值较大避开 Designer 0-1000 常用区间. */
  numericGenerator?: () => { listTabIndex: number; zOrderIndex: number; tabindex: number };
}

function defaultIdGenerator(): string {
  return randomUUID().replace(/-/g, '');
}

function defaultNumericGenerator() {
  // 加字段的 位次 在客户 Designer 打开后会被自动重整,这里只要给个不和
  // 常见字段 (0-1000) 撞的大值。
  return { listTabIndex: 9999, zOrderIndex: 99, tabindex: 9999 };
}

function renderTextFieldNode(spec: TextFieldSpec, id: string, listTabIndex: number): string {
  const name = spec.name ?? spec.caption;
  const propertyName = spec.propertyName ?? spec.key;
  const fieldName = spec.fieldName ?? spec.key.toUpperCase();
  return (
    '<TextField ElementType="1" ElementStyle="0">' +
    '<ConditionType>0</ConditionType>' +
    `<PropertyName>${xmlEscape(propertyName)}</PropertyName>` +
    `<FieldName>${xmlEscape(fieldName)}</FieldName>` +
    `<ListTabIndex>${listTabIndex}</ListTabIndex>` +
    `<Name>${xmlEscape(name)}</Name>` +
    `<Id>${xmlEscape(id)}</Id>` +
    `<Key>${xmlEscape(spec.key)}</Key>` +
    '</TextField>'
  );
}

function renderTextFieldAppearanceNode(
  spec: TextFieldSpec,
  id: string,
  zOrderIndex: number,
  tabindex: number
): string {
  const container = spec.containerKey ?? 'FTAB_P0';
  const width = spec.width ?? 300;
  const labelWidth = spec.labelWidth ?? 100;
  return (
    '<TextFieldAppearance ElementType="1" ElementStyle="1">' +
    '<EmptyText action="setnull"/>' +
    `<Key>${xmlEscape(spec.key)}</Key>` +
    '<ListDefaultWidth>100</ListDefaultWidth>' +
    `<Container>${xmlEscape(container)}</Container>` +
    `<ZOrderIndex>${zOrderIndex}</ZOrderIndex>` +
    `<Tabindex>${tabindex}</Tabindex>` +
    '<Left>10</Left>' +
    '<Top>10</Top>' +
    `<LabelWidth>${labelWidth}</LabelWidth>` +
    `<Width>${width}</Width>` +
    '<Visible>1023</Visible>' +
    '<VisibleExt>100</VisibleExt>' +
    `<Caption>${xmlEscape(spec.caption)}</Caption>` +
    `<Id>${xmlEscape(id)}</Id>` +
    '</TextFieldAppearance>'
  );
}

/**
 * 往扩展的 FKERNELXML 里插入一个文本字段:
 *   - 新的 <TextField> 作为 Elements 下 Form 的兄弟节点
 *   - 新的 <TextFieldAppearance> 作为 LayoutInfos/LayoutInfo/Appearances 的子节点
 *
 * 扩展首次加字段时 <LayoutInfos> 整块不存在 —— 此函数会创建。
 * 已有时追加进 Appearances, 不重建 (避免冲掉其他字段的 Appearance).
 */
export function insertTextFieldIntoKernelXml(
  xml: string,
  options: InsertTextFieldOptions
): string {
  const { spec } = options;
  if (!spec.key || spec.key.trim() === '') {
    throw new Error('TextFieldSpec.key must not be empty');
  }
  const formCloseIdx = xml.indexOf('</Form>');
  if (formCloseIdx < 0) throw new Error('kernel XML is not an extension (no </Form>)');

  const idGen = options.idGenerator ?? defaultIdGenerator;
  const numGen = options.numericGenerator ?? defaultNumericGenerator;
  const nums = numGen();

  const textFieldId = idGen();
  const appearanceId = idGen();

  const textFieldXml = renderTextFieldNode(spec, textFieldId, nums.listTabIndex);
  const appearanceXml = renderTextFieldAppearanceNode(
    spec,
    appearanceId,
    nums.zOrderIndex,
    nums.tabindex
  );

  // Step 1: 插 TextField 到 </Form> 之后
  const afterFormClose = formCloseIdx + '</Form>'.length;
  let out = xml.slice(0, afterFormClose) + textFieldXml + xml.slice(afterFormClose);

  // Step 2: 处理 LayoutInfos
  const appearancesCloseIdx = out.indexOf('</Appearances>');
  if (appearancesCloseIdx >= 0) {
    // 已有 LayoutInfos + Appearances, 追加 TextFieldAppearance
    out =
      out.slice(0, appearancesCloseIdx) + appearanceXml + out.slice(appearancesCloseIdx);
  } else {
    // 没有 LayoutInfos, 创建整块 (含一个 LayoutInfo 新 oid)
    const layoutOid = randomUUID(); // 保留 dash, 和实测 XML 一致
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

// ─── Field reading ────────────────────────────────────────────────────

export interface ExtensionFieldMeta {
  /** 表单 Key, 如 'F_DEMO' (BOS Designer 中的"字段标识")。*/
  key: string;
  /** v0.1 只解析 TextField → 'text';后续支持其他类型时此处分支。*/
  type: 'text';
  /** 显示标签;优先取 Appearance 的 Caption,次取 TextField 的 Name。*/
  caption: string;
  propertyName: string;
  fieldName: string;
  /** 布局容器 Key (如 'FTAB_P0'), Appearance 缺失时 undefined。*/
  container: string | undefined;
}

/**
 * 解析扩展 FKERNELXML 里的扩展字段定义(目前只识别 <TextField>)。
 * 流程:① 遍历 Elements 直接子级的 <TextField> 收 base info(按 key 入 map);
 * ② 在 LayoutInfos/Appearances/TextFieldAppearance 里按 Key 配对捞 Caption / Container,
 *    并以 Appearance 出现顺序作为最终输出顺序——这是 BOS Designer 里用户感知的字段顺序;
 *    `insertTextFieldIntoKernelXml` 把新 TextField 插在 `</Form>` 之后, 文档里 TextField
 *    顺序与插入顺序相反, 但 Appearance 是追加进 `</Appearances>` 之前, 顺序正向。
 * ③ 没有 Appearance 的 TextField 兜底按文档出现顺序追加, 保证 parser 不丢字段。
 */
export function parseFieldsFromKernelXml(xml: string): ExtensionFieldMeta[] {
  if (!xml) return [];

  // Step 1: 取 Appearance 的 Key → {caption, container} 映射(保留出现顺序)
  const appearanceByKey = new Map<string, { caption?: string; container?: string }>();
  collectAppearances(xml, appearanceByKey);

  // Step 2: 收所有顶层 <TextField> 的 base info, 按 key → meta(无 caption/container)入 map
  type Base = { propertyName: string; fieldName: string; name: string };
  const baseByKey = new Map<string, Base>();
  const baseOrder: string[] = []; // 文档出现顺序, 兜底用
  type Frame = { tag: string; bodyStart: number; isTextField: boolean };
  const stack: Frame[] = [];
  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      stack.push({ tag: tk.tag, bodyStart: tk.end, isTextField: tk.tag === 'TextField' });
      continue;
    }
    const frame = stack.pop();
    if (!frame || !frame.isTextField) continue;
    // 嵌在 LayoutInfos / Appearances 下的 <TextField> 不算字段定义本身。
    if (stack.some((f) => f.tag === 'LayoutInfos' || f.tag === 'Appearances')) continue;
    const body = xml.substring(frame.bodyStart, tk.start);
    const key = findLastTopLevelChildText(body, 'Key');
    if (!key || baseByKey.has(key)) continue;
    baseByKey.set(key, {
      propertyName: findLastTopLevelChildText(body, 'PropertyName') ?? key,
      fieldName: findLastTopLevelChildText(body, 'FieldName') ?? key.toUpperCase(),
      name: findLastTopLevelChildText(body, 'Name') ?? key
    });
    baseOrder.push(key);
  }

  // Step 3: 优先按 Appearance 顺序输出, 没 Appearance 的按 TextField 文档顺序兜底
  const fields: ExtensionFieldMeta[] = [];
  const emitted = new Set<string>();
  const emit = (key: string) => {
    const base = baseByKey.get(key);
    if (!base || emitted.has(key)) return;
    emitted.add(key);
    const app = appearanceByKey.get(key);
    fields.push({
      key,
      type: 'text',
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

function collectAppearances(
  xml: string,
  out: Map<string, { caption?: string; container?: string }>
): void {
  type Frame = { tag: string; bodyStart: number; isTextFieldAppearance: boolean };
  const stack: Frame[] = [];
  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      stack.push({
        tag: tk.tag,
        bodyStart: tk.end,
        isTextFieldAppearance: tk.tag === 'TextFieldAppearance'
      });
      continue;
    }
    const frame = stack.pop();
    if (!frame || !frame.isTextFieldAppearance) continue;
    const body = xml.substring(frame.bodyStart, tk.start);
    const key = findLastTopLevelChildText(body, 'Key');
    if (!key) continue;
    out.set(key, {
      caption: findLastTopLevelChildText(body, 'Caption'),
      container: findLastTopLevelChildText(body, 'Container')
    });
  }
}
