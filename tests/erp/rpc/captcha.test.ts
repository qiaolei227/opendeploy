import { describe, expect, it, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import { encodeAppLayer } from '../../../src/main/erp/k3cloud/rpc/codec';
import { fetchCaptchaImage, captchaToDataUrl } from '../../../src/main/erp/k3cloud/rpc/captcha';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';

const realFetch = globalThis.fetch;

const session: KdSession = {
  baseUrl: 'http://localhost/k3cloud',
  aspNetSessionId: 'asp1',
  kdServiceSessionId: 'kd1',
};

// Minimal PNG magic + a few bytes — the server serializes byte[] as a
// JSON-quoted base64 string (verified via diag-captcha against a real server).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_B64 = PNG.toString('base64');

describe('fetchCaptchaImage — kdsvc endpoint (issue #7)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('hits AccountService.GetValidationCodeImageByte, NOT /mobile/ValidateCode.ashx', async () => {
    let url = '';
    globalThis.fetch = (async (u: string) => {
      url = u;
      return new Response(encodeAppLayer(JSON.stringify(PNG_B64)));
    }) as typeof fetch;

    await fetchCaptchaImage(session);

    expect(url).toBe(
      'http://localhost/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService.GetValidationCodeImageByte.common.kdsvc',
    );
    // The old broken path wrote to the wrong session store.
    expect(url).not.toContain('ValidateCode.ashx');
  });

  it('decodes the base64 image and sniffs png content-type', async () => {
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify(PNG_B64)))) as typeof fetch;

    const img = await fetchCaptchaImage(session);

    expect(img.contentType).toBe('image/png');
    expect(Buffer.from(img.bytes).equals(PNG)).toBe(true);
    expect(captchaToDataUrl(img)).toBe(`data:image/png;base64,${PNG_B64}`);
  });
});
