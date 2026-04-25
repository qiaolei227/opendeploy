/**
 * 两 snapshot 的语义 diff + XE trace 对账 + markdown report 生成。
 *
 * - 行级 diff: 按候选键 (通常 FID) 匹配 before/after 行, 排除噪声列做 hash 比较
 * - XML 子树 diff: 专门抽 T_META_OBJECTTYPE.FKERNELXML, 找 before 没 after 有的顶级元素
 * - XE 对账: 每张变化的表, 看 XE trace 里有没有 INSERT/UPDATE/DELETE 该表的语句,
 *   找不到就标 "unexplained"
 * - Markdown 渲染: 单模板拼装
 *
 * 都是纯函数,DB 不进这个文件。
 */

import { createHash } from 'node:crypto';
import { NOISE_COLUMN_BLACKLIST } from './snapshot-all';

export interface RowDiffResult {
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  modified: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  unchanged: Record<string, unknown>[];
  /** Rows with no key column value — can't be matched across snapshots. */
  unidentifiable: Record<string, unknown>[];
}

export function hashRowExcludingNoise(row: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!NOISE_COLUMN_BLACKLIST.includes(k.toUpperCase())) {
      filtered[k] = v;
    }
  }
  // 稳定 JSON (sorted keys) → sha1 hex。
  const keys = Object.keys(filtered).sort();
  const stable = JSON.stringify(keys.map((k) => [k, filtered[k]]));
  return createHash('sha1').update(stable).digest('hex');
}

export function computeTableRowDiff(
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  keyColumn: string | readonly string[]
): RowDiffResult {
  const result: RowDiffResult = {
    added: [],
    removed: [],
    modified: [],
    unchanged: [],
    unidentifiable: []
  };

  // 复合键场景 (1:N 子表): 同一 FOBJECTTYPEID 下 N 行共享外键, 内 PK (FID) 才
  // 区分行。单键 Map 后写覆盖 → 假阳性。改用 `col1\0col2\0...` 作为复合
  // Map key, 任一列缺值即 unidentifiable (不用空串代替, 避免误匹配)。
  const cols = typeof keyColumn === 'string' ? [keyColumn] : keyColumn;
  const keyOf = (r: Record<string, unknown>): string | null => {
    const parts: string[] = [];
    for (const c of cols) {
      const v = r[c];
      if (v === undefined || v === null) return null;
      parts.push(String(v));
    }
    return parts.join('\x00');
  };

  const beforeByKey = new Map<string, Record<string, unknown>>();
  for (const r of before) {
    const k = keyOf(r);
    if (k === null) result.unidentifiable.push(r);
    else beforeByKey.set(k, r);
  }

  const seenAfterKeys = new Set<string>();
  for (const r of after) {
    const k = keyOf(r);
    if (k === null) {
      result.unidentifiable.push(r);
      continue;
    }
    seenAfterKeys.add(k);
    const bRow = beforeByKey.get(k);
    if (!bRow) {
      result.added.push(r);
    } else if (hashRowExcludingNoise(bRow) !== hashRowExcludingNoise(r)) {
      result.modified.push({ before: bRow, after: r });
    } else {
      result.unchanged.push(r);
    }
  }
  for (const [k, r] of beforeByKey) {
    if (!seenAfterKeys.has(k)) result.removed.push(r);
  }
  return result;
}

// ─── XML delta (FKERNELXML 字段级 diff) ──────────────────────────────────────

/**
 * 抽 XML 里的所有 open-tag 签名作 multiset diff。
 *
 * 签名形式 `<TagName attr1="v1" attr2="v2">` (属性按 key 排序, 跳过 self-close
 * 斜杠以免 <A/> 和 <A> 算不同签名)。before/after 同签名的计数差决定 added /
 * removed, 更大比当前"顶级标签名集合"(23 个 tag atoms, 没属性) 有信息量:
 * 现在能看到 `<TextFieldAppearance ElementType="1" ElementStyle="1">` 这种
 * 带属性的元素被加进去, 而不仅仅"TextFieldAppearance 这个 tag 第一次出现"。
 *
 * 限制: 不抽 `<Key>FXXX</Key>` 这种 inner-text 作签名 (K/3 Cloud 的 Key/Id 大
 * 多是子元素不是属性); 精确到"带属性的 tag 层级"已经比旧版好 10x, 但仍是
 * 粗粒度 diff, 精细到 innerText 留 Phase 2。
 */
const OPEN_TAG_RE = /<([A-Za-z_][\w.\-]*)([^>]*?)\s*\/?>/g;
const ATTR_RE = /([A-Za-z_][\w.\-]*)\s*=\s*"([^"]*)"/g;

