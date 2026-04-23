import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type sql from 'mssql';
import {
  listExtensions,
  listFormPlugins,
  probeBosEnvironment,
  registerPythonPluginOnExtension,
  unregisterPlugin
} from '../../src/main/erp/k3cloud/bos-writer';
import { buildExtensionKernelXml } from '../../src/main/erp/k3cloud/bos-xml';

/**
 * Thin fake for `mssql.ConnectionPool`: captures the SQL + bound parameters
 * from each `.request()` chain and returns the caller-supplied recordset.
 * Same pattern already used in `k3cloud-connector.test.ts`; kept inline so
 * each test can set a fresh result without shared mutable state.
 */
interface FakeCall {
  sql: string;
  inputs: Record<string, unknown>;
}

function makeFakePool(opts: {
  queryResult?: { recordset: unknown[] };
  throwOnQuery?: Error;
  capture?: FakeCall[];
}): sql.ConnectionPool {
  const makeRequest = () => {
    const inputs: Record<string, unknown> = {};
    const req = {
      input: (name: string, _type?: unknown, val?: unknown) => {
        inputs[name] = val;
        return req;
      },
      query: async <_T>(text: string) => {
        opts.capture?.push({ sql: text, inputs });
        if (opts.throwOnQuery) throw opts.throwOnQuery;
        return opts.queryResult ?? { recordset: [] };
      }
    };
    return req;
  };
  return { request: makeRequest } as unknown as sql.ConnectionPool;
}

describe('probeBosEnvironment', () => {
  it('returns status=ready when the metadata table is readable', async () => {
    const pool = makeFakePool({ queryResult: { recordset: [{ FID: 'whatever' }] } });
    const r = await probeBosEnvironment(pool);
    expect(r.status).toBe('ready');
    // developerCode is deliberately gone from the shape post-2026-04-23.
    expect((r as Record<string, unknown>).developerCode).toBeUndefined();
  });

  it('returns status=ready even when the table is empty (fresh DB)', async () => {
    const pool = makeFakePool({ queryResult: { recordset: [] } });
    const r = await probeBosEnvironment(pool);
    expect(r.status).toBe('ready');
  });

  it('returns status=not-initialized when the query throws (no connection / no read perms)', async () => {
    const pool = makeFakePool({ throwOnQuery: new Error('permission denied on T_META_OBJECTTYPE') });
    const r = await probeBosEnvironment(pool);
    expect(r.status).toBe('not-initialized');
    expect(r.reason).toMatch(/T_META_OBJECTTYPE/);
    expect(r.reason).toMatch(/permission denied/);
  });

  it('does not bind any user-scoped parameter (no FUSERID required)', async () => {
    const captured: FakeCall[] = [];
    const pool = makeFakePool({ queryResult: { recordset: [] }, capture: captured });
    await probeBosEnvironment(pool);
    expect(captured).toHaveLength(1);
    expect(Object.keys(captured[0].inputs)).toHaveLength(0);
  });
});

describe('listExtensions', () => {
  it('maps recordset rows to ExtensionMeta shape', async () => {
    const pool = makeFakePool({
      queryResult: {
        recordset: [
          {
            FID: '719dec90-f2d9-4c13-b26e-08b88642c3eb',
            FBASEOBJECTID: 'SAL_SaleOrder',
            FNAME: '销售订单',
            FSUPPLIERNAME: 'PAIJ',
            FMODIFYDATE: new Date('2026-04-21T20:43:18.623Z')
          }
        ]
      }
    });
    const exts = await listExtensions(pool, 'SAL_SaleOrder');
    expect(exts).toEqual([
      {
        extId: '719dec90-f2d9-4c13-b26e-08b88642c3eb',
        parentFormId: 'SAL_SaleOrder',
        name: '销售订单',
        developerCode: 'PAIJ',
        modifyDate: '2026-04-21T20:43:18.623Z'
      }
    ]);
  });

  it('falls back to FID when the localized FNAME is missing', async () => {
    const pool = makeFakePool({
      queryResult: {
        recordset: [
          {
            FID: 'some-guid',
            FBASEOBJECTID: 'SAL_SaleOrder',
            FNAME: 'some-guid', // COALESCE in SQL returns FID when FNAME is NULL
            FSUPPLIERNAME: null,
            FMODIFYDATE: null
          }
        ]
      }
    });
    const [ext] = await listExtensions(pool, 'SAL_SaleOrder');
    expect(ext.name).toBe('some-guid');
    expect(ext.developerCode).toBeNull();
    expect(ext.modifyDate).toBeNull();
  });

  it('returns [] when the parent form has no extensions', async () => {
    const pool = makeFakePool({ queryResult: { recordset: [] } });
    expect(await listExtensions(pool, 'SAL_SaleOrder')).toEqual([]);
  });

  it('binds @parent + @locale parameters', async () => {
    const captured: FakeCall[] = [];
    const pool = makeFakePool({ queryResult: { recordset: [] }, capture: captured });
    await listExtensions(pool, 'SAL_SaleOrder');
    expect(captured[0].inputs.parent).toBe('SAL_SaleOrder');
    expect(captured[0].inputs.locale).toBe(2052);
  });
});

