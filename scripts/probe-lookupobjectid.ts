/**
 * Hunt for the GUID 407d24cb-57f7-46bf-afb6-a9ab458fd845 (LookUpObjectID
 * value from SAL_SaleOrder F客户 BaseDataField). It's NOT in T_META_OBJECTTYPE.
 * Try the other 7 extension tables + a few wider candidates.
 */

import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

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

  const guid = '407d24cb-57f7-46bf-afb6-a9ab458fd845';

  // Find ANY table with this GUID as a value (search system catalog).
  // For brevity, just try the obvious metadata tables.
  const candidates = [
    'T_META_OBJECTTYPE_E',
    'T_META_OBJECTTYPENAMEEX',
    'T_META_OBJECTTYPENAMEEX_L',
    'T_META_OBJECTTYPEREF',
    'T_META_OBJECTFUNCINTERFACE',
    'T_BAS_BUSINESSOBJECT',
    'T_BAS_BUSINESSOBJECTEXTENDS',
    'T_BAS_FORMMETA'
  ];

  for (const table of candidates) {
    try {
      const r = await pool.request()
        .input('g', sql.VarChar(64), guid)
        .query<{ col: string; val: string }>(`
          SELECT TOP 1 'FID' as col, CAST(FID AS NVARCHAR(64)) as val
          FROM ${table} WHERE FID = @g
        `);
      console.log(`${table}.FID === ${guid}: ${r.recordset.length > 0 ? 'YES — ' + JSON.stringify(r.recordset[0]) : 'no'}`);
    } catch (e) {
      console.log(`${table}.FID lookup failed: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  // Discover columns of T_META_OBJECTTYPENAMEEX
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'T_META_OBJECTTYPENAMEEX'
  `);
  console.log('\n=== T_META_OBJECTTYPENAMEEX columns ===');
  console.log(cols.recordset.map(r => r.COLUMN_NAME).join(', '));

  // Sample a few rows
  const sample = await pool.request().input('g', sql.VarChar(64), guid).query(`
    SELECT TOP 3 * FROM T_META_OBJECTTYPENAMEEX WHERE FID = @g
  `);
  console.log(`\n=== T_META_OBJECTTYPENAMEEX rows where FID=${guid} ===`);
  for (const r of sample.recordset) console.log(JSON.stringify(r));

  // Maybe NameEx links a guid → form's FID; show how it's structured for BD_Customer
  const probe2 = await pool.request().query(`
    SELECT TOP 3 * FROM T_META_OBJECTTYPENAMEEX
  `);
  console.log('\n=== T_META_OBJECTTYPENAMEEX sample (any) ===');
  for (const r of probe2.recordset) console.log(JSON.stringify(r));

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
