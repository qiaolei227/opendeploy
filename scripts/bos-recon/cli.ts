/**
 * bos-recon CLI — 开发环境 BOS 侦察工具链入口。
 *
 * 用法: pnpm recon:<subcommand> -- --project <pid> [--ext-id <fid>] [--label <label>]
 *
 * 所有 subcommand 共享 --project (必填) 和 --label (默认 'default')。
 * snapshot-before / snapshot-after 额外要 --ext-id。
 * diff 只需要 --label (从 output 目录读已有 JSON/.xel)。
 */

import sql from 'mssql';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { loadSettings, resolveProjectConfig } from './config';
import {
  buildCreateSessionSQL,
  buildDropSessionSQL,
  buildReadXelFileSQL,
  buildStartSessionSQL,
  buildStopSessionSQL
} from './xe-session';
import { normalizeEvents, parseXelEventXml, type XeEvent } from './xe-parse';
import {
  snapshotAllMeta,
  writeSnapshotJson,
  pickKeyForDiff,
  type SnapshotResult
} from './snapshot-all';
import {
  computeTableRowDiff,
  buildXmlDelta,
  renderReportMarkdown,
  type ReportInput
} from './diff';

const SESSION_NAME = 'opendeploy_bos_recon';
// 相对 import.meta.url (这个文件在 scripts/bos-recon/ 下), 不依赖 cwd ——
// 从 repo 根 / 从 scripts 子目录跑 / 从 tsx 跑, 都落到同一 output 路径。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(HERE, 'output');

type Subcommand =
  | 'snapshot-before'
  | 'xe-start'
  | 'xe-stop'
  | 'snapshot-after'
  | 'diff';

const KNOWN: readonly Subcommand[] = [
  'snapshot-before',
  'xe-start',
  'xe-stop',
  'snapshot-after',
  'diff'
] as const;

function isSubcommand(s: string): s is Subcommand {
  return (KNOWN as readonly string[]).includes(s);
}

interface CliArgs {
  project?: string;
  extId?: string;
  label: string;
  xelAbsPath?: string;
  /** xe-start 专用: sqlserver.client_app_name LIKE 模式, 例 `%Kingdee%`。降噪关键选项。 */
  filterApp?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { label: 'default' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a === '--ext-id') out.extId = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (a === '--xel-path') out.xelAbsPath = argv[++i];
    else if (a === '--filter-app') out.filterApp = argv[++i];
  }
  return out;
}

function requireArg<K extends keyof CliArgs>(
  args: CliArgs,
  key: K,
  sub: Subcommand
): NonNullable<CliArgs[K]> {
  const v = args[key];
  if (v === undefined || v === '') {
    throw new Error(`[bos-recon ${sub}] missing required --${String(key)}`);
  }
  return v as NonNullable<CliArgs[K]>;
}

async function connect(projectId: string): Promise<sql.ConnectionPool> {
  const settings = await loadSettings();
  const cfg = resolveProjectConfig(settings, projectId);
  const pool = new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: cfg.options
  });
  await pool.connect();
  return pool;
}

function xelPathFor(label: string): string {
  return path.join(OUTPUT_DIR, `${label}-trace.xel`);
}

// ─── subcommands ──────────────────────────────────────────────

async function cmdSnapshotBefore(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'snapshot-before');
  const extId = requireArg(args, 'extId', 'snapshot-before');
  const pool = await connect(project);
  try {
    const snap = await snapshotAllMeta(pool, extId);
    const out = await writeSnapshotJson(OUTPUT_DIR, args.label, 'before', snap);
    console.log(`[bos-recon] before snapshot: ${out}`);
    console.log(
      `           scanned=${snap.scannedTables} unmatched=${snap.unmatchedTables.length} ` +
      `empty=${snap.emptyTables.length} error=${snap.errorTables.length} ` +
      `hit=${Object.keys(snap.tables).length}`
    );
  } finally {
    await pool.close();
  }
}

async function cmdSnapshotAfter(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'snapshot-after');
  const extId = requireArg(args, 'extId', 'snapshot-after');
  const pool = await connect(project);
  try {
    const snap = await snapshotAllMeta(pool, extId);
    const out = await writeSnapshotJson(OUTPUT_DIR, args.label, 'after', snap);
    console.log(`[bos-recon] after snapshot: ${out}`);
    console.log(
      `           scanned=${snap.scannedTables} unmatched=${snap.unmatchedTables.length} ` +
      `empty=${snap.emptyTables.length} error=${snap.errorTables.length} ` +
      `hit=${Object.keys(snap.tables).length}`
    );
  } finally {
    await pool.close();
  }
}

