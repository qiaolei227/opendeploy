import { describe, expect, it, afterEach } from 'vitest';
import {
  callKdsvc,
  BosRequestRejectedError,
  BosResponseError,
} from '../../../src/main/erp/k3cloud/rpc/http-client';
import { encodeAppLayer } from '../../../src/main/erp/k3cloud/rpc/codec';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';

const realFetch = globalThis.fetch;

const session: KdSession = {
  baseUrl: 'http://localhost/k3cloud',
  aspNetSessionId: 'asp1',
  kdServiceSessionId: 'kd1',
};

const SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';
const call = () => callKdsvc(session, SVC, 'GetExtendObjectTypeId', { apFields: { ap0: 'x' } });

// Real bytes captured against a FlatShake/anti-tamper-enabled K/3 server
// (GitHub issue #7): the request-integrity gate replies HTTP 200 with a bare
// text body, NOT a response_error envelope. Without detection this slips
// through to parseJsonResponse and surfaces as a misleading "not valid JSON".
const REJECTION_BODY = '401 Forbidden ByRspRetStatusCode -- N001: Unexpectable request.';

describe('callKdsvc — server request-rejection detection (issue #7)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('throws BosRequestRejectedError on a FlatShake/anti-tamper rejection (HTTP 200 + text body)', async () => {
    globalThis.fetch = (async () => new Response(REJECTION_BODY, { status: 200 })) as typeof fetch;
    await expect(call()).rejects.toBeInstanceOf(BosRequestRejectedError);
  });

  it('does NOT surface the misleading "not valid JSON" message; carries raw body + http status', async () => {
    globalThis.fetch = (async () => new Response(REJECTION_BODY, { status: 200 })) as typeof fetch;
    try {
      await call();
      throw new Error('expected callKdsvc to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BosRequestRejectedError);
      const err = e as BosRequestRejectedError;
      expect(err.responseBody).toBe(REJECTION_BODY);
      expect(err.httpStatus).toBe(200);
      expect(err.message).not.toContain('not valid JSON');
      // The raw server text must be preserved so the consultant can see it.
      expect(err.message).toContain('Unexpectable request');
    }
  });

  it('lets a normal app-layer JSON response pass through untouched', async () => {
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify(['ext1'])))) as typeof fetch;
    const res = await call();
    expect(res.bodyText).toBe(JSON.stringify(['ext1']));
    expect(res.status).toBe(200);
  });

  it('still throws BosResponseError on a response_error envelope (regression)', async () => {
    globalThis.fetch = (async () => new Response('response_error: {"x":1}')) as typeof fetch;
    await expect(call()).rejects.toBeInstanceOf(BosResponseError);
  });
});
