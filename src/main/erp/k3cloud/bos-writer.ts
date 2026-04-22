/**
 * BOS extension + plugin read API. Write operations land in a follow-up
 * commit (Plan 5.5) — they need the backup infrastructure that sits in
 * `bos-backup.ts` plus transaction plumbing.
 *
 * Everything here is scoped to the 8 tables whitelisted in CLAUDE.md's
 * hard-red-line #1 for metadata reads; all queries go through
 * `validateQuery()` so the Plan 6 whitelist gate wires in cleanly.
 *
 * See memory `bos_extension_recipe.md` for the full SQL blueprint and
 * `scripts/create-extension-full.ts` for a runnable sample of the write
 * path (to be folded into this file).
 */

import sql from 'mssql';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { BosEnvironmentStatus, ExtensionMeta, PluginMeta } from '@shared/erp-types';
import { validateQuery } from '../validator';
import {
  addPluginToKernelXml,
  buildExtensionKernelXml,
  parseFormPluginsFromKernelXml,
  removePluginFromKernelXml
} from './bos-xml';
import { snapshotExtension, writeBackupSnapshot } from './bos-backup';

const DEFAULT_LOCALE = 2052; // zh-CN

function requireValid(sqlText: string): void {
  const r = validateQuery(sqlText);
  if (!r.ok) throw new Error(`SQL validator rejected query: ${r.reason ?? 'no reason'}`);
}

// ─── Environment probe ─────────────────────────────────────────────────

const PROBE_ENV_SQL = `
  SELECT TOP 1 FSUPPLIERNAME AS code
    FROM T_META_OBJECTTYPE
   WHERE FMODIFIERID = @uid
     AND FSUPPLIERNAME IS NOT NULL
     AND LEN(LTRIM(RTRIM(FSUPPLIERNAME))) > 0
   ORDER BY FMODIFYDATE DESC
`;

/**
 * Check whether the given BOS user has ever saved metadata — if so, we can
 * reuse their `FSUPPLIERNAME` as the developer stamp for extensions we
 * create on their behalf. When no stamp is found the user hasn't logged
 * into the K/3 Cloud collaborative-development platform yet, and our
 * write tools must refuse until they do.
 */
export async function probeBosEnvironment(
  pool: sql.ConnectionPool,
  userId: number
): Promise<BosEnvironmentStatus> {
  requireValid(PROBE_ENV_SQL);
  const r = await pool
    .request()
    .input('uid', sql.Int, userId)
    .query<{ code: string | null }>(PROBE_ENV_SQL);
  const code = r.recordset[0]?.code;
  if (!code || !code.trim()) {
    return {
      status: 'not-initialized',
      reason:
        '当前用户没有可识别的开发商标识。请先登录一次 K/3 Cloud 协同开发平台,' +
        '登录时选择 Workspace 即可自动绑定开发商。'
    };
  }
  return { status: 'ready', developerCode: code.trim() };
}

// ─── listExtensions ───────────────────────────────────────────────────

const LIST_EXTENSIONS_SQL = `
  SELECT o.FID,
         o.FBASEOBJECTID,
         COALESCE(ol.FNAME, o.FID) AS FNAME,
         o.FSUPPLIERNAME,
         o.FMODIFYDATE
    FROM T_META_OBJECTTYPE o
    JOIN T_META_OBJECTTYPE_E e
      ON e.FID = o.FID
    LEFT JOIN T_META_OBJECTTYPE_L ol
           ON ol.FID = o.FID AND ol.FLOCALEID = @locale
   WHERE o.FBASEOBJECTID = @parent
   ORDER BY o.FMODIFYDATE DESC
`;

/**
 * List every extension whose `FBASEOBJECTID` matches `parentFormId`. Joins
 * `T_META_OBJECTTYPE_E` so we only surface genuine extensions (rows with
 * the extension marker) rather than any record that happens to point at a
 * parent form.
 */