async function cmdXeStart(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'xe-start');
  await mkdir(OUTPUT_DIR, { recursive: true });
  const xelPath = args.xelAbsPath ?? xelPathFor(args.label);
  const pool = await connect(project);
  try {
    // 幂等 drop 再 create, 防止上次跑崩残留。
    await pool.request().batch(buildDropSessionSQL(SESSION_NAME));
    await pool
      .request()
      .batch(
        buildCreateSessionSQL({ sessionName: SESSION_NAME, xelPath, filterClientApp: args.filterApp })
      );
    await pool.request().batch(buildStartSessionSQL(SESSION_NAME));
    console.log(`[bos-recon] XE session "${SESSION_NAME}" started, target=${xelPath}`);
    if (args.filterApp) {
      console.log(`           filter: client_app_name LIKE '${args.filterApp}'`);
    } else {
      console.log(
        `           (无 app filter, 全 session trace) — 可 --filter-app '%Kingdee%' 降噪`
      );
    }
    console.log(`           → 现在去 BOS Designer 做你要侦察的操作, 完了跑 pnpm recon:xe-stop`);
  } finally {
    await pool.close();
  }
}

async function cmdXeStop(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'xe-stop');
  const xelPath = args.xelAbsPath ?? xelPathFor(args.label);
  // SQL Server event_file target 实际产出文件名会加 rollover 后缀
  // `_<N>_<ticks>.xel`, 不是我们传进去的 filename 原样。读时要用通配
  // 符 pattern 匹配所有 rollover 文件 —— fn_xe_file_target_read_file
  // 支持 * wildcard。
  const xelReadPattern = xelPath.replace(/\.xel$/, '*.xel');
  const pool = await connect(project);
  try {
    await pool.request().batch(buildStopSessionSQL(SESSION_NAME));
    // 等 buffer flush。XE session 建时 MAX_DISPATCH_LATENCY=5s, 取 3s
    // 给中间值 —— 正常单次保存的场景足够, 极端情况最多漏一批事件后再补跑。
    await new Promise((r) => setTimeout(r, 3000));

    const readSql = buildReadXelFileSQL(xelReadPattern);
    const res = await pool.request().query<{ event_xml: string }>(readSql);
    const rawEvents: XeEvent[] = [];
    for (const row of res.recordset) {
      const e = parseXelEventXml(row.event_xml);
      if (e) rawEvents.push(e);
    }
    const events = normalizeEvents(rawEvents);

    const jsonPath = path.join(OUTPUT_DIR, `${args.label}-trace.json`);
    await writeFile(jsonPath, JSON.stringify(events, null, 2), 'utf-8');

    // Session 不 drop, 下次 xe-start 会幂等处理。
    console.log(`[bos-recon] XE stopped, ${events.length} events → ${jsonPath}`);
  } finally {
    await pool.close();
  }
}

