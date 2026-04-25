import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

async function main(): Promise<void> {
  const settings = await loadSettings();
  const projectId = settings.projects?.[0]?.id;
  if (!projectId) throw new Error('no project');

  const cfg = resolveProjectConfig(settings, projectId);
  const pool = await sql.connect({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: cfg.options
  });

  const result = await pool.request().query<{
    FID: string;
    FBASEOBJECTID: string;
    FMODIFYDATE: Date | null;
    FKERNELXML_LEN: number;
  }>(`
    SELECT TOP 30
           FID,
           FBASEOBJECTID,
           FMODIFYDATE,
           DATALENGTH(FKERNELXML) AS FKERNELXML_LEN
      FROM T_META_OBJECTTYPE
     WHERE FBASEOBJECTID IS NOT NULL AND FBASEOBJECTID <> ''
       AND DATALENGTH(FKERNELXML) > 100
     ORDER BY FMODIFYDATE DESC
  `);

  await pool.close();

  console.log(`找到 ${result.recordset.length} 个扩展 (按修改时间倒排, top 30):\n`);
  for (const r of result.recordset) {
    console.log(`FID: ${r.FID}`);
    console.log(`  FBASEOBJECTID: ${r.FBASEOBJECTID}`);
    console.log(`  FMODIFYDATE: ${r.FMODIFYDATE?.toISOString() ?? 'null'}`);
    console.log(`  FKERNELXML 字节数: ${r.FKERNELXML_LEN}`);
    console.log();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
