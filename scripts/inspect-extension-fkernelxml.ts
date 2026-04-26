/**
 * 一次性诊断脚本: 查扩展 FID 的 FKERNELXML 当前内容,
 * 列出所有字段节点的 tag + key + Appearance ElementType,
 * 并统计每个字段类型的数量。
 *
 * 用法:
 *   pnpm tsx scripts/inspect-extension-fkernelxml.ts <FID>
 */

import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

const FIELD_TAGS = [
  'TextField', 'LargeRichTextField', 'IntegerField', 'DecimalField',
  'AmountField', 'QtyField', 'DateTimeField', 'CheckBoxField',
  'ComboField', 'MulComboField', 'BaseDataField', 'BasePropertyField',
  'ColorField', 'MobileField', 'ReferencePropertyField'
];

async function main(): Promise<void> {
  const fid = process.argv[2];
  if (!fid) {
    console.error('用法: pnpm tsx scripts/inspect-extension-fkernelxml.ts <FID>');
    process.exit(1);
  }
  const settings = await loadSettings();
  const projectId = settings.projects?.[0]?.id;
  if (!projectId) throw new Error('no project in settings.json');
  const cfg = resolveProjectConfig(settings, projectId);

  const pool = await sql.connect({
    server: cfg.server, port: cfg.port, database: cfg.database,
    user: cfg.user, password: cfg.password, options: cfg.options
  });

  const r = await pool.request()
    .input('fid', sql.VarChar(64), fid)
    .query<{ FNAME: string; FBASEOBJECTID: string; XLEN: number; XML: string }>(`
      SELECT ISNULL(l.FNAME, '') AS FNAME,
             t.FBASEOBJECTID,
             LEN(CAST(t.FKERNELXML AS NVARCHAR(MAX))) AS XLEN,
             CAST(t.FKERNELXML AS NVARCHAR(MAX)) AS XML
      FROM T_META_OBJECTTYPE t
      LEFT JOIN T_META_OBJECTTYPE_L l ON l.FID = t.FID AND l.FLOCALEID = 2052
      WHERE t.FID = @fid
    `);
  if (r.recordset.length === 0) {
    console.log(`扩展 ${fid}: 未找到`);
    await pool.close();
    return;
  }
  const row = r.recordset[0];
  console.log(`\n=== 扩展 ${fid} ===`);
  console.log(`  base=${row.FBASEOBJECTID}  name=${row.FNAME}  xmlLen=${row.XLEN}`);

  console.log(`\n--- 字段节点统计 ---`);
  for (const tag of FIELD_TAGS) {
    const re = new RegExp(`<${tag}[\\s>]`, 'g');
    const count = (row.XML.match(re) || []).length;
    if (count > 0) console.log(`  ${tag}: ${count}`);
  }

  console.log(`\n--- 所有字段节点(tag · key · Appearance ElementType) ---`);
  const fieldRe = /<(\w+Field)\s+ElementType="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  let i = 0;
  while ((m = fieldRe.exec(row.XML)) !== null) {
    const tag = m[1];
    const fieldElType = m[2];
    const body = m[3];
    const keyMatch = body.match(/<Key>([^<]+)<\/Key>/);
    const apMatch = body.match(/<(\w+FieldAppearance)[^>]*ElementType="(\d+)"/);
    const captionMatch = body.match(/<Caption[^>]*>[\s\S]*?<Item[^>]*Value="([^"]+)"/);
    console.log(
      `  ${(++i).toString().padStart(2)}. <${tag} ElementType="${fieldElType}"> ` +
      `key=${keyMatch?.[1] ?? '?'} ` +
      `appearanceTag=${apMatch?.[1] ?? '?'} appearanceElType=${apMatch?.[2] ?? '?'} ` +
      `caption=${captionMatch?.[1] ?? '?'}`
    );
  }

  console.log(`\n--- F_CUST_QTY 完整 XML 片段(验 FieldPrecision/FieldScale + Appearance) ---`);
  const qtyMatch = row.XML.match(/<QtyField[\s\S]*?<\/QtyField>/);
  if (qtyMatch) console.log(qtyMatch[0]);

  await pool.close();
}

main().catch(err => { console.error(err); process.exit(1); });
