/**
 * Probe round 4 — 修正 JOIN: T_META_FORMENUMITEM.FID 才是 enum FK,
 * 上轮我用 FENUMID 当 enum FK 是错的。
 */
import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

async function main(): Promise<void> {
  const settings = await loadSettings();
  const projectId = settings.projects?.[0]?.id;
  if (!projectId) throw new Error('no project');
  const cfg = resolveProjectConfig(settings, projectId);
  const pool = await sql.connect({
    server: cfg.server, port: cfg.port, database: cfg.database,
    user: cfg.user, password: cfg.password, options: cfg.options
  });

  const fcf = 'c6929d92-8195-46d5-81af-fc9c09fa8346';

  // ===== 1. FChangeFlag enum 用 FID join =====
  console.log(`\n=== 1. FChangeFlag (${fcf}) items via FID join ===`);
  const items = await pool.request()
    .input('id', sql.VarChar(36), fcf)
    .query(`
      SELECT * FROM T_META_FORMENUMITEM WHERE FID = @id ORDER BY FSEQ
    `);
  console.log(items.recordset);

  // L 表 join via FENUMID
  console.log(`\n=== 1b. items localized captions ===`);
  // 既然 ITEM_L.FENUMID = ITEM.FENUMID (the item's PK?)
  // 让我们看清楚: 上面 query 出来 4 条 row, 看 FENUMID 列里到底是什么
  if (items.recordset.length > 0) {
    const sample = items.recordset[0];
    console.log('  sample row:', sample);
    // 用它的 FENUMID 去 FORMENUMITEM_L 查
    if (sample.FENUMID) {
      const lr = await pool.request()
        .input('e', sql.VarChar(36), sample.FENUMID)
        .query(`SELECT TOP 10 * FROM T_META_FORMENUMITEM_L WHERE FENUMID = @e`);
      console.log(`  ITEM_L by FENUMID = ${sample.FENUMID}:`);
      console.log(lr.recordset);
    }
  }

  // ===== 2. 全表正确 itemCount =====
  console.log('\n=== 2. 正确的 itemCount(用 FID 做 enum FK)===');
  const stat = await pool.request().query(`
    SELECT
      SUM(CASE WHEN n=0 THEN 1 ELSE 0 END) AS noItems,
      SUM(CASE WHEN n>0 THEN 1 ELSE 0 END) AS hasItems,
      AVG(n*1.0) AS avgItems
    FROM (
      SELECT t.FID, (SELECT COUNT(*) FROM T_META_FORMENUMITEM i WHERE i.FID = t.FID) AS n
      FROM T_META_FORMENUM t
    ) s
  `);
  console.log(stat.recordset);

  // ===== 3. 正确的 PK / 关联结构 — 不分组,逐行列 =====
  console.log(`\n=== 3. T_META_FORMENUMITEM 索引列 ===`);
  const idx = await pool.request().query(`
    SELECT i.name AS idx_name, i.is_primary_key, i.is_unique, c.name AS col, ic.key_ordinal
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID('T_META_FORMENUMITEM')
    ORDER BY i.name, ic.key_ordinal
  `);
  console.log(idx.recordset);

  // ===== 4. 一个用户自建 enum 的完整数据 =====
  console.log(`\n=== 4. 用户自建 enum (FISSYSPRESET=0) 的 items ===`);
  const userEnum = await pool.request().query(`
    SELECT TOP 5 t.FID, l.FNAME,
      (SELECT COUNT(*) FROM T_META_FORMENUMITEM i WHERE i.FID = t.FID) AS n
    FROM T_META_FORMENUM t
    LEFT JOIN T_META_FORMENUM_L l ON l.FID = t.FID AND l.FLOCALEID = 2052
    WHERE t.FISSYSPRESET = '0'
  `);
  for (const e of userEnum.recordset) {
    console.log(`\n  enum ${e.FID} ${e.FNAME}  itemCount=${e.n}`);
    const r = await pool.request()
      .input('id', sql.VarChar(36), e.FID)
      .query(`SELECT i.FID, i.FENUMID, i.FVALUE, i.FSEQ, i.FINVALID, l.FCAPTION
        FROM T_META_FORMENUMITEM i
        LEFT JOIN T_META_FORMENUMITEM_L l ON l.FENUMID = i.FENUMID AND l.FLOCALEID = 2052
        WHERE i.FID = @id ORDER BY i.FSEQ`);
    r.recordset.forEach((row: any) =>
      console.log(`    seq=${row.FSEQ} value=${row.FVALUE} caption=${row.FCAPTION} invalid=${row.FINVALID}`));
  }

  // ===== 5. 验证我之前 SAL_SaleOrder 那 17 个 ComboField 的 EnumType GUID 都能在 T_META_FORMENUMITEM 用 FID 关联到具体值 =====
  console.log(`\n=== 5. 验证多个 SAL_SaleOrder ComboField 的下拉项实例化 ===`);
  const enums = [
    { key: 'FChangeFlag', id: 'c6929d92-8195-46d5-81af-fc9c09fa8346' },
    { key: 'FBusinessType', id: 'caafd266-8d57-4e90-a649-d1e65f208412' },
    { key: 'FReturnType', id: '7690dc73-3887-4a1f-8d53-c46a02066277' },
    { key: 'FCreditCheckResult', id: '923c7f9e-3baa-43ba-a7c7-a8d2c2b40c6d' },
    { key: 'FRowType', id: 'd814ab60-f41d-404b-89f7-731054856d5e' }
  ];
  for (const e of enums) {
    const r = await pool.request()
      .input('id', sql.VarChar(36), e.id)
      .query(`
        SELECT i.FENUMID, i.FVALUE, i.FSEQ, l.FCAPTION
        FROM T_META_FORMENUMITEM i
        LEFT JOIN T_META_FORMENUMITEM_L l ON l.FENUMID = i.FENUMID AND l.FLOCALEID = 2052
        WHERE i.FID = @id ORDER BY i.FSEQ
      `);
    console.log(`\n  ${e.key} (${e.id}):  ${r.recordset.length} items`);
    r.recordset.forEach((row: any) =>
      console.log(`    seq=${row.FSEQ} value=${row.FVALUE} caption=${row.FCAPTION}`));
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
