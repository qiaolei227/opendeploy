import { describe, expect, it, afterEach } from 'vitest';
import { encodeAppLayer } from '../../../src/main/erp/k3cloud/rpc/codec';
import { getCurrentIsv } from '../../../src/main/erp/k3cloud/rpc/get-current-isv';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';

const realFetch = globalThis.fetch;

const session: KdSession = {
  baseUrl: 'http://localhost/k3cloud',
  aspNetSessionId: 'asp1',
  kdServiceSessionId: 'kd1',
};

describe('getCurrentIsv', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('hits DataCenterService.GetCurrentISV (no DataCenter. namespace prefix)', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(
        encodeAppLayer(
          JSON.stringify({
            Id: 'IBHC-LMFG-QIMZ-LHQA-VFBK',
            Name: 'UNW',
            ISVSignal: '',
            PackageSignal: '',
            DevCode: 'UNW',
          }),
        ),
      );
    }) as typeof fetch;

    await getCurrentIsv(session);

    // Note: service path is `DataCenterService` directly under ServicesStub,
    // NOT `DataCenter.DataCenterService` like other endpoints.
    expect(capturedUrl).toBe(
      'http://localhost/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.DataCenterService.GetCurrentISV.common.kdsvc',
    );
  });

  it('returns parsed ISV descriptor', async () => {
    globalThis.fetch = (async () =>
      new Response(
        encodeAppLayer(
          JSON.stringify({
            Id: 'IBHC-LMFG-QIMZ-LHQA-VFBK',
            Name: 'UNW',
            ISVSignal: '',
            PackageSignal: '',
            DevCode: 'UNW',
          }),
        ),
      )) as typeof fetch;

    const isv = await getCurrentIsv(session);
    expect(isv).toEqual({
      Id: 'IBHC-LMFG-QIMZ-LHQA-VFBK',
      Name: 'UNW',
      ISVSignal: '',
      PackageSignal: '',
      DevCode: 'UNW',
    });
  });

  it('handles raw-JSON response (no app-layer encoding)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        '{"Id":"X","Name":"Y","ISVSignal":"","PackageSignal":"","DevCode":"Y"}',
      )) as typeof fetch;
    const isv = await getCurrentIsv(session);
    expect(isv.Id).toBe('X');
    expect(isv.Name).toBe('Y');
  });

  it('throws on empty response (contract violation)', async () => {
    globalThis.fetch = (async () => new Response('')) as typeof fetch;
    await expect(getCurrentIsv(session)).rejects.toThrow();
  });
});
