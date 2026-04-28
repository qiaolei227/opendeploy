import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { encodeAppLayer } from '../../../src/main/erp/k3cloud/rpc/codec';
import { getDataCenterList } from '../../../src/main/erp/k3cloud/rpc/data-center';

const realFetch = globalThis.fetch;

describe('getDataCenterList', () => {
  beforeEach(() => {
    // No fetch mocking by default — set per-test.
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('hits AccountService.GetDataCenterList endpoint with no ap fields', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = String(init?.body ?? '');
      const responseEncoded = encodeAppLayer(JSON.stringify([]));
      return new Response(responseEncoded, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }) as typeof fetch;

    await getDataCenterList('http://localhost/k3cloud');

    expect(capturedUrl).toBe(
      'http://localhost/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService.GetDataCenterList.common.kdsvc',
    );
    // No ap0 / ap1 in the form body — endpoint takes zero args.
    expect(capturedBody).not.toContain('ap0=');
    expect(capturedBody).not.toContain('ap1=');
    // But the standard frame fields ARE present.
    expect(capturedBody).toContain('compressed=True');
    expect(capturedBody).toContain('clientinfo=');
    expect(capturedBody).toContain('v=1.0');
  });

  it('parses real captured response shape (Id / Number / Name + ignored extras)', async () => {
    // Verbatim from capture 2026-04-27 REQ 2 — proves the typed parse handles
    // the actual server output without schema drift.
    const captured = [
      {
        Id: '69a531ee82525a',
        Number: '001',
        Name: '演示账套',
        LocaleValueName: [{ Key: 2052, Value: '演示账套' }],
        DBType: 3,
        AcctType: '10',
        IsNeedValicationCode: false,
        AuthenticationMethods: [
          {
            AuthenticationMethodType: 1,
            Name: '命名用户身份',
          },
        ],
        DefaultMethods: 1,
        RunTask: true,
        Version: null,
        TenantId: '',
        GUID: '',
        Sites: [{ Id: 'K3Cloud', DisplayName: 'K3Cloud' }],
        IsNotDefaultAdmin: false,
        Publickey: '',
        EncryptionType: '',
        SecondMethods: 23,
      },
    ];
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify(captured)))) as typeof fetch;

    const result = await getDataCenterList('http://localhost/k3cloud');
    expect(result).toEqual([
      { id: '69a531ee82525a', number: '001', name: '演示账套' },
    ]);
  });

  it('returns multiple data centers in server order', async () => {
    const captured = [
      { Id: 'dc1', Number: '001', Name: '演示账套' },
      { Id: 'dc2', Number: '002', Name: '生产账套' },
      { Id: 'dc3', Number: '003', Name: '测试账套' },
    ];
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify(captured)))) as typeof fetch;

    const result = await getDataCenterList('http://localhost/k3cloud');
    expect(result.map((d) => d.id)).toEqual(['dc1', 'dc2', 'dc3']);
  });

  it('returns empty array when server has no data-centers configured', async () => {
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify([])))) as typeof fetch;

    const result = await getDataCenterList('http://localhost/k3cloud');
    expect(result).toEqual([]);
  });

  it('returns empty array on completely empty response body (server quirk)', async () => {
    globalThis.fetch = (async () => new Response('')) as typeof fetch;
    const result = await getDataCenterList('http://localhost/k3cloud');
    expect(result).toEqual([]);
  });

  it('honors custom baseUrl with HTTPS + custom port', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(encodeAppLayer(JSON.stringify([])));
    }) as typeof fetch;

    await getDataCenterList('https://k3.customer.com:8443/k3cloud');
    expect(capturedUrl).toBe(
      'https://k3.customer.com:8443/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService.GetDataCenterList.common.kdsvc',
    );
  });
});
