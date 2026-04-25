/**
 * 一次性 recon — 从某个标准单据的 FKERNELXML 抽 <BaseDataField>...</BaseDataField>
 * 节点的样例,用于实证 Plan 5.12.1 Task 3 (BaseDataField rendering) 的 XML 形态
 * (RefBaseDataObjectType 是子元素还是属性? 是 RefBaseDataObjectType 还是
 * RefBaseDataObjectKey?)
 *
 * Usage:  pnpm dlx tsx scripts/find-basedata-field-xml.ts [billKey]
 * Default billKey = SAL_SaleOrder (头上的 F客户 / FSettleCustomerID 等都是 BaseDataField).
 */

import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

const DEFAULT_BILL_KEY = 'SAL_SaleOrder';

async function main(): Promise<void> {
  const billKey = process.argv[2] ?? DEFAULT_BILL_KEY;

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

  // 标准单据可能 FID = key, 也可能是 GUID + 名称只在 _L 表里. 先粗匹配.
  // 标准单据 FID 不一定就是 key. 先按 xml 含 BaseDataField 排,挑最大的.
  const result = await pool.request()
    .input('key', sql.NVarChar(50), `%${billKey}%`)
    .query<{ FID: string; FBASEOBJECTID: string | null; FKERNELXML_TEXT: string | null }>(`
      SELECT TOP 3 FID, FBASEOBJECTID,
             CAST(FKERNELXML AS NVARCHAR(MAX)) AS FKERNELXML_TEXT
      FROM T_META_OBJECTTYPE
      WHERE FID LIKE @key
        AND FKERNELXML IS NOT NULL
      ORDER BY LEN(CAST(FKERNELXML AS NVARCHAR(MAX))) DESC
    `);
  console.log(`candidate rows: ${result.recordset.length}`);
  for (const row of result.recordset) {
    console.log(`  FID=${row.FID} BASE=${row.FBASEOBJECTID ?? 'NULL'} xmlLen=${row.FKERNELXML_TEXT?.length ?? 0}`);
  }

  await pool.close();

  if (result.recordset.length === 0 || !result.recordset[0].FKERNELXML_TEXT) {
    console.error(`bill ${billKey} not found or has no FKERNELXML`);
    process.exit(1);
  }

  const xml = result.recordset[0].FKERNELXML_TEXT;
  console.log(`xml length: ${xml.length}`);

  // 多种字段类型,各取首例 (优先小一些的样本以便阅读).
  const tags = [
    'TextField',
    'IntegerField',
    'DecimalField',
    'AmountField',
    'QtyField',
    'DateTimeField',
    'CheckBoxField',
    'ComboField',
    'MulComboField',
    'BaseDataField',
    'BasePropertyField',
    'ReferencePropertyField'
  ];
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'g');
    const hits: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      hits.push(m[0]);
      if (hits.length >= 8) break;
    }
    if (hits.length === 0) {
      console.log(`\n=== ${tag}: 0 hits ===`);
      continue;
    }
    // Pick the smallest (cleanest) hit
    hits.sort((a, b) => a.length - b.length);
    const sample = hits[0];
    console.log(`\n=== ${tag}: ${hits.length}+ hits, smallest = ${sample.length} chars ===`);
    console.log(sample.length > 2500 ? sample.substring(0, 2500) + '\n...[truncated]' : sample);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
