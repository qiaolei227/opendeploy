/**
 * Probe BD_Customer fields: are they in BD_Customer.FKERNELXML or in
 * the parent template BOS_OrgControlBDModel.FKERNELXML?
 */

import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

async function main(): Promise<void> {
  const settings = await loadSettings();
  const projectId = settings.projects?.[0]?.id;
  if (!projectId) throw new Error('no project in settings.json');
  const cfg = resolveProjectConfig(settings, projectId);

  const pool = await sql.connect({
    server: cfg.server, port: cfg.port, database: cfg.database,
    user: cfg.user, password: cfg.password, options: cfg.options
  });

  for (const fid of ['BD_Customer', 'BOS_OrgControlBDModel']) {
    const r = await pool.request()
      .input('fid', sql.VarChar(64), fid)
      .query<{ FBASEOBJECTID: string; XLEN: number; XML: string }>(`
        SELECT FBASEOBJECTID,
               LEN(CAST(FKERNELXML AS NVARCHAR(MAX))) AS XLEN,
               CAST(FKERNELXML AS NVARCHAR(MAX)) AS XML
        FROM T_META_OBJECTTYPE WHERE FID = @fid
      `);
    if (r.recordset.length === 0) {
      console.log(`\n=== ${fid}: NOT FOUND ===`);
      continue;
    }
    const row = r.recordset[0];
    console.log(`\n=== ${fid} ===`);
    console.log(`  base=${row.FBASEOBJECTID ?? 'NULL'}  xmlLen=${row.XLEN}`);

    // Count field tags
    const tags = ['TextField', 'IntegerField', 'DecimalField', 'AmountField',
      'QtyField', 'DateTimeField', 'CheckBoxField', 'ComboField',
      'BaseDataField', 'MobileField'];
    for (const t of tags) {
      const re = new RegExp(`<${t}\\b`, 'g');
      const cnt = (row.XML.match(re) ?? []).length;
      if (cnt > 0) console.log(`  <${t}>: ${cnt}`);
    }

    // Sample first TextField key/name
    const m = /<TextField[^>]*>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<\/TextField>/.exec(row.XML);
    if (m) console.log(`  first TextField key: ${m[1]}`);
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