function signatureOf(tagName: string, attrRaw: string): string {
  const pairs: Array<[string, string]> = [];
  for (const m of attrRaw.matchAll(ATTR_RE)) pairs.push([m[1], m[2]]);
  if (pairs.length === 0) return `<${tagName}>`;
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const attrStr = pairs.map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<${tagName} ${attrStr}>`;
}

function collectSignatures(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of xml.matchAll(OPEN_TAG_RE)) {
    // 跳过 closing tag (</X>), 不会出现(因为正则 [A-Za-z_] 要求首字母字母/下划线)
    // 但 comments <!-- ... --> 和 CDATA <![...]]> 起始是 `<!`, 也被首字母规则排除。
    const sig = signatureOf(m[1], m[2]);
    out.set(sig, (out.get(sig) ?? 0) + 1);
  }
  return out;
}

export interface XmlDelta {
  addedElements: string[];
  removedElements: string[];
}

export function buildXmlDelta(before: string, after: string): XmlDelta {
  const beforeMS = collectSignatures(before);
  const afterMS = collectSignatures(after);
  const added: string[] = [];
  const removed: string[] = [];
  const allSigs = new Set([...beforeMS.keys(), ...afterMS.keys()]);
  for (const sig of allSigs) {
    const delta = (afterMS.get(sig) ?? 0) - (beforeMS.get(sig) ?? 0);
    if (delta > 0) for (let i = 0; i < delta; i++) added.push(sig);
    else if (delta < 0) for (let i = 0; i < -delta; i++) removed.push(sig);
  }
  return { addedElements: added, removedElements: removed };
}

// ─── Markdown report ──────────────────────────────────────────────

export interface ReportInput {
  label: string;
  extId: string;
  beforeJsonPath: string;
  afterJsonPath: string;
  xelPath: string;
  tableChanges: Array<{
    tableName: string;
    added: number;
    removed: number;
    modified: number;
  }>;
  xmlChanges: Array<{
    table: string;
    column: string;
    addedElements: string[];
    removedElements: string[];
  }>;
  xeEvents: number;
  unexplained: string[];
  /** 无法按候选键识别的行数 (before + after 合计)。renderReportMarkdown 顶部警告。 */
  unidentifiableCount?: number;
}

/**
 * Markdown 表格单元格要躲两类字符:
 *   1. `|` —— 结构字符, 转义成 `\|`
 *   2. 换行 (\n / \r\n) —— markdown 表格是行基的, 裸换行会把一个 cell 拆成多行
 *      破坏表格结构。FKERNELXML 等多行字段会踩到, 用 <br> 替换
 */
function escapeTableCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function formatRowAsTable(row: Record<string, unknown>): string {
  const lines = ['| column | value |', '| --- | --- |'];
  for (const [k, v] of Object.entries(row)) {
    const raw = typeof v === 'string' ? v : JSON.stringify(v);
    lines.push(`| ${k} | ${escapeTableCell(raw)} |`);
  }
  return lines.join('\n');
}

export function renderReportMarkdown(input: ReportInput): string {
  const sections: string[] = [];
  sections.push(`# Recon report: ${input.label}`);
  sections.push('');
  sections.push(`**Extension FID:** \`${input.extId}\`  `);
  sections.push(`**Before snapshot:** \`${input.beforeJsonPath}\`  `);
  sections.push(`**After snapshot:** \`${input.afterJsonPath}\`  `);
  sections.push(`**XE trace:** \`${input.xelPath}\` (${input.xeEvents} events)`);
  sections.push('');

  if (input.unidentifiableCount && input.unidentifiableCount > 0) {
    sections.push(
      `> ⚠ ${input.unidentifiableCount} row(s) had no resolvable key column — ` +
        `excluded from add/remove/modify buckets. Schema drift on a new table?`
    );
    sections.push('');
  }

  if (input.unexplained.length > 0) {
    sections.push('## ⚠ Unexplained changes');
    sections.push('');
    sections.push(
      'These snapshot diffs could not be explained by any SQL in the XE trace — '
        + 'possibly BOS Designer routes them through a backend service. Investigate before '
        + 'shipping a writer.'
    );
    sections.push('');
    for (const u of input.unexplained) sections.push(`- ${u}`);
    sections.push('');
  }

  sections.push('## Changed tables');
  sections.push('');
  if (input.tableChanges.length === 0) {
    sections.push('_No table-level changes detected._');
  } else {
    sections.push('| table | + | − | ~ |');
    sections.push('| --- | --- | --- | --- |');
    for (const t of input.tableChanges) {
      sections.push(`| \`${t.tableName}\` | ${t.added} | ${t.removed} | ${t.modified} |`);
    }
  }
  sections.push('');

  sections.push('## FKERNELXML diff');
  sections.push('');
  if (input.xmlChanges.length === 0) {
    sections.push('_No FKERNELXML changes._');
  } else {
    for (const x of input.xmlChanges) {
      sections.push(`### ${x.table}.${x.column}`);
      if (x.addedElements.length > 0) {
        sections.push('');
        sections.push('**Added elements:**');
        sections.push('');
        for (const el of x.addedElements) sections.push(`- \`${el}\``);
      }
      if (x.removedElements.length > 0) {
        sections.push('');
        sections.push('**Removed elements:**');
        sections.push('');
        for (const el of x.removedElements) sections.push(`- \`${el}\``);
      }
      sections.push('');
    }
  }

  sections.push('## XE SQL trace');
  sections.push('');
  sections.push(`See \`${input.xelPath}\` and its parsed \`${input.label}-trace.json\`.`);
  sections.push(`Total normalized events: **${input.xeEvents}**`);

  return sections.join('\n');
}
