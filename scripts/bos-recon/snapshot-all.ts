/**
 * 广撒网 snapshot —— 扫所有 T_META_* 表, 每张按"首个可用候选键列"过滤到
 * 给定扩展 FID, 把匹配的行 dump 到 JSON。
 *
 * 候选键优先级 (由 BOS 表设计规律归纳, spec §4.1 + bos-backup.ts 已有
 * 8 张表的经验):
 *   1. FID            主键, 大多数 T_META_OBJECTTYPE* 走这个
 *   2. FOBJECTTYPEID  外键指向扩展, TRACKERBILLTABLE / OBJECTTYPEREF 走这个
 *   3. FBILLFORMID    字段 / 控件表可能用这个名
 *   4. FENTRYID       OBJECTTYPENAMEEX* 走这个 (同 FID 但字段名不同)
 *   5. FBASEOBJECTID  指向父单据的外键, 预留候选
 */

import sql from 'mssql';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export const CANDIDATE_KEY_COLUMNS: readonly string[] = [
  'FID',
  'FOBJECTTYPEID',
  'FBILLFORMID',
  'FENTRYID',
  'FBASEOBJECTID'
] as const;

/** 这些列几乎每次读都会变,diff 阶段直接剔除,减少噪声。 */
export const NOISE_COLUMN_BLACKLIST: readonly string[] = [
  'FMODIFYDATE',
  'FCREATEDATE',
  'FMODIFIERID',
  'FCOMPUTERINFO',
  'FVERSION',
  'FMAINVERSION'
] as const;

function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name);
}

/**
 * 已知扩展表的"链接列"硬覆盖映射 —— mirror src/main/erp/k3cloud/bos-backup.ts 的 KEY_COLUMN。
 *
 * 为什么需要: 有些表(T_META_TRACKERBILLTABLE / T_META_OBJECTTYPEREF)同时有 FID
 * 和 FOBJECTTYPEID, 但 FID 是该行自己的主键(不是扩展 FID), FOBJECTTYPEID 才是
 * 指向扩展的外键。纯 candidate-key 启发式会挑 FID → 0 行 → 误归 emptyTables。
 *
 * 对不在此映射里的表(新发现的 T_META_*), 回退到 pickMatchingKeyColumn 启发式。
 */
export const KNOWN_EXTENSION_LINK: Record<string, string> = {
  T_META_OBJECTTYPE: 'FID',
  T_META_OBJECTTYPE_L: 'FID',
  T_META_OBJECTTYPE_E: 'FID',
  T_META_OBJECTTYPENAMEEX: 'FENTRYID',
  T_META_OBJECTTYPENAMEEX_L: 'FENTRYID',
  T_META_OBJECTFUNCINTERFACE: 'FID',
  T_META_OBJECTTYPEREF: 'FOBJECTTYPEID',
  T_META_TRACKERBILLTABLE: 'FOBJECTTYPEID'
};

export function pickMatchingKeyColumn(columns: string[]): string | null {
  const set = new Set(columns.map((c) => c.toUpperCase()));
  for (const candidate of CANDIDATE_KEY_COLUMNS) {
    if (set.has(candidate)) return candidate;
  }
  return null;
}

/**
 * 优先用已知映射, fallback 启发式。只对本表 columns 里真的存在的列才接受映射
 * 值, 防止 schema drift 时误用一个已经不存在的列名。
 */
export function pickKeyForTable(tableName: string, columns: string[]): string | null {
  const override = KNOWN_EXTENSION_LINK[tableName];
  if (override) {
    const upperCols = new Set(columns.map((c) => c.toUpperCase()));
    if (upperCols.has(override)) return override;
  }
  return pickMatchingKeyColumn(columns);
}

export function buildSnapshotSelectSQL(tableName: string, keyColumn: string): string {
  if (!isSafeIdentifier(tableName)) throw new Error(`unsafe table name: ${tableName}`);
  if (!isSafeIdentifier(keyColumn)) throw new Error(`unsafe column name: ${keyColumn}`);
  return `SELECT * FROM ${tableName} WHERE ${keyColumn} = @v`;
}

const LIST_META_TABLES_SQL = `
  SELECT name FROM sys.tables WHERE name LIKE 'T_META[_]%' ORDER BY name
`;

const LIST_COLS_SQL = `
  SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(@t) ORDER BY column_id
`;

/** Binary → 长度 marker,避免 JSON 爆炸 (沿用 bos-backup.stripBinary 的形状)。 */
function stripBinary(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) out[k] = { __binary: true, bytes: v.length };
    else out[k] = v;
  }
  return out;
}

export interface SnapshotResult {
  /** 扫的 T_META_* 总表数 */
  scannedTables: number;
  /** 没有任何候选键列的表 (跳过, 计入 unmatched) */
  unmatchedTables: string[];
  /** 有候选键但对给定 extId 无行的表 */
  emptyTables: string[];
  /**
   * 查询时 SQL Server 报错的表。常见: 该表的候选键列是 int 类型, 而
   * extId 是 GUID 字符串, 类型不兼容。这类表不是扩展元数据表, 跳过
   * 不影响侦察精度。
   */
  errorTables: Array<{ table: string; reason: string }>;
  /** 有行的表, key = 表名, value = 行数组 */
  tables: Record<string, Record<string, unknown>[]>;
}

export async function snapshotAllMeta(
  pool: sql.ConnectionPool,
  extId: string
): Promise<SnapshotResult> {
  const tablesRes = await pool.request().query<{ name: string }>(LIST_META_TABLES_SQL);
  const allTables = tablesRes.recordset.map((r) => r.name);

  const unmatchedTables: string[] = [];
  const emptyTables: string[] = [];
  const errorTables: Array<{ table: string; reason: string }> = [];
  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const tableName of allTables) {
    const colsRes = await pool
      .request()
      .input('t', sql.VarChar(128), tableName)
      .query<{ name: string }>(LIST_COLS_SQL);
    const columns = colsRes.recordset.map((r) => r.name);
    const keyColumn = pickKeyForTable(tableName, columns);

    if (keyColumn === null) {
      unmatchedTables.push(tableName);
      continue;
    }

    const selectSQL = buildSnapshotSelectSQL(tableName, keyColumn);
    try {
      const rows = await pool
        .request()
        .input('v', sql.VarChar(64), extId)
        .query<Record<string, unknown>>(selectSQL);

      if (rows.recordset.length === 0) {
        emptyTables.push(tableName);
      } else {
        tables[tableName] = rows.recordset.map(stripBinary);
      }
    } catch (err) {
      // 典型: 某 T_META_X 的 FID 是 int 类型而 extId 是 GUID,
      // SQL Server type conversion 失败。这些表不是扩展元数据表, 跳过。
      errorTables.push({
        table: tableName,
        reason: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    scannedTables: allTables.length,
    unmatchedTables,
    emptyTables,
    errorTables,
    tables
  };
}

export async function writeSnapshotJson(
  outputDir: string,
  label: string,
  which: 'before' | 'after',
  snapshot: SnapshotResult
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${label}-${which}.json`);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return filePath;
}
