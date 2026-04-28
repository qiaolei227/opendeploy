import { afterEach, describe, expect, it } from 'vitest';
import { encodeAppLayer } from '../../src/main/erp/k3cloud/rpc/codec';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { BosRpcCredentials } from '@shared/erp-types';

/**
 * BOS-only connector tests. We mock `globalThis.fetch` per-test and route
 * by request URL — login goes through `User.UserService.GetPublicKeyInfo`
 * + `User.UserService.ValidateLoginInfo`, then metadata reads land on
 * `Metadata.SQLScriptService.GetBusinessObjectMetaData` etc.
 *
 * These replace the SQL/mssql-pool tests deleted in the BOS-only migration.
 * The wire format is verified end-to-end via scripts/bos-recon/smoke-*.
 */

const realFetch = globalThis.fetch;

const TEST_CREDS: BosRpcCredentials = {
  baseUrl: 'http://localhost/k3cloud',
  acctId: '69a531ee82525a',
  username: 'demo',
  password: 'pwd',
  devCode: 'PAIJ',
};

/** Route fetches by URL substring; each route returns a JSON body string. */
function mockedFetch(routes: Record<string, () => string>): typeof fetch {
  return (async (url: string) => {
    for (const [needle, fn] of Object.entries(routes)) {
      if (url.includes(needle)) {
        const body = fn();
        return new Response(encodeAppLayer(body), { status: 200 });
      }
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  }) as typeof fetch;
}

const SUCCESSFUL_LOGIN_ROUTES = {
  GetPublicKeyInfo: () => '""', // empty obfuscated key — login.ts treats as plaintext path
  ValidateLoginInfo: () =>
    JSON.stringify({
      LoginResultType: 1,
      Message: '登录成功',
      KDSVCSessionId: 'fake-session-id',
      Context: { UserId: 100002, UserName: 'demo', CustomName: '演示账户' },
    }),
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('K3CloudConnector connect/disconnect', () => {
  it('connect() drives login + caches the session', async () => {
    globalThis.fetch = mockedFetch(SUCCESSFUL_LOGIN_ROUTES);
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    expect(c.getSession()?.kdServiceSessionId).toBe('fake-session-id');
  });

  it('connect() is idempotent', async () => {
    globalThis.fetch = mockedFetch(SUCCESSFUL_LOGIN_ROUTES);
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    const first = c.getSession();
    await c.connect();
    expect(c.getSession()).toBe(first); // session object reused
  });

  it('disconnect() clears the session and allows reconnect', async () => {
    globalThis.fetch = mockedFetch(SUCCESSFUL_LOGIN_ROUTES);
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    await c.disconnect();
    expect(c.getSession()).toBeNull();
    await c.connect();
    expect(c.getSession()).not.toBeNull();
  });

  it('connect() throws when login reports failure', async () => {
    globalThis.fetch = mockedFetch({
      GetPublicKeyInfo: () => '""',
      ValidateLoginInfo: () =>
        JSON.stringify({ LoginResultType: 0, Message: '密码错误', Context: null }),
    });
    const c = new K3CloudConnector(TEST_CREDS);
    await expect(c.connect()).rejects.toThrow(/BOS login failed/);
  });

  it('read methods reject before connect()', async () => {
    const c = new K3CloudConnector(TEST_CREDS);
    await expect(c.getObject('SAL_SaleOrder')).rejects.toThrow(/not connected/);
    await expect(c.getFields('SAL_SaleOrder')).rejects.toThrow(/not connected/);
    await expect(c.listExtensions('SAL_SaleOrder')).rejects.toThrow(/not connected/);
  });
});

describe('K3CloudConnector.testConnection', () => {
  it('returns ok=true on successful login', async () => {
    globalThis.fetch = mockedFetch(SUCCESSFUL_LOGIN_ROUTES);
    const c = new K3CloudConnector(TEST_CREDS);
    const r = await c.testConnection();
    expect(r.ok).toBe(true);
  });

  it('returns ok=false with the server message on auth failure', async () => {
    globalThis.fetch = mockedFetch({
      GetPublicKeyInfo: () => '""',
      ValidateLoginInfo: () =>
        JSON.stringify({ LoginResultType: 0, Message: '账户已锁定', Context: null }),
    });
    const c = new K3CloudConnector(TEST_CREDS);
    const r = await c.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('账户已锁定');
  });
});

describe('K3CloudConnector metadata RPC reads', () => {
  /** Minimal MetaData envelope used by tests below. */
  function metaDataXml(opts: {
    objectId: string;
    fid?: string;
    fbase?: string;
    kernelXml?: string;
    fsupplier?: string;
  }): string {
    const fid = opts.fid ?? opts.objectId;
    const fbase = opts.fbase ?? '';
    const kernel = opts.kernelXml ?? '';
    const supplier = opts.fsupplier ?? '';
    return (
      `<MetaData businessObjectId="${opts.objectId}" TableName="T_META_OBJECTTYPE">` +
      `<SQLData><Comment>` +
      `<FID>${fid}</FID>` +
      `<FMODELTYPEID>100</FMODELTYPEID>` +
      `<FBASEOBJECTID>${fbase}</FBASEOBJECTID>` +
      `<FSUPPLIERNAME>${supplier}</FSUPPLIERNAME>` +
      `<FMODIFYDATE>2026-04-27 12:00:00</FMODIFYDATE>` +
      `<FISTEMPLATE>0</FISTEMPLATE>` +
      `</Comment></SQLData>` +
      `<XmlData ColName="FKERNELXML"><Comment>${kernel}</Comment></XmlData>` +
      `</MetaData>`
    );
  }

  function localizedNameXml(name: string): string {
    return (
      `<MetaData TableName="T_META_OBJECTTYPE_L">` +
      `<SQLData><Comment>` +
      `<FNAME>${name}</FNAME>` +
      `</Comment></SQLData>` +
      `</MetaData>`
    );
  }

  it('getObject parses scalar columns and the localized name', async () => {
    globalThis.fetch = mockedFetch({
      ...SUCCESSFUL_LOGIN_ROUTES,
      GetBusinessObjectMetaData: () =>
        JSON.stringify({
          metaData: metaDataXml({ objectId: 'SAL_SaleOrder', fbase: 'SAL_BillTemplate' }),
          metaData2052: localizedNameXml('销售订单'),
        }),
    });
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    const obj = await c.getObject('SAL_SaleOrder');
    expect(obj).not.toBeNull();
    expect(obj!.id).toBe('SAL_SaleOrder');
    expect(obj!.name).toBe('销售订单');
    expect(obj!.baseObjectId).toBe('SAL_BillTemplate');
    expect(obj!.modelTypeId).toBe(100);
  });

  it('getObject returns null when server returns empty Dictionary', async () => {
    globalThis.fetch = mockedFetch({
      ...SUCCESSFUL_LOGIN_ROUTES,
      GetBusinessObjectMetaData: () => JSON.stringify({}),
    });
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    const obj = await c.getObject('NONEXISTENT_FORM');
    expect(obj).toBeNull();
  });

  it('getFields composes RPC + parser to produce field list', async () => {
    const kernel =
      `<FormMetadata><BusinessInfo><BusinessInfo><Elements>` +
      `<TextField ElementType="1" ElementStyle="0">` +
      `<Name>客户名称</Name><Id>uuid-1</Id><Key>FCustName</Key>` +
      `</TextField>` +
      `<BaseDataField ElementType="13" ElementStyle="0">` +
      `<Name>客户</Name><Id>uuid-2</Id><Key>FCustId</Key>` +
      `</BaseDataField>` +
      `</Elements></BusinessInfo></BusinessInfo></FormMetadata>`;
    globalThis.fetch = mockedFetch({
      ...SUCCESSFUL_LOGIN_ROUTES,
      GetBusinessObjectMetaData: () =>
        JSON.stringify({
          metaData: metaDataXml({ objectId: 'SAL_SaleOrder', kernelXml: kernel }),
          metaData2052: localizedNameXml('销售订单'),
        }),
    });
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    const fields = await c.getFields('SAL_SaleOrder');
    expect(fields).toHaveLength(2);
    expect(fields.map((f) => f.key).sort()).toEqual(['FCustId', 'FCustName']);
  });

  it('listExtensions composes GetExtendObjectTypeId + per-extension getMeta', async () => {
    const extId = 'abcdef0123456789abcdef0123456789';
    let getMetaCalls = 0;
    globalThis.fetch = mockedFetch({
      ...SUCCESSFUL_LOGIN_ROUTES,
      GetExtendObjectTypeId: () => JSON.stringify([extId]),
      GetBusinessObjectMetaData: () => {
        getMetaCalls++;
        return JSON.stringify({
          metaData: metaDataXml({
            objectId: extId,
            fid: extId,
            fbase: 'SAL_SaleOrder',
            fsupplier: 'PAIJ',
          }),
          metaData2052: localizedNameXml('销售订单 PAIJ 扩展'),
        });
      },
    });
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    const exts = await c.listExtensions('SAL_SaleOrder');
    expect(getMetaCalls).toBe(1);
    expect(exts).toHaveLength(1);
    expect(exts[0].extId).toBe(extId);
    expect(exts[0].parentFormId).toBe('SAL_SaleOrder');
    expect(exts[0].name).toBe('销售订单 PAIJ 扩展');
    expect(exts[0].developerCode).toBe('PAIJ');
  });

  it('listExtensions short-circuits when there are no extensions', async () => {
    globalThis.fetch = mockedFetch({
      ...SUCCESSFUL_LOGIN_ROUTES,
      GetExtendObjectTypeId: () => JSON.stringify([]),
    });
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    expect(await c.listExtensions('SAL_SaleOrder')).toEqual([]);
  });

  it('listFormPlugins composes RPC + plugin parser', async () => {
    const kernel =
      `<FormMetadata><BusinessInfo><BusinessInfo><Elements>` +
      `<Form ElementType="100" ElementStyle="0"><Id>SAL_SaleOrder</Id>` +
      `<FormPlugins>` +
      `<PlugIn ElementType="0" ElementStyle="0">` +
      `<ClassName>Kingdee.K3.SCM.Sal.PlugIn.SaleOrderEdit, Kingdee.K3.SCM.Sal</ClassName>` +
      `<OrderId>1</OrderId>` +
      `</PlugIn>` +
      `</FormPlugins>` +
      `</Form>` +
      `</Elements></BusinessInfo></BusinessInfo></FormMetadata>`;
    globalThis.fetch = mockedFetch({
      ...SUCCESSFUL_LOGIN_ROUTES,
      GetBusinessObjectMetaData: () =>
        JSON.stringify({
          metaData: metaDataXml({ objectId: 'SAL_SaleOrder', kernelXml: kernel }),
        }),
    });
    const c = new K3CloudConnector(TEST_CREDS);
    await c.connect();
    const plugins = await c.listFormPlugins('SAL_SaleOrder');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].type).toBe('dll');
    expect(plugins[0].className).toContain('SaleOrderEdit');
  });
});