export async function listExtensions(
  pool: sql.ConnectionPool,
  parentFormId: string,
  locale: number = DEFAULT_LOCALE
): Promise<ExtensionMeta[]> {
  requireValid(LIST_EXTENSIONS_SQL);
  const r = await pool
    .request()
    .input('parent', sql.VarChar(64), parentFormId)
    .input('locale', sql.Int, locale)
    .query<{
      FID: string;
      FBASEOBJECTID: string;
      FNAME: string;
      FSUPPLIERNAME: string | null;
      FMODIFYDATE: Date | string | null;
    }>(LIST_EXTENSIONS_SQL);
  return r.recordset.map((row) => ({
    extId: row.FID,
    parentFormId: row.FBASEOBJECTID,
    name: row.FNAME ?? row.FID,
    developerCode: row.FSUPPLIERNAME ?? null,
    modifyDate:
      row.FMODIFYDATE instanceof Date
        ? row.FMODIFYDATE.toISOString()
        : row.FMODIFYDATE == null
          ? null
          : String(row.FMODIFYDATE)
  }));
}

// ─── listFormPlugins ──────────────────────────────────────────────────

const GET_KERNEL_XML_SQL = `
  SELECT CAST(FKERNELXML AS nvarchar(max)) AS xml
    FROM T_META_OBJECTTYPE
   WHERE FID = @id
`;

/**
 * List every plugin currently registered on a form or extension. Accepts
 * either a base form FID (e.g. `SAL_SaleOrder`) or a GUID extension FID —
 * the underlying row read is the same, only the XML delta differs.
 *
 * Distinguishes Python vs DLL by the `<PlugInType>` / `<PyScript>` child
 * elements (see `bos-xml.ts` for the shape reference).
 */
export async function listFormPlugins(
  pool: sql.ConnectionPool,
  formOrExtId: string
): Promise<PluginMeta[]> {
  requireValid(GET_KERNEL_XML_SQL);
  const r = await pool
    .request()
    .input('id', sql.VarChar(64), formOrExtId)
    .query<{ xml: string | null }>(GET_KERNEL_XML_SQL);
  const xml = r.recordset[0]?.xml;
  if (!xml) return [];
  return parseFormPluginsFromKernelXml(xml);
}

// ─── Write helpers (shared) ───────────────────────────────────────────

/**
 * .NET `DateTime.Now.Ticks` as a string — the format BOS uses for
 * `T_META_OBJECTTYPE.FVERSION` / `FMAINVERSION`. One tick is 100 ns since
 * 0001-01-01 UTC; JS `Date.now()` is ms since 1970-01-01 UTC.
 */
function dotnetTicks(): string {
  const EPOCH_OFFSET = 621355968000000000n;
  return String(BigInt(Date.now()) * 10000n + EPOCH_OFFSET);
}

/** Best-effort host info for the FCOMPUTERINFO column (IP; hostname). */
function makeComputerInfo(): string {
  const ip =
    Object.values(os.networkInterfaces())
      .flat()
      .filter(
        (i): i is os.NetworkInterfaceInfo =>
          !!i && !i.internal && i.family === 'IPv4'
      )[0]?.address ?? '127.0.0.1';
  return `${ip};${os.hostname()}`;
}

const UPDATE_KERNEL_XML_SQL = `
  UPDATE T_META_OBJECTTYPE
     SET FKERNELXML = @xml,
         FVERSION = @version,
         FMAINVERSION = @version,
         FMODIFYDATE = GETDATE(),
         FMODIFIERID = @uid
   WHERE FID = @id
`;

/**
 * Apply a new FKERNELXML delta to an existing extension row, refreshing
 * version + modify metadata so BOS Designer treats it as a fresh edit.
 */
async function updateKernelXml(
  pool: sql.ConnectionPool,
  extId: string,
  xml: string,
  userId: number
): Promise<void> {
  requireValid(UPDATE_KERNEL_XML_SQL);
  await pool
    .request()
    .input('id', sql.VarChar(36), extId)
    .input('xml', sql.NVarChar(sql.MAX), xml)
    .input('version', sql.VarChar(100), dotnetTicks())
    .input('uid', sql.Int, userId)
    .query(UPDATE_KERNEL_XML_SQL);
}