describe('listFormPlugins', () => {
  it('returns [] when the form has no FKERNELXML', async () => {
    const pool = makeFakePool({ queryResult: { recordset: [{ xml: null }] } });
    expect(await listFormPlugins(pool, 'SAL_SaleOrder')).toEqual([]);
  });

  it('returns [] when the row does not exist', async () => {
    const pool = makeFakePool({ queryResult: { recordset: [] } });
    expect(await listFormPlugins(pool, 'MISSING')).toEqual([]);
  });

  it('parses a Python plugin via the canonical XML shape', async () => {
    // Shape taken from the reference extension 719dec90-… (real UAT data).
    const xml = [
      '<FormMetadata><BusinessInfo><BusinessInfo><Elements>',
      '<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">',
      '<Id>719dec90-f2d9-4c13-b26e-08b88642c3eb</Id>',
      '<FormPlugins>',
      '<PlugIn ElementType="0" ElementStyle="0">',
      '<ClassName>opendeploy_python_test</ClassName>',
      '<PlugInType>1</PlugInType>',
      '<PyScript>#opendeploy_python_test</PyScript>',
      '</PlugIn>',
      '</FormPlugins>',
      '</Form>',
      '</Elements></BusinessInfo></BusinessInfo></FormMetadata>'
    ].join('');
    const pool = makeFakePool({ queryResult: { recordset: [{ xml }] } });
    const plugins = await listFormPlugins(pool, '719dec90-f2d9-4c13-b26e-08b88642c3eb');
    expect(plugins).toEqual([
      {
        className: 'opendeploy_python_test',
        type: 'python',
        pyScript: '#opendeploy_python_test'
      }
    ]);
  });

  it('binds @id as VarChar(64) — accepts both GUIDs and standard form ids', async () => {
    const captured: FakeCall[] = [];
    const pool = makeFakePool({
      queryResult: { recordset: [{ xml: null }] },
      capture: captured
    });
    await listFormPlugins(pool, 'SAL_SaleOrder');
    expect(captured[0].inputs.id).toBe('SAL_SaleOrder');
  });
});

/**
 * Smarter fake pool for the write-side tests: dispatches per-table stubs
 * for the 8 snapshot SELECTs plus a generic UPDATE catcher. Needed because
 * register / unregister call `snapshotExtension` which hits 8 tables.
 */
interface WritePoolOpts {
  tables: Record<string, Record<string, unknown>[]>;
  updateCapture: Array<{ sql: string; inputs: Record<string, unknown> }>;
}
function makeWritePool(opts: WritePoolOpts): sql.ConnectionPool {
  const makeRequest = () => {
    const inputs: Record<string, unknown> = {};
    const req = {
      input: (n: string, _t?: unknown, v?: unknown) => {
        inputs[n] = v;
        return req;
      },
      query: async <_T>(text: string) => {
        const tableMatch = text.match(/FROM (T_[A-Z_]+)/);
        if (/^\s*UPDATE\b/i.test(text)) {
          opts.updateCapture.push({ sql: text, inputs: { ...inputs } });
          return { recordset: [] };
        }
        if (tableMatch) {
          return { recordset: opts.tables[tableMatch[1]] ?? [] };
        }
        return { recordset: [] };
      }
    };
    return req;
  };
  return { request: makeRequest } as unknown as sql.ConnectionPool;
}

