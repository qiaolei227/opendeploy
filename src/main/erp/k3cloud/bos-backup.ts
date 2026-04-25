/**
 * Before any write to the BOS metadata tables, take a snapshot of every
 * row an extension currently owns across all 8 whitelisted tables and
 * persist it as a single JSON file the user can hand-restore from if our
 * write goes wrong. Matches the Plan 5.5 backup requirement called out
 * in CLAUDE.md hard-red-line #1.
 *
 * A later PR will wire `restoreFromBackupFile` for one-click rollback;
 * this module only covers the capture side until that lands. The JSON
 * shape is intentionally table→rows dump so restoration can be done in a
 * straightforward loop without extra metadata.
 */

import sql from 'mssql';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { projectDir } from '../../plugins/paths';
import { validateQuery } from '../validator';

/** The 8 tables whose rows together constitute a complete extension. */
export const BOS_EXTENSION_TABLES = [
  'T_META_OBJECTTYPE',
  'T_META_OBJECTTYPE_L',
  'T_META_OBJECTTYPE_E',
  'T_META_OBJECTTYPENAMEEX',
  'T_META_OBJECTTYPENAMEEX_L',
  'T_META_OBJECTFUNCINTERFACE',
  'T_META_OBJECTTYPEREF',
  'T_META_TRACKERBILLTABLE'
] as const;

/**
 * Column each extension table uses to match the extension FID. Most use
 * `FID` or `FENTRYID` but `T_META_OBJECTTYPEREF` and
 * `T_META_TRACKERBILLTABLE` point at the extension via `FOBJECTTYPEID`
 * (the extension is the object owner, not the object itself there).
 */
const KEY_COLUMN: Record<(typeof BOS_EXTENSION_TABLES)[number], string> = {
  T_META_OBJECTTYPE: 'FID',
  T_META_OBJECTTYPE_L: 'FID',
  T_META_OBJECTTYPE_E: 'FID',
  T_META_OBJECTTYPENAMEEX: 'FENTRYID',
  T_META_OBJECTTYPENAMEEX_L: 'FENTRYID',
  T_META_OBJECTFUNCINTERFACE: 'FID',
  T_META_OBJECTTYPEREF: 'FOBJECTTYPEID',
  T_META_TRACKERBILLTABLE: 'FOBJECTTYPEID'
};

export type BosWriteOperation =
  | 'create-extension'
  | 'register-plugin'
  | 'unregister-plugin'
  | 'delete-extension'
  | 'add-field';

export interface ExtensionSnapshot {
  /** ISO timestamp of when the snapshot was taken. */
  takenAt: string;
  /** Extension FID the snapshot corresponds to. */
  extId: string;
  /** Operation that triggered this backup. */
  operation: BosWriteOperation;
  /** Every row keyed by table, in fetch order. Binary/image columns are dropped. */
  tables: Record<string, Record<string, unknown>[]>;
}

/** Directory that holds per-project backup JSON files. */
export function bosBackupsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'bos-backups');
}

function makeBackupFilename(operation: BosWriteOperation, extId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}_${operation}_${extId}.json`;
}

function requireValid(sqlText: string): void {
  const r = validateQuery(sqlText);
  if (!r.ok) throw new Error(`SQL validator rejected query: ${r.reason ?? 'no reason'}`);
}

function stripBinary(row: Record<string, unknown>): Record<string, unknown> {
  // JSON.stringify of a Buffer emits the full byte array which blows up
  // file sizes for no value — a marker with byte length is enough.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) out[k] = { __binary: true, bytes: v.length };
    else out[k] = v;
  }
  return out;
}

/**
 * Read every row across all 8 extension tables for a given extension FID.
 * Used both as pre-write backup and as the read side of future restore.
 * Returns empty row arrays for tables that have no match — the snapshot
 * is still valid, it just means that table had nothing to preserve.
 */
export async function snapshotExtension(
  pool: sql.ConnectionPool,
  extId: string,
  operation: BosWriteOperation
): Promise<ExtensionSnapshot> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const tableName of BOS_EXTENSION_TABLES) {
    const col = KEY_COLUMN[tableName];
    const sqlText = `SELECT * FROM ${tableName} WHERE ${col} = @v`;
    requireValid(sqlText);
    const r = await pool
      .request()
      .input('v', sql.VarChar(64), extId)
      .query<Record<string, unknown>>(sqlText);
    tables[tableName] = r.recordset.map(stripBinary);
  }
  return {
    takenAt: new Date().toISOString(),
    extId,
    operation,
    tables
  };
}

/**
 * Persist a snapshot to `$OPENDEPLOY_HOME/projects/<pid>/bos-backups/`
 * as a pretty-printed JSON file named with the operation and a UTC
 * timestamp. Returns the absolute path of the written file so callers
 * can surface it in the agent's tool result for user reference.
 */
export async function writeBackupSnapshot(
  projectId: string,
  snapshot: ExtensionSnapshot
): Promise<string> {
  const dir = bosBackupsDir(projectId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, makeBackupFilename(snapshot.operation, snapshot.extId));
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return filePath;
}