// ─── registerPythonPluginOnExtension ───────────────────────────────────

/**
 * Insert a new `<PlugIn>` into an existing extension's FKERNELXML. Snapshots
 * the pre-write state first, so users can hand-restore from the backup
 * JSON if the update turns out wrong. Errors when a plugin with the same
 * `ClassName` is already present — callers who want overwrite semantics
 * should unregister first.
 */
export async function registerPythonPluginOnExtension(
  pool: sql.ConnectionPool,
  projectId: string,
  userId: number,
  extId: string,
  plugin: PluginMeta
): Promise<{ backupFile: string }> {
  if (plugin.type !== 'python') {
    throw new Error('registerPythonPluginOnExtension only accepts Python plugins');
  }
  const snapshot = await snapshotExtension(pool, extId, 'register-plugin');
  const backupFile = await writeBackupSnapshot(projectId, snapshot);

  const row = snapshot.tables.T_META_OBJECTTYPE[0];
  if (!row) throw new Error(`extension ${extId} not found`);
  const currentXml = typeof row.FKERNELXML === 'string' ? row.FKERNELXML : '';
  if (!currentXml) throw new Error(`extension ${extId} has no FKERNELXML to extend`);

  const newXml = addPluginToKernelXml(currentXml, plugin);
  await updateKernelXml(pool, extId, newXml, userId);
  return { backupFile };
}

// ─── unregisterPlugin ─────────────────────────────────────────────────

/**
 * Remove a plugin from an extension by `ClassName`. No-ops silently when
 * the plugin isn't present — callers who want strict behavior should
 * check via `listFormPlugins` first.
 */
export async function unregisterPlugin(
  pool: sql.ConnectionPool,
  projectId: string,
  userId: number,
  extId: string,
  className: string
): Promise<{ backupFile: string }> {
  const snapshot = await snapshotExtension(pool, extId, 'unregister-plugin');
  const backupFile = await writeBackupSnapshot(projectId, snapshot);

  const row = snapshot.tables.T_META_OBJECTTYPE[0];
  if (!row) throw new Error(`extension ${extId} not found`);
  const currentXml = typeof row.FKERNELXML === 'string' ? row.FKERNELXML : '';
  if (!currentXml) return { backupFile };

  const newXml = removePluginFromKernelXml(currentXml, className);
  if (newXml === currentXml) return { backupFile }; // nothing changed
  await updateKernelXml(pool, extId, newXml, userId);
  return { backupFile };
}

// ─── createExtensionWithPythonPlugin ───────────────────────────────────

export interface CreateExtensionParams {
  projectId: string;
  userId: number;
  parentFormId: string;
  extName: string;
  developerCode: string;
  plugin: PluginMeta;
}

/**
 * Create a brand-new extension of `parentFormId` with one Python plugin
 * already registered on it, inside a single SQL transaction. Replicates
 * the 8-table footprint BOS Designer writes when a developer creates an
 * extension via the UI (see memory `bos_extension_recipe.md`). Rolls the
 * whole thing back if any step fails.
 *
 * Caller responsibility: resolve `developerCode` up front via
 * `probeBosEnvironment` and refuse if not 'ready'. Passing a bogus code
 * here creates an extension the user can't edit in BOS Designer.
 */