describe('registerPythonPluginOnExtension', () => {
  const EXT = '96d3fbdd-d383-4ea8-b119-4b9703b9567c';
  let tempHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'opendeploy-writer-test-'));
    prevHome = process.env.OPENDEPLOY_HOME;
    process.env.OPENDEPLOY_HOME = tempHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENDEPLOY_HOME;
    else process.env.OPENDEPLOY_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('UPDATEs FKERNELXML with the new plugin appended', async () => {
    const updates: WritePoolOpts['updateCapture'] = [];
    const pool = makeWritePool({
      updateCapture: updates,
      tables: {
        T_META_OBJECTTYPE: [
          { FID: EXT, FKERNELXML: buildExtensionKernelXml(EXT, []) }
        ]
      }
    });
    const res = await registerPythonPluginOnExtension(pool, 'pid', EXT, {
      className: 'new_plugin',
      type: 'python',
      pyScript: '# body'
    });
    expect(res.backupFile).toContain('_register-plugin_');
    expect(updates).toHaveLength(1);
    const xmlArg = String(updates[0].inputs.xml);
    expect(xmlArg).toContain('<ClassName>new_plugin</ClassName>');
    expect(xmlArg).toContain('<PlugInType>1</PlugInType>');
    expect(xmlArg).toContain('<PyScript># body</PyScript>');
    expect(updates[0].inputs.id).toBe(EXT);
    // Writer no longer binds FMODIFIERID via parameter — it's a literal 0 in SQL.
    expect(updates[0].inputs.uid).toBeUndefined();
    expect(updates[0].sql).toMatch(/FMODIFIERID\s*=\s*0/);
  });

  it('throws when adding a plugin whose ClassName already exists', async () => {
    const pool = makeWritePool({
      updateCapture: [],
      tables: {
        T_META_OBJECTTYPE: [
          {
            FID: EXT,
            FKERNELXML: buildExtensionKernelXml(EXT, [
              { className: 'dupe', type: 'python', pyScript: '' }
            ])
          }
        ]
      }
    });
    await expect(
      registerPythonPluginOnExtension(pool, 'pid', EXT, {
        className: 'dupe',
        type: 'python',
        pyScript: '# new'
      })
    ).rejects.toThrow(/already registered/);
  });

  it('throws when the target extension is missing', async () => {
    const pool = makeWritePool({ updateCapture: [], tables: {} });
    await expect(
      registerPythonPluginOnExtension(pool, 'pid', EXT, {
        className: 'x',
        type: 'python',
        pyScript: ''
      })
    ).rejects.toThrow(/not found/);
  });

  it('refuses a DLL plugin — registration path is Python-only', async () => {
    const pool = makeWritePool({ updateCapture: [], tables: {} });
    await expect(
      registerPythonPluginOnExtension(pool, 'pid', EXT, {
        className: 'Foo.Bar, Foo',
        type: 'dll',
        orderId: 1
      })
    ).rejects.toThrow(/only accepts Python/);
  });
});

describe('unregisterPlugin', () => {
  const EXT = '96d3fbdd-d383-4ea8-b119-4b9703b9567c';
  let tempHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'opendeploy-writer-test-'));
    prevHome = process.env.OPENDEPLOY_HOME;
    process.env.OPENDEPLOY_HOME = tempHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENDEPLOY_HOME;
    else process.env.OPENDEPLOY_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('UPDATEs FKERNELXML with the named plugin removed', async () => {
    const updates: WritePoolOpts['updateCapture'] = [];
    const initialXml = buildExtensionKernelXml(EXT, [
      { className: 'keep', type: 'python', pyScript: '# k' },
      { className: 'drop', type: 'python', pyScript: '# d' }
    ]);
    const pool = makeWritePool({
      updateCapture: updates,
      tables: { T_META_OBJECTTYPE: [{ FID: EXT, FKERNELXML: initialXml }] }
    });
    await unregisterPlugin(pool, 'pid', EXT, 'drop');
    expect(updates).toHaveLength(1);
    const xmlArg = String(updates[0].inputs.xml);
    expect(xmlArg).toContain('<ClassName>keep</ClassName>');
    expect(xmlArg).not.toContain('<ClassName>drop</ClassName>');
  });

  it('no-ops (no UPDATE) when the plugin is already absent', async () => {
    const updates: WritePoolOpts['updateCapture'] = [];
    const pool = makeWritePool({
      updateCapture: updates,
      tables: {
        T_META_OBJECTTYPE: [
          { FID: EXT, FKERNELXML: buildExtensionKernelXml(EXT, []) }
        ]
      }
    });
    const res = await unregisterPlugin(pool, 'pid', EXT, 'missing');
    expect(updates).toHaveLength(0);
    expect(res.backupFile).toContain('_unregister-plugin_');
  });
});

describe('createExtensionWithPythonPlugin · T_META_TRACKERBILLTABLE FTABLEID allocation', () => {
  it('tracker base stays in the 900000+ range to avoid BOS Designer PK conflicts', () => {
    // Regression guard. BOS Designer's internal allocator picks FTABLEIDs
    // in the 100000-500000 range when saving new fields on our extension;
    // our clones must sit in a disjoint high range or the user's add-field
    // save blows up with PK violation. 2026-04-23 UAT 实证 — see memory
    // `bos_tracker_ftableid_conflict`. If this test fails because the SQL
    // changed, **read that memory note before removing the 900000 floor**.
    const src = readFileSync(
      fileURLToPath(new URL('../../src/main/erp/k3cloud/bos-writer.ts', import.meta.url)),
      'utf-8'
    );
    expect(src).toMatch(/IF\s+@base\s*<\s*900000/);
    expect(src).toMatch(/SET\s+@base\s*=\s*899999/);
  });
});
