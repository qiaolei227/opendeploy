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
  keyColumn: string
): RowDiffResult {
  const result: RowDiffResult = {
    added: [],
    removed: [],
    modified: [],
    unchanged: [],
    unidentifiable: []
  };

  const keyOf = (r: Record<string, unknown>): string | null => {
    const v = r[keyColumn];
    return v === undefined || v === null ? null : String(v);
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
}

export function formatRowAsTable(row: Record<string, unknown>): string {
  const lines = ['| column | value |', '| --- | --- |'];
  for (const [k, v] of Object.entries(row)) {
    const safeVal = typeof v === 'string' ? v.replace(/\|/g, '\\|') : JSON.stringify(v);
    lines.push(`| ${k} | ${safeVal} |`);
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
