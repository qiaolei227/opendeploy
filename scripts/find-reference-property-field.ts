/**
 * Recon: find any form whose FKERNELXML contains a ReferencePropertyField
 * node (or whatever the real serialization tag is). Plan 5.12.1 demo实证
 * BOS rejects "<ReferencePropertyField>" as "未能找到对应的数据类型" —
 * the C# class name and the XML element name must differ. Search the
 * whole metadata catalog for any known variants.
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

  // Try several candidate tag names — XmlElement attribute on a C# class
  // can rename it to anything. Common patterns: drop "Field" suffix /
  // drop "Property" / use shorter name / use alternate "Lookup" prefix.
  const candidates = [
    'ReferencePropertyField',
    'ReferenceProperty',
    'RefPropertyField',
    'RefProperty',
    'ReferenceField',
    'LookupField',
    'LookUpField',
    'LookUpFieldRef'
  ];

  for (const tag of candidates) {
    const r = await pool
      .request()
      .input('pattern', sql.NVarChar(200), `%<${tag}%`)
      .query<{ FID: string; FBASEOBJECTID: string | null; matches: number }>(`
        SELECT TOP 5 FID, FBASEOBJECTID
        FROM T_META_OBJECTTYPE
        WHERE CAST(FKERNELXML AS NVARCHAR(MAX)) LIKE @pattern
      `);
    console.log(`\n=== <${tag}>: ${r.recordset.length} forms hit ===`);
    for (const row of r.recordset) {
      console.log(`  FID=${row.FID} BASE=${row.FBASEOBJECTID ?? 'NULL'}`);
    }
  }

  // Also look for any tag with "Reference" in it
  console.log('\n=== probe: any tag containing "Reference" ===');
  const r = await pool.request().query<{ FID: string; xml_excerpt: string }>(`
    SELECT TOP 3 FID,
           SUBSTRING(CAST(FKERNELXML AS NVARCHAR(MAX)),
             CHARINDEX('<Reference', CAST(FKERNELXML AS NVARCHAR(MAX))),
             200) AS xml_excerpt
    FROM T_META_OBJECTTYPE
    WHERE CAST(FKERNELXML AS NVARCHAR(MAX)) LIKE '%<Reference%'
  `);
  for (const row of r.recordset) {
    console.log(`\n  FID=${row.FID}`);
    console.log(`    excerpt: ${row.xml_excerpt}`);
  }

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
