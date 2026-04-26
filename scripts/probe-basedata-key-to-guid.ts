/**
 * Probe: 给 LookUpObjectID GUID, 反查它对应的 base-data key (FID like "BD_Customer").
 *
 * Discovery summary (2026-04-26):
 *   - SAL_SaleOrder FKERNELXML 有 34 个 distinct LookUpObjectID GUID.
 *   - GUID 不在 T_META_OBJECTTYPE 任何列里 (扫了全部 17 列).
 *   - 全库 T_META_/T_BAS_ 文本列扫描: 31/34 命中 [T_META_LOOKUPCLASS].[FID].
 *   - T_META_LOOKUPCLASS schema (12 列): FID(GUID) | FFORMID(key) | FTABLENAME |
 *     FPKFIELDNAME | FNUMBERFIELDNAME | FNAMEFIELDNAME | FORGFIELDNAME | etc.
 *   - 即 GUID = T_META_LOOKUPCLASS.FID, key = T_META_LOOKUPCLASS.FFORMID.
 *   - 单步 SQL: SELECT FID FROM T_META_LOOKUPCLASS WHERE FFORMID = @key.
 *
 * 这个脚本固化结论 — 双向验证 + 1:1 唯一性 + 标准 SQL 输出.
 */

import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

const COMMON_BASEDATA_KEYS = [
  'BD_Customer',
  'BD_MATERIAL',
  'BD_Department',
  'BD_Empinfo',
  'BD_Currency',
  'BD_Supplier',
  'BD_StockOrgInfo',
  'BD_Settlementtype',
  'BD_OperatorGroup',
  'BD_Project'
];

