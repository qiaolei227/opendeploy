/**
 * One-shot restore: take a backup snapshot file and write its FKERNELXML
 * back to T_META_OBJECTTYPE for the extension. Used to recover from a
 * Plan 5.12.1 demo where 13 buggy-XML fields polluted FKERNELXML — the
 * earliest snapshot from that batch is the pre-write baseline.
 *
 * Only restores `FKERNELXML` because add-field writes only that column
 * (实证 in memory `bos_extension_recipe.md`). Other columns (FMODELTYPEID
 * etc.) are stable across add-field ops and don't need touching.
 *
 * Usage:
 *   pnpm dlx tsx scripts/restore-extension-from-backup.ts <backup-file-path>
 */

import sql from 'mssql';
import { readFile } from 'node:fs/promises';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

interface BackupSnapshot {
  takenAt: string;
  extId: string;
  operation: string;
  tables: {
    T_META_OBJECTTYPE: Array<{ FID: string; FKERNELXML: string }>;
  };
}

async function main(): Promise<void> {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error('Usage: tsx scripts/restore-extension-from-backup.ts <backup-file>');
    process.exit(1);
  }

  const raw = await readFile(backupPath, 'utf-8');
  const snapshot = JSON.parse(raw) as BackupSnapshot;
  const row = snapshot.tables.T_META_OBJECTTYPE?.[0];
  if (!row) {
    console.error('snapshot has no T_META_OBJECTTYPE row');
    process.exit(1);
  }
  if (!row.FKERNELXML) {
    console.error('snapshot row has no FKERNELXML');
    process.exit(1);
  }

  console.log(`extId: ${snapshot.extId}`);
  console.log(`takenAt: ${snapshot.takenAt}`);
  console.log(`operation: ${snapshot.operation}`);
  console.log(`FKERNELXML length: ${row.FKERNELXML.length} chars`);

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

  // Read current XML length for comparison
  const before = await pool
    .request()
    .input('fid', sql.VarChar(64), snapshot.extId)
    .query<{ FKERNELXML_TEXT: string }>(`
      SELECT CAST(FKERNELXML AS NVARCHAR(MAX)) AS FKERNELXML_TEXT
      FROM T_META_OBJECTTYPE
      WHERE FID = @fid
    `);
  console.log(`current FKERNELXML length (before restore): ${before.recordset[0]?.FKERNELXML_TEXT?.length ?? 'NOT FOUND'}`);

  const r = await pool
    .request()
    .input('fid', sql.VarChar(64), snapshot.extId)
    .input('xml', sql.NText, row.FKERNELXML)
    .query(`UPDATE T_META_OBJECTTYPE SET FKERNELXML = @xml WHERE FID = @fid`);
  console.log(`rows affected: ${r.rowsAffected[0]}`);

  await pool.close();
  console.log('\nRestored. 用户在 BOS Designer 里点工具栏刷新就能看到字段已撤回。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
