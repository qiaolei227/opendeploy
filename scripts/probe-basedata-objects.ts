/**
 * Recon: figure out what BD_* base data objects look like in T_META_OBJECTTYPE
 * and what GUID `LookUpObjectID` points at.
 *
 * Plan 5.12.1 Task 6 needs a `kingdee_describe_basedata` tool that translates
 * user-friendly keys ("BD_Customer") to the GUID a BaseDataField writes into
 * `<LookUpObjectID>`. First step is to confirm:
 * 1. Are BD_* objects FID=Key (like SAL_SaleOrder is FID="SAL_SaleOrder") ?
 * 2. What does the LookUpObjectID GUID 407d24cb-... actually identify?
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

  // 1) BD_Customer / BD_Material rows — how are they keyed?
  const bd = await pool.request().query<{
    FID: string;
    FBASEOBJECTID: string | null;
    FMODELTYPEID: number;
    FSUBSYSID: string;
  }>(`
    SELECT TOP 10 FID, FBASEOBJECTID, FMODELTYPEID, FSUBSYSID
    FROM T_META_OBJECTTYPE
    WHERE FID LIKE 'BD\\_%' ESCAPE '\\'
       OR FID = 'BD_Customer'
       OR FID = 'BD_MATERIAL'
    ORDER BY FID
  `);
  console.log('=== BD_* objects ===');
  for (const r of bd.recordset) {
    console.log(`  FID=${r.FID}  modelType=${r.FMODELTYPEID}  subsys=${r.FSUBSYSID}  base=${r.FBASEOBJECTID ?? 'NULL'}`);
  }

  // 2) Lookup the GUID that SAL_SaleOrder F客户 references
  const guid = '407d24cb-57f7-46bf-afb6-a9ab458fd845';
  const r2 = await pool.request().input('fid', sql.VarChar(64), guid).query<{
    FID: string; FBASEOBJECTID: string | null; FMODELTYPEID: number;
  }>(`SELECT FID, FBASEOBJECTID, FMODELTYPEID FROM T_META_OBJECTTYPE WHERE FID = @fid`);
  console.log(`\n=== Lookup GUID ${guid} ===`);
  if (r2.recordset.length === 0) {
    console.log('  (not in T_META_OBJECTTYPE — might be in some other registry)');
  } else {
    for (const r of r2.recordset) {
      console.log(`  FID=${r.FID}  base=${r.FBASEOBJECTID ?? 'NULL'}  modelType=${r.FMODELTYPEID}`);
    }
  }

  // 3) Look up BD_Customer's FID + see if its localized name + key columns help
  const cust = await pool.request().query<{
    FID: string; FBASEOBJECTID: string | null; FMODELTYPEID: number;
  }>(`
    SELECT TOP 5 FID, FBASEOBJECTID, FMODELTYPEID
    FROM T_META_OBJECTTYPE
    WHERE FID IN ('BD_Customer', 'BD_CUSTOMER', 'BD_Material', 'BD_MATERIAL')
  `);
  console.log('\n=== explicit BD_Customer / BD_Material lookups ===');
  for (const r of cust.recordset) {
    console.log(`  FID=${r.FID}  base=${r.FBASEOBJECTID ?? 'NULL'}  modelType=${r.FMODELTYPEID}`);
  }

  // 4) Check if there's a localization table that gives keys
  console.log('\n=== T_META_OBJECTTYPE_L for BD_Customer ===');
  const cl = await pool.request().query<{ FID: string; FNAME: string; FLOCALEID: number }>(`
    SELECT TOP 5 FID, FNAME, FLOCALEID
    FROM T_META_OBJECTTYPE_L
    WHERE FID = 'BD_Customer' OR FID LIKE 'BD_%' AND FLOCALEID = 2052
    ORDER BY FID
  `);
  for (const r of cl.recordset) {
    console.log(`  FID=${r.FID}  name=${r.FNAME}  locale=${r.FLOCALEID}`);
  }

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