async function cmdDiff(args: CliArgs): Promise<void> {
  const beforePath = path.join(OUTPUT_DIR, `${args.label}-before.json`);
  const afterPath = path.join(OUTPUT_DIR, `${args.label}-after.json`);
  const tracePath = path.join(OUTPUT_DIR, `${args.label}-trace.json`);
  const xelPath = xelPathFor(args.label);

  const before: SnapshotResult = JSON.parse(await readFile(beforePath, 'utf-8'));
  const after: SnapshotResult = JSON.parse(await readFile(afterPath, 'utf-8'));
  let trace: XeEvent[] = [];
  try {
    trace = JSON.parse(await readFile(tracePath, 'utf-8'));
  } catch {
    console.warn(`[bos-recon] no XE trace at ${tracePath} — report will omit XE section`);
  }

  // 所有 union 的表名。
  const allTables = new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]);
  const tableChanges: ReportInput['tableChanges'] = [];
  const unexplained: string[] = [];
  let unidentifiableCount = 0;

  for (const tableName of allTables) {
    const b = before.tables[tableName] ?? [];
    const a = after.tables[tableName] ?? [];
    // 用 snapshot-all 的 pickKeyForTable —— 和 snapshot 阶段挑键列保持一致,
    // 避免 TRACKERBILLTABLE / OBJECTTYPEREF 等表被启发式错选 FID (行自己的 PK
    // 不是扩展外键)。先从 after (一般行更完整) 的首行拿列清单, 空则退 before。
    const sampleRow = a[0] ?? b[0] ?? {};
    const cols = Object.keys(sampleRow);
    // pickKeyForDiff: 对 1:N 子表 (OBJECTTYPEREF / TRACKERBILLTABLE) 返回
    // [外键, 内 PK] 复合键, 避免多行共享 FOBJECTTYPEID 时单键 Map 后写覆盖
    // 导致整批行假阳性。
    const keyCol = pickKeyForDiff(tableName, cols);
    if (!keyCol) continue;
    const d = computeTableRowDiff(b, a, keyCol);
    unidentifiableCount += d.unidentifiable.length;
    const added = d.added.length;
    const removed = d.removed.length;
    const modified = d.modified.length;
    if (added + removed + modified > 0) {
      tableChanges.push({ tableName, added, removed, modified });
      // XE 对账: 找 trace 里有没有提到此表名的 SQL。
      const mentioned = trace.some((e) =>
        e.stmt.toUpperCase().includes(tableName.toUpperCase())
      );
      if (!mentioned) {
        unexplained.push(
          `${tableName}: ${added} added / ${removed} removed / ${modified} modified — ` +
            `no XE event references this table name`
        );
      }
    }
  }

  // FKERNELXML 字段级 diff —— buildXmlDelta 按带属性 open-tag 签名多重集 diff,
  // 比老版纯顶级标签名集合有信息量 (能区分 <TextField Key="F1"> vs "F2")。
  const xmlChanges: ReportInput['xmlChanges'] = [];
  const bKernel = (before.tables.T_META_OBJECTTYPE ?? [])[0]?.FKERNELXML as string | undefined;
  const aKernel = (after.tables.T_META_OBJECTTYPE ?? [])[0]?.FKERNELXML as string | undefined;
  if (bKernel && aKernel && bKernel !== aKernel) {
    const delta = buildXmlDelta(bKernel, aKernel);
    if (delta.addedElements.length > 0 || delta.removedElements.length > 0) {
      xmlChanges.push({
        table: 'T_META_OBJECTTYPE',
        column: 'FKERNELXML',
        addedElements: delta.addedElements,
        removedElements: delta.removedElements
      });
    }
  }

  // extId 粗略从 T_META_OBJECTTYPE 行拿。
  const extId =
    ((after.tables.T_META_OBJECTTYPE ?? [])[0]?.FID as string | undefined) ?? '(unknown)';

  const md = renderReportMarkdown({
    label: args.label,
    extId,
    beforeJsonPath: path.basename(beforePath),
    afterJsonPath: path.basename(afterPath),
    xelPath: path.basename(xelPath),
    tableChanges,
    xmlChanges,
    xeEvents: trace.length,
    unexplained,
    unidentifiableCount
  });

  const reportPath = path.join(OUTPUT_DIR, `${args.label}-report.md`);
  await writeFile(reportPath, md, 'utf-8');
  console.log(`[bos-recon] report → ${reportPath}`);
  console.log(
    `           tables changed: ${tableChanges.length}, unexplained: ${unexplained.length}, ` +
      `unidentifiable rows: ${unidentifiableCount}`
  );
}

// ─── main ──────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  if (!sub || !isSubcommand(sub)) {
    console.error(
      `usage: pnpm recon:<subcommand> -- --project <pid> [--ext-id <fid>] [--label <label>]\n` +
        `  subcommands: ${KNOWN.join(' / ')}`
    );
    process.exit(2);
  }
  const args = parseArgs(rest);
  switch (sub) {
    case 'snapshot-before':
      return cmdSnapshotBefore(args);
    case 'xe-start':
      return cmdXeStart(args);
    case 'xe-stop':
      return cmdXeStop(args);
    case 'snapshot-after':
      return cmdSnapshotAfter(args);
    case 'diff':
      return cmdDiff(args);
  }
}

main().catch((err) => {
  console.error('[bos-recon] error:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
