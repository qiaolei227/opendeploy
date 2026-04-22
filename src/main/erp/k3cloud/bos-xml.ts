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