export async function createExtensionWithPythonPlugin(
  pool: sql.ConnectionPool,
  params: CreateExtensionParams
): Promise<{ extId: string; backupFile: string }> {
  if (params.plugin.type !== 'python') {
    throw new Error('createExtensionWithPythonPlugin only accepts Python plugins');
  }

  const extId = randomUUID();

  // Read parent's inheritable columns so the extension inherits cleanly.
  const parentSql = `
    SELECT FMODELTYPEID, FSUBSYSID, FMODELTYPESUBID, FINHERITPATH
      FROM T_META_OBJECTTYPE WHERE FID = @id`;
  requireValid(parentSql);
  const parentRow = await pool
    .request()
    .input('id', sql.VarChar(64), params.parentFormId)
    .query<{
      FMODELTYPEID: number | null;
      FSUBSYSID: string | null;
      FMODELTYPESUBID: number | null;
      FINHERITPATH: string;
    }>(parentSql);
  const parent = parentRow.recordset[0];
  if (!parent) throw new Error(`parent form ${params.parentFormId} not found`);

  // Pre-write backup marker (empty — the extension doesn't exist yet; file
  // serves as a "we were about to create this FID" audit breadcrumb).
  const preSnapshot = await snapshotExtension(pool, extId, 'create-extension');
  const backupFile = await writeBackupSnapshot(params.projectId, preSnapshot);

  const version = dotnetTicks();
  const computerInfo = makeComputerInfo();
  const inheritPath = `,${params.parentFormId}${parent.FINHERITPATH}`;
  const kernelXml = buildExtensionKernelXml(extId, [params.plugin]);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // 1. T_META_OBJECTTYPE — the main extension row.
    await new sql.Request(tx)
      .input('fid', sql.VarChar(36), extId)
      .input('mtype', sql.Int, parent.FMODELTYPEID ?? 100)
      // FSUBSYSID is varchar(36) NULL in schema — pass through null rather
      // than coerce to empty string so the extension matches parent when
      // parent has no subsystem.
      .input('sub', sql.VarChar(36), parent.FSUBSYSID)
      .input('msub', sql.Int, parent.FMODELTYPESUBID ?? 100)
      .input('version', sql.VarChar(100), version)
      .input('xml', sql.NVarChar(sql.MAX), kernelXml)
      .input('base', sql.VarChar(36), params.parentFormId)
      .input('devtype', sql.SmallInt, 2)
      .input('dev', sql.VarChar(100), params.developerCode)
      .input('inherit', sql.NVarChar(510), inheritPath)
      .input('uid', sql.Int, params.userId)
      .input('computer', sql.VarChar(255), computerInfo).query(`
        INSERT INTO T_META_OBJECTTYPE
          (FID, FMODELTYPEID, FSUBSYSID, FMODELTYPESUBID, FVERSION, FISTEMPLATE,
           FKERNELXML, FBASEOBJECTID, FDEVTYPE, FSUPPLIERNAME, FINHERITPATH,
           FMODIFIERID, FMODIFYDATE, FCOMPUTERINFO, FMAINVERSION)
        VALUES
          (@fid, @mtype, @sub, @msub, @version, 0,
           @xml, @base, @devtype, @dev, @inherit,
           @uid, GETDATE(), @computer, @version)`);

    // 2. T_META_OBJECTTYPE_L — localized name (zh-CN).
    await new sql.Request(tx)
      .input('pkid', sql.VarChar(36), randomUUID().toUpperCase())
      .input('fid', sql.VarChar(36), extId)
      .input('name', sql.NVarChar(510), params.extName).query(`
        INSERT INTO T_META_OBJECTTYPE_L (FPKID, FID, FLOCALEID, FNAME, FKERNELXMLLANG)
        VALUES (@pkid, @fid, 2052, @name, '')`);

    // 3. T_META_OBJECTTYPE_E — extension marker.
    await new sql.Request(tx)
      .input('fid', sql.VarChar(36), extId)
      .query('INSERT INTO T_META_OBJECTTYPE_E (FID, FSEQ) VALUES (@fid, 0)');

    // 4. T_META_OBJECTTYPENAMEEX — self-reference row.
    await new sql.Request(tx)
      .input('fid', sql.VarChar(36), extId)
      .query('INSERT INTO T_META_OBJECTTYPENAMEEX (FENTRYID, FID) VALUES (@fid, @fid)');

    // 5. T_META_OBJECTTYPENAMEEX_L — localized ext name.
    await new sql.Request(tx)
      .input('pkid', sql.VarChar(36), randomUUID())
      .input('fid', sql.VarChar(36), extId)
      .input('name', sql.NVarChar(510), params.extName).query(`
        INSERT INTO T_META_OBJECTTYPENAMEEX_L (FPKID, FENTRYID, FLOCALEID, FNAMEEX)
        VALUES (@pkid, @fid, 2052, @name)`);

    // 6. T_META_OBJECTFUNCINTERFACE — FFUNCID=2 for bill edit.
    await new sql.Request(tx)
      .input('entry', sql.VarChar(36), randomUUID())
      .input('fid', sql.VarChar(36), extId).query(`
        INSERT INTO T_META_OBJECTFUNCINTERFACE (FENTRYID, FID, FFUNCID)
        VALUES (@entry, @fid, 2)`);

    // 7. T_META_OBJECTTYPEREF — clone all FK references from parent.
    await new sql.Request(tx)
      .input('ext', sql.VarChar(36), extId)
      .input('parent', sql.VarChar(64), params.parentFormId).query(`
        INSERT INTO T_META_OBJECTTYPEREF (FOBJECTTYPEID, FREFOBJECTTYPEID, FTABLENAME, FFIELDNAME)
        SELECT @ext, FREFOBJECTTYPEID, FTABLENAME, FFIELDNAME
          FROM T_META_OBJECTTYPEREF
         WHERE FOBJECTTYPEID = @parent`);

    // 8. T_META_TRACKERBILLTABLE — clone from parent, generating new FTABLEID.
    // FTABLEID is a global-unique int, not per-object, so direct clone
    // would violate the PK — MAX+N per cloned row mirrors BOS behavior.
    await new sql.Request(tx)
      .input('ext', sql.VarChar(36), extId)
      .input('parent', sql.VarChar(64), params.parentFormId).query(`
        DECLARE @maxId INT = (SELECT ISNULL(MAX(FTABLEID), 0) FROM T_META_TRACKERBILLTABLE);
        INSERT INTO T_META_TRACKERBILLTABLE (FTABLEID, FTABLENAME, FPKFIELDNAME, FOBJECTTYPEID)
        SELECT @maxId + ROW_NUMBER() OVER (ORDER BY FTABLEID),
               FTABLENAME, FPKFIELDNAME, @ext
          FROM T_META_TRACKERBILLTABLE
         WHERE FOBJECTTYPEID = @parent`);

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return { extId, backupFile };
}

