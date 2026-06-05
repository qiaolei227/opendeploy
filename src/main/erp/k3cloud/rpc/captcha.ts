/**
 * CAPTCHA image fetcher for the K/3 Cloud login flow.
 *
 * IMPORTANT (issue #7, decompiled 2026-06-05): we do NOT use
 * `{baseUrl}/mobile/ValidateCode.ashx`. That handler writes the code into
 * **ASP.NET `HttpContext.Session["VerificationCode"]`** (ASP.NET_SessionId
 * cookie), but the login RPC `UserService.CheckVaicationCode` reads it from
 * the **`KDServiceSession`** (kdservice-sessionid cookie, in-memory
 * `GlobalCacheManager`). Those are two independent stores with no bridge, so
 * a code fetched via the .ashx can never match at login — the server always
 * returns "系统验证码不存在/过期".
 *
 * Instead we call the kdsvc RPC
 * `AccountService.GetValidationCodeImageByte` — it generates the image AND
 * writes the code to `KDServiceSession["VerificationCode"]`, the same store
 * the login reads. Because the call shares the session's kdservice-sessionid,
 * the subsequent `ValidateLoginInfo` (same session) sees the code and matches.
 *
 * Decompile: `AccountService.GetVCodeImageByte()` in
 * `Kingdee.BOS.ServiceFacade.ServicesStub.dll`. The companion
 * `GetVImageInfo4CookieOnly()` returns `{ASPNETSID, KDSID, imageData}` JSON;
 * we use the byte variant since the image is all we need.
 *
 * Implementation notes captured in `.scratch/recon/captcha-login.md`.
 */

import { Buffer } from 'node:buffer';
import { callKdsvc, applySetCookieToSession, parseJsonResponse, type KdSession } from './http-client';
import { createLogger } from '../../../logger';

const logger = createLogger('erp/k3cloud/captcha');

/** kdsvc service that owns the validation-code image generator. */
const ACCOUNT_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService';

export interface CaptchaImage {
  /** Raw image bytes. Empirically image/png from the K/3 server. */
  bytes: Buffer;
  /** Content-Type derived from the image magic bytes (png / jpeg). */
  contentType: string;
}

/**
 * Fetch the next CAPTCHA image via the kdsvc endpoint. Each call rotates the
 * server-side code (bound to this session's kdservice-sessionid), so call
 * once per attempt — refresh-on-wrong-input rebinds a fresh code to the same
 * KDServiceSession.
 *
 * The `session` MUST already carry a kdservice-sessionid (established by an
 * earlier RPC such as `GetPublicKeyInfo`); `callKdsvc` sends it so the code
 * lands in the session the login will read.
 */
export async function fetchCaptchaImage(session: KdSession): Promise<CaptchaImage> {
  void logger.info(
    `GetValidationCodeImageByte request | aspSess=${session.aspNetSessionId ? session.aspNetSessionId.slice(0, 8) + '…' : '(none)'} ` +
      `kdSess=${session.kdServiceSessionId ? session.kdServiceSessionId.slice(0, 8) + '…' : '(none)'}`,
  );

  const res = await callKdsvc(session, ACCOUNT_SERVICE, 'GetValidationCodeImageByte', {
    apFields: {},
  });
  applySetCookieToSession(session, res.setCookieHeaders);

  // Server serializes byte[] as a JSON-quoted base64 string.
  const base64 = parseJsonResponse<string>(res.bodyText);
  const bytes = Buffer.from(base64, 'base64');
  const contentType = sniffImageContentType(bytes);

  void logger.info(
    `GetValidationCodeImageByte response | status=${res.status} contentType=${contentType} bytes=${bytes.length} ` +
      `kdSess=${session.kdServiceSessionId ? session.kdServiceSessionId.slice(0, 8) + '…' : '(none)'}`,
  );

  return { bytes, contentType };
}

/** Detect png vs jpeg from the leading magic bytes; default to jpeg. */
function sniffImageContentType(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return 'image/jpeg';
}

/** Convenience: encode CAPTCHA image as a data URL for renderer `<img src>`. */
export function captchaToDataUrl(img: CaptchaImage): string {
  return `data:${img.contentType};base64,${img.bytes.toString('base64')}`;
}
