import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type sql from 'mssql';
import {
  BOS_EXTENSION_TABLES,
  bosBackupsDir,
  snapshotExtension,
  writeBackupSnapshot,
  type ExtensionSnapshot
} from '../../src/main/erp/k3cloud/bos-backup';

const EXT = '96d3fbdd-d383-4ea8-b119-4b9703b9567c';

/** Pool stub that returns table-specific canned recordsets. */
function makeFakePool(
  perTable: Record<string, Record<string, unknown>[]>
): sql.ConnectionPool {
  const makeRequest = () => {
    const req = {
      input: (_n: string, _t?: unknown, _v?: unknown) => req,
      query: async <_T>(text: string) => {
        const tableMatch = text.match(/FROM (T_[A-Z_]+)/);
        const rs = tableMatch ? perTable[tableMatch[1]] ?? [] : [];
        return { recordset: rs };
      }
    };
    return req;
  };
  return { request: makeRequest } as unknown as sql.ConnectionPool;
}

describe('snapshotExtension', () => {
  it('reads from every one of the 8 whitelisted tables in a fixed order', async () => {
    const seen: string[] = [];
    const pool = {
      request: () => {
        const req = {
          input: (_n: string, _t?: unknown, _v?: unknown) => req,
          query: async <_T>(text: string) => {
            const match = text.match(/FROM (T_[A-Z_]+)/);
            if (match) seen.push(match[1]);
            return { recordset: [] };
          }
        };
        return req;
      }
    } as unknown as sql.ConnectionPool;
    const snap = await snapshotExtension(pool, EXT, 'register-plugin');
    expect(seen).toEqual([...BOS_EXTENSION_TABLES]);
    expect(snap.extId).toBe(EXT);
    expect(snap.operation).toBe('register-plugin');
    expect(snap.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('captures row contents keyed by table', async () => {
    const pool = makeFakePool({
      T_META_OBJECTTYPE: [
        { FID: EXT, FBASEOBJECTID: 'SAL_SaleOrder', FSUPPLIERNAME: 'PAIJ' }
      ],
      T_META_OBJECTTYPE_L: [{ FID: EXT, FNAME: '销售订单' }],
      T_META_OBJECTTYPEREF: Array.from({ length: 77 }, (_, i) => ({
        FOBJECTTYPEID: EXT,
        FREFOBJECTTYPEID: `ref_${i}`
      }))
    });
    const snap = await snapshotExtension(pool, EXT, 'delete-extension');
    expect(snap.tables.T_META_OBJECTTYPE).toHaveLength(1);
    expect(snap.tables.T_META_OBJECTTYPE[0].FSUPPLIERNAME).toBe('PAIJ');
    expect(snap.tables.T_META_OBJECTTYPE_L).toHaveLength(1);
    expect(snap.tables.T_META_OBJECTTYPEREF).toHaveLength(77);
    // Tables with no match still appear (empty array).
    expect(snap.tables.T_META_OBJECTFUNCINTERFACE).toEqual([]);
  });

  it('replaces Buffer columns with {__binary, bytes} markers to keep backups readable', async () => {
    const pool = makeFakePool({
      T_META_OBJECTTYPE: [{ FID: EXT, FPASSWORD: Buffer.from([1, 2, 3]) }]
    });
    const snap = await snapshotExtension(pool, EXT, 'create-extension');
    const row = snap.tables.T_META_OBJECTTYPE[0];
    expect(row.FPASSWORD).toEqual({ __binary: true, bytes: 3 });
  });
});

describe('writeBackupSnapshot', () => {
  let prevHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'opendeploy-backup-test-'));
    prevHome = process.env.OPENDEPLOY_HOME;
    process.env.OPENDEPLOY_HOME = tempHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENDEPLOY_HOME;
    else process.env.OPENDEPLOY_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('writes the snapshot as pretty-printed JSON under the expected path', async () => {
    const snapshot: ExtensionSnapshot = {
      takenAt: '2026-04-22T03:00:00.000Z',
      extId: EXT,
      operation: 'register-plugin',
      tables: { T_META_OBJECTTYPE: [{ FID: EXT, FSUPPLIERNAME: 'PAIJ' }] }
    };
    const filePath = await writeBackupSnapshot('my-project-id', snapshot);
    expect(filePath).toContain(bosBackupsDir('my-project-id'));
    expect(filePath).toContain(`_register-plugin_${EXT}.json`);

    const written = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(written);
    expect(parsed.extId).toBe(EXT);
    expect(parsed.tables.T_META_OBJECTTYPE[0].FSUPPLIERNAME).toBe('PAIJ');
    // Pretty-printed: file should contain a newline.
    expect(written).toContain('\n');
  });

  it('creates the bos-backups directory if missing', async () => {
    const dir = bosBackupsDir('fresh-project');
    const snapshot: ExtensionSnapshot = {
      takenAt: new Date().toISOString(),
      extId: EXT,
      operation: 'create-extension',
      tables: {}
    };
    await writeBackupSnapshot('fresh-project', snapshot);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });

  it('filename is timestamp-prefixed so lexical sort = chronological', async () => {
    const base: ExtensionSnapshot = { takenAt: '', extId: EXT, operation: 'register-plugin', tables: {} };
    const first = await writeBackupSnapshot('p', { ...base, takenAt: new Date().toISOString() });
    // Force at least a 1 ms gap — the filename timestamp has ms precision.
    await new Promise((r) => setTimeout(r, 5));
    const second = await writeBackupSnapshot('p', { ...base, takenAt: new Date().toISOString() });
    expect(second > first).toBe(true); // string compare == time order
  });
});