// ─── deleteExtension ──────────────────────────────────────────────────

/**
 * Remove an extension plus every row it owns across the 8 whitelisted
 * tables, wrapped in one transaction. Takes a full pre-delete snapshot
 * first so the user has a manual restore path.
 *
 * This is deliberately a "nuclear" operation — if the caller only wants
 * to remove a single plugin, use `unregisterPlugin` instead.
 */
export async function deleteExtension(
  pool: sql.ConnectionPool,
  projectId: string,
  extId: string
): Promise<{ backupFile: string }> {
  const snapshot = await snapshotExtension(pool, extId, 'delete-extension');
  const backupFile = await writeBackupSnapshot(projectId, snapshot);
  if ((snapshot.tables.T_META_OBJECTTYPE?.length ?? 0) === 0) {
    throw new Error(`extension ${extId} not found`);
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Matching key columns from bos-backup.KEY_COLUMN. We don't import the
    // map because the delete order differs: we want child-ish tables gone
    // before the OBJECTTYPE row (to avoid dangling references if a future
    // schema adds FK constraints).
    const deletes: Array<[string, string]> = [
      ['T_META_TRACKERBILLTABLE', 'FOBJECTTYPEID'],
      ['T_META_OBJECTTYPEREF', 'FOBJECTTYPEID'],
      ['T_META_OBJECTFUNCINTERFACE', 'FID'],
      ['T_META_OBJECTTYPENAMEEX_L', 'FENTRYID'],
      ['T_META_OBJECTTYPENAMEEX', 'FENTRYID'],
      ['T_META_OBJECTTYPE_E', 'FID'],
      ['T_META_OBJECTTYPE_L', 'FID'],
      ['T_META_OBJECTTYPE', 'FID']
    ];
    for (const [table, col] of deletes) {
      const sqlText = `DELETE FROM ${table} WHERE ${col} = @id`;
      requireValid(sqlText);
      await new sql.Request(tx).input('id', sql.VarChar(64), extId).query(sqlText);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  return { backupFile };
}
