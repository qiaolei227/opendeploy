import { describe, expect, it, afterEach } from 'vitest';
import {
  encodeAppLayer,
  decodeAppLayerString,
} from '../../../src/main/erp/k3cloud/rpc/codec';
import { getNextSequenceInt32 } from '../../../src/main/erp/k3cloud/rpc/sequence';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';

const realFetch = globalThis.fetch;

const session: KdSession = {
  baseUrl: 'http://localhost/k3cloud',
  aspNetSessionId: 'asp1',
  kdServiceSessionId: 'kd1',
};

describe('getNextSequenceInt32', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('hits BusinessDataService.GetSequenceInt32 endpoint', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(encodeAppLayer(JSON.stringify([100002])));
    }) as typeof fetch;

    await getNextSequenceInt32(session, 't_BOS_CustEntry', 1);

    expect(capturedUrl).toBe(
      'http://localhost/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.BusinessDataService.GetSequenceInt32.common.kdsvc',
    );
  });

  it('encodes ap0=category, ap1=increment as app-layer values', async () => {
    let capturedBody = '';
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '');
      return new Response(encodeAppLayer(JSON.stringify([100002])));
    }) as typeof fetch;

    await getNextSequenceInt32(session, 't_BOS_CustEntry', 1);

    const params = new URLSearchParams(capturedBody);
    const ap0 = params.get('ap0');
    const ap1 = params.get('ap1');
    expect(ap0).toBeTruthy();
    expect(ap1).toBeTruthy();
    expect(decodeAppLayerString(ap0!)).toBe('t_BOS_CustEntry');
    // Increment is encoded as the JSON-serialized number (BOS Designer captures
    // show ap1 carries the literal "1" — server tolerates either bare or quoted).
    expect(decodeAppLayerString(ap1!)).toBe('1');
  });

  it('unwraps server array response into a single int', async () => {
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify([100002])))) as typeof fetch;

    const result = await getNextSequenceInt32(session, 't_BOS_CustEntry', 1);
    expect(result).toBe(100002);
  });

  it('honors custom increment values', async () => {
    let capturedAp1 = '';
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      capturedAp1 = params.get('ap1') ?? '';
      return new Response(encodeAppLayer(JSON.stringify([100050])));
    }) as typeof fetch;

    await getNextSequenceInt32(session, 't_BOS_CustEntry', 5);
    expect(decodeAppLayerString(capturedAp1)).toBe('5');
  });

  it('throws on empty / malformed server response', async () => {
    globalThis.fetch = (async () => new Response('')) as typeof fetch;
    await expect(getNextSequenceInt32(session, 't_BOS_CustEntry', 1)).rejects.toThrow();
  });

  it('throws when server returns empty array (sequence allocation contract violated)', async () => {
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify([])))) as typeof fetch;
    await expect(getNextSequenceInt32(session, 't_BOS_CustEntry', 1)).rejects.toThrow();
  });
});