async function main(): Promise<void> {
  const settings = await loadSettings();
  const projectId = settings.projects?.[0]?.id;
  if (!projectId) throw new Error('no project in settings.json');
  const cfg = resolveProjectConfig(settings, projectId);

  const pool = await sql.connect({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: cfg.options
  });

  // ============================================================
  // Step 1: 表结构 — 证明 T_META_LOOKUPCLASS.FID(GUID) + FFORMID(key)
  // ============================================================
  const cols = await pool.request().query<{
    COLUMN_NAME: string;
    DATA_TYPE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
  }>(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'T_META_LOOKUPCLASS'
    ORDER BY ORDINAL_POSITION
  `);
  console.log(`=== Step 1: T_META_LOOKUPCLASS columns (${cols.recordset.length}) ===`);
  for (const c of cols.recordset) {
    const len = c.CHARACTER_MAXIMUM_LENGTH ? `(${c.CHARACTER_MAXIMUM_LENGTH})` : '';
    console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}${len}`);
  }
  console.log(`  → FID = GUID ; FFORMID = key string ('BD_Customer' shape)`);

  // ============================================================
  // Step 2: 正向 — 常见基础资料 key 映射到 GUID
  // ============================================================
  console.log(`\n=== Step 2: forward key→GUID via SELECT FID FROM T_META_LOOKUPCLASS WHERE FFORMID = @key ===`);
  for (const key of COMMON_BASEDATA_KEYS) {
    const r = await pool.request()
      .input('k', sql.VarChar(36), key)
      .query<{ FID: string; FTABLENAME: string; FPKFIELDNAME: string }>(`
        SELECT TOP 5 FID, FTABLENAME, FPKFIELDNAME
        FROM T_META_LOOKUPCLASS
        WHERE FFORMID = @k
      `);
    if (r.recordset.length === 0) {
      // 大小写不敏感重试
      const r2 = await pool.request()
        .input('k', sql.VarChar(36), key)
        .query<{ FFORMID: string; FID: string }>(`
          SELECT TOP 5 FFORMID, FID FROM T_META_LOOKUPCLASS WHERE LOWER(FFORMID) = LOWER(@k)
        `);
      if (r2.recordset.length > 0) {
        console.log(`  ${key.padEnd(22)} -> case mismatch:`);
        for (const row of r2.recordset) {
          console.log(`      actual FFORMID=${row.FFORMID}  FID=${row.FID}`);
        }
      } else {
        console.log(`  ${key.padEnd(22)} -> NOT FOUND`);
      }
    } else if (r.recordset.length === 1) {
      const row = r.recordset[0];
      console.log(`  ${key.padEnd(22)} -> ${row.FID}    (table=${row.FTABLENAME} pk=${row.FPKFIELDNAME})`);
    } else {
      console.log(`  ${key.padEnd(22)} -> ${r.recordset.length} rows  (multi-table key, see all):`);
      for (const row of r.recordset) {
        console.log(`      FID=${row.FID}  table=${row.FTABLENAME}  pk=${row.FPKFIELDNAME}`);
      }
    }
  }

  // ============================================================
  // Step 3: 反向 — 把 SAL_SaleOrder 的 34 个 LookUpObjectID 全反查
  // ============================================================
  const so = await pool.request()
    .input('fid', sql.VarChar(64), 'SAL_SaleOrder')
    .query<{ X: string }>(
      'SELECT CAST(FKERNELXML AS NVARCHAR(MAX)) AS X FROM T_META_OBJECTTYPE WHERE FID = @fid'
    );
  const xml = so.recordset[0].X;
  const lookupGuids = Array.from(
    new Set([...xml.matchAll(/<LookUpObjectID>([^<]+)<\/LookUpObjectID>/g)].map((m) => m[1]))
  );
  console.log(`\n=== Step 3: backward GUID→FFORMID for all ${lookupGuids.length} LookUpObjectID values in SAL_SaleOrder ===`);
  let resolved = 0;
  let unresolved = 0;
  const unresolvedList: string[] = [];
  const sample: Array<{ guid: string; key: string; table: string }> = [];
  for (const g of lookupGuids) {
    const r = await pool.request()
      .input('g', sql.VarChar(64), g)
      .query<{ FFORMID: string; FTABLENAME: string }>(`
        SELECT TOP 1 FFORMID, FTABLENAME FROM T_META_LOOKUPCLASS WHERE FID = @g
      `);
    if (r.recordset.length > 0) {
      resolved++;
      sample.push({ guid: g, key: r.recordset[0].FFORMID, table: r.recordset[0].FTABLENAME });
    } else {
      unresolved++;
      unresolvedList.push(g);
    }
  }
  console.log(`  resolved: ${resolved} / ${lookupGuids.length}    unresolved: ${unresolved}`);
  console.log('  full mapping:');
  for (const s of sample) {
    console.log(`    ${s.guid}  ->  FFORMID=${s.key.padEnd(28)}  table=${s.table}`);
  }
  if (unresolvedList.length > 0) {
    console.log('  unresolved GUIDs (likely invalid in this account or pointing to deleted forms):');
    for (const g of unresolvedList) console.log(`    ${g}`);
  }

  // ============================================================
  // Step 4: 1:1 唯一性 — FFORMID -> FID 是否唯一?
  //         同一 FFORMID 可能多行 (FTABLENAME 不同), GUID 也不同 — 这意味着
  //         "BD_Customer" 可能映射到多个 GUID. 看 BOS Designer 拖字段时挑哪个.
  // ============================================================
  const dups = await pool.request().query<{ FFORMID: string; CNT: number; GUIDS: string }>(`
    SELECT FFORMID, COUNT(*) AS CNT,
           STRING_AGG(CAST(FID AS NVARCHAR(64)), ' | ') AS GUIDS
    FROM T_META_LOOKUPCLASS
    WHERE FFORMID LIKE 'BD\\_%' ESCAPE '\\'
    GROUP BY FFORMID
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);
  console.log(`\n=== Step 4: BD_* FFORMID 唯一性 (multiple rows per key) ===`);
  if (dups.recordset.length === 0) {
    console.log(`  unique 1:1 — every BD_* FFORMID has exactly one FID GUID`);
  } else {
    console.log(`  ${dups.recordset.length} BD_* FFORMID 有多行 — 可能是同 form 不同 view/table:`);
    for (const r of dups.recordset.slice(0, 15)) {
      console.log(`    ${r.FFORMID.padEnd(28)} count=${r.CNT}  GUIDs: ${r.GUIDS.slice(0, 200)}${r.GUIDS.length > 200 ? '...' : ''}`);
    }
  }

  // 另外提供同义反查 — 各 BD_* 的所有行(完整诊断, 看哪个 GUID 是 SAL_SaleOrder 实际用的)
  console.log(`\n=== Step 4b: BD_Customer 全行 (验证选哪个 GUID) ===`);
  const cust = await pool.request().query<{
    FID: string;
    FFORMID: string;
    FTABLENAME: string;
    FPKFIELDNAME: string;
  }>(`
    SELECT FID, FFORMID, FTABLENAME, FPKFIELDNAME
    FROM T_META_LOOKUPCLASS WHERE FFORMID = 'BD_Customer'
  `);
  for (const r of cust.recordset) {
    console.log(`    FID=${r.FID}  table=${r.FTABLENAME}  pk=${r.FPKFIELDNAME}`);
  }

  // ============================================================
  // Step 5: 标准 SQL 模板
  // ============================================================
  console.log(`\n=== Step 5: STANDARD KEY→GUID TRANSLATION SQL ===`);
  console.log(`  -- Input:  basedata key string (case-sensitive, e.g. 'BD_Customer' or 'BD_MATERIAL')`);
  console.log(`  -- Output: GUID for <LookUpObjectID> XML element`);
  console.log(``);
  console.log(`  SELECT TOP 1 FID FROM T_META_LOOKUPCLASS WHERE FFORMID = @key;`);
  console.log(``);
  console.log(`  -- 注意: 同一 FFORMID 可能多行(同 form 多视图/多表), 默认 TOP 1`);
  console.log(`  -- 如要选默认/主资料表行, 可 ORDER BY:`);
  console.log(`  --   1) FTABLENAME 与该 form 的标准主表对齐, 或`);
  console.log(`  --   2) 让 agent 列出所有候选, 让用户挑(罕见, 多见于扩展资料)`);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
