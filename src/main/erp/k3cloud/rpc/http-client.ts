/**
 * Low-level HTTP client for K/3 Cloud `*.common.kdsvc` endpoints.
 *
 * Wraps a `fetch`-style POST with the BOS-specific envelope:
 *   - URL pattern: `{baseUrl}/{ServiceName}.{methodName}.common.kdsvc`
 *   - Body: URL-encoded form with our typed fields (ap0/ap1, clientinfo, ...)
 *   - Headers: cookie-based session, kdservice-sessionid, kdbiz-info JSON
 *   - HTTP-layer gzip handled automatically (Node fetch decompresses)
 *
 * Session state lives on the `KdSession` object — passed in/out of every
 * call. The login module populates this; this module stays auth-agnostic.
 *
 * Application-layer codec lives in `./codec.ts` — this module just moves
 * bytes; callers compress/decompress.
 *
 * NOT IMPLEMENTED YET (skeleton): cookie persistence across calls. Real
 * implementation should keep a cookie jar on KdSession and update from
 * Set-Cookie headers each response.
 */

import { Buffer } from 'node:buffer';
import { encodeAppLayer, decodeAppLayerString } from './codec';
import { buildClientInfo } from './clientinfo';
import { createLogger } from '../../../logger';

const logger = createLogger('erp/k3cloud/http');

export interface KdSession {
  /** K/3 Cloud Web Server root, e.g. "http://localhost/k3cloud". No trailing slash. */
  baseUrl: string;
  /** ASP.NET_SessionId cookie value. */
  aspNetSessionId?: string;
  /** kdservice-sessionid cookie + header value. */
  kdServiceSessionId?: string;
  /** Returned by Login flow; not currently used outside Login. */
  accessToken?: string;
  /**
   * Server-issued obfuscated RSA public key (or empty string when password
   * encryption is disabled). Cached after the first `GetPublicKeyInfo` so
   * the CAPTCHA retry path doesn't re-fetch it — the redundant call has
   * empirically rotated the ASP.NET_SessionId on some K/3 builds, breaking
   * the session-bound VerificationCode lookup.
   */
  obfuscatedKey?: string;
}

/**
 * Format a timestamp like BOS Designer: `yyyy-MM-dd HH:mm:ss` in local time.
 * E.g. "2026-04-27 14:02:03". Note space, not T.
 */
export function bosTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Build the `*.common.kdsvc` endpoint URL.
 * E.g. callKdsvc('Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService', 'SaveForIDEV9')
 *      → '{baseUrl}/Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService.SaveForIDEV9.common.kdsvc'
 */
export function buildKdsvcUrl(baseUrl: string, serviceName: string, methodName: string): string {
  return `${baseUrl}/${serviceName}.${methodName}.common.kdsvc`;
}

export interface KdsvcCallOptions {
  /** Form fields ap0..apN — pre-compressed app-layer payloads (base64 strings). */
  apFields: Record<string, string>;
  /** Whether to set compressed=True / CompressedApx=True flags. Default true. */
  appCompressed?: boolean;
}

/**
 * Thrown when a `*.common.kdsvc` endpoint replies with a `response_error:`
 * envelope. `responseBody` carries the verbatim server text so callers can
 * pattern-match (e.g. surfacing 401-style bodies as auth-expired) or render
 * to the user.
 */
export class BosResponseError extends Error {
  responseBody: string;
  constructor(message: string, responseBody: string) {
    super(message);
    this.name = 'BosResponseError';
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when a business `*.kdsvc` call is rejected by the server because the
 * session is not fully authenticated. The wire signature is HTTP **200** with
 * a bare text body like:
 *   "401 Forbidden ByRspRetStatusCode -- N001: Unexpectable request."
 * It is neither a `response_error:` envelope nor a 4xx status, so without this
 * guard the raw text slips through to `parseJsonResponse` and surfaces as a
 * misleading "not valid JSON" positional error (GitHub issue #7).
 *
 * Root cause (2026-06-05 实证): login "succeeded" enough to hand back cookies
 * but did NOT fully authenticate — most commonly a HARD-expired password
 * (`CheckPasswordPolicy`, isSuccess=false) that the connector previously
 * treated as connected, or an expired/rotated session. The unauthenticated
 * session then gets every business RPC rejected with this body. We throw a
 * typed error so callers / the agent get an actionable message and the
 * verbatim server text. (The `enableFlatShake` handshake header seen on the
 * login response is unrelated — it was an early red herring.)
 */
export class BosRequestRejectedError extends Error {
  responseBody: string;
  httpStatus: number;
  constructor(message: string, responseBody: string, httpStatus: number) {
    super(message);
    this.name = 'BosRequestRejectedError';
    this.responseBody = responseBody;
    this.httpStatus = httpStatus;
  }
}

/**
 * Signature of the K/3 "request rejected" body. `ByRspRetStatusCode` is the
 * stable token across HTTP status codes / N-codes / locale-translated messages,
 * so matching it alone keeps the guard robust without over-fitting one body.
 */
function isServerRejectionBody(body: string): boolean {
  return body.includes('ByRspRetStatusCode');
}

export interface KdsvcResponse {
  /** Decoded app-layer response (base64+zlib unwrapped). */
  bodyText: string;
  /** Set-Cookie values (caller updates session). */
  setCookieHeaders: string[];
  status: number;
}

/**
 * Execute a single `*.common.kdsvc` call.
 *
 * Caller responsibilities:
 *   - Pre-compress payload arguments via codec.encodeAppLayer
 *   - Provide cookies via session (login.ts populates these)
 *   - Decode response with codec.decodeAppLayer (this fn does it for you)
 */
export async function callKdsvc(
  session: KdSession,
  serviceName: string,
  methodName: string,
  opts: KdsvcCallOptions,
): Promise<KdsvcResponse> {
  const url = buildKdsvcUrl(session.baseUrl, serviceName, methodName);
  const clientInfoEncoded = encodeAppLayer(JSON.stringify(buildClientInfo()));

  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.apFields)) form.append(k, v);
  form.append('nonce', '');
  form.append('v', '1.0');
  if (opts.appCompressed !== false) {
    form.append('compressed', 'True');
    form.append('CompressedApx', 'True');
    form.append('compressedapxtype', 'v2');
  }
  form.append('format', '1');
  form.append('timestamp', bosTimestamp());
  form.append('sign', '');
  form.append('useragent', 'Kingdee.BOS.IDE');
  form.append('clientinfo', clientInfoEncoded);

  const cookies: string[] = [];
  if (session.kdServiceSessionId)
    cookies.push(`kdservice-sessionid=${session.kdServiceSessionId}`);
  if (session.aspNetSessionId) cookies.push(`ASP.NET_SessionId=${session.aspNetSessionId}`);

  const kdBizInfo = JSON.stringify({
    m: methodName,
    s: serviceName.split('.').pop() ?? serviceName,
    ih: false,
    sd: new URL(session.baseUrl).host,
    c: 'Kingdee.BOS.IDE',
  });

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'accept': 'gzip',
    'accept-encoding_wpf': 'gzip',
    'accept-charset': 'utf-8',
    'user-agent':
      'Mozilla/5.0 (compatible; OpenDeploy; Kingdee/Kingdee.BOS, Version=9.0.553.12, Culture=neutral, PublicKeyToken=null MANM)',
    'kdbiz-info': kdBizInfo,
  };
  if (session.kdServiceSessionId) headers['kdservice-sessionid'] = session.kdServiceSessionId;
  if (cookies.length) headers['cookie'] = cookies.join('; ');

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: form.toString(),
    });
  } catch (err) {
    // Log full URL + transport code BEFORE the humanized error wraps it —
    // the caught Error retains only the host, so without this line a support
    // bundle can't tell which endpoint failed when multiple were in flight.
    const code = extractTransportCode((err as { cause?: unknown })?.cause) ?? 'unknown';
    void logger.error(
      `${serviceName}.${methodName} transport failed | url=${url} | code=${code}`,
      err instanceof Error ? err : undefined,
    );
    throw humanizeTransportError(err, url);
  }

  // Node fetch decompresses gzip transparently. The response body, after
  // HTTP-layer gunzip, is *usually* an app-layer base64+zlib payload — but
  // some endpoints (e.g. BusinessDataService.GetSequenceInt32) return raw
  // JSON unencoded. Try decode first; if zlib rejects the bytes (typically
  // "incorrect header check"), fall back to the raw text.
  const rawText = await res.text();
  const bodyText = decodeAppLayerOrRaw(rawText);

  // Server-side errors come back as `response_error: {json}` plain-text. If
  // we hand that to parseJsonResponse it dies with "Unexpected token 'r'"
  // and the caller has nothing to act on. Reject here so every caller
  // surfaces the actual server message via the thrown Error.
  const trimmed = bodyText.trim();
  if (trimmed.startsWith('response_error:') || trimmed.startsWith('"response_error:')) {
    void logger.warn(
      `${serviceName}.${methodName} response_error | url=${url} | status=${res.status} | body=${trimmed.slice(0, 300)}`,
    );
    throw new BosResponseError(
      `${serviceName}.${methodName} returned response_error envelope: ${trimmed.slice(0, 1000)}`,
      trimmed,
    );
  }

  // Business RPC rejected for an unauthenticated session: HTTP 200 with a bare
  // text body, NOT a response_error envelope. Catch the signature here so it
  // doesn't masquerade as a downstream JSON-parse failure.
  if (isServerRejectionBody(trimmed)) {
    void logger.warn(
      `${serviceName}.${methodName} request rejected (session not authenticated?) | url=${url} | status=${res.status} | body=${trimmed.slice(0, 300)}`,
    );
    throw new BosRequestRejectedError(
      `K/3 服务器拒绝了该请求(会话未完成认证 / 登录不完整):${trimmed.slice(0, 200)} — ` +
        `常见原因:账号密码已过期(登录看似成功实则未认证),或会话已过期。` +
        `请重置密码 / 重新连接项目后重试。`,
      trimmed,
      res.status,
    );
  }

  // 4xx/5xx without the response_error envelope — server reached, but rejected
  // before BOS layer. Helpful when reverse-proxy / IIS intercepts the request.
  if (res.status >= 400) {
    void logger.warn(
      `${serviceName}.${methodName} http ${res.status} | url=${url} | body=${trimmed.slice(0, 300)}`,
    );
  }

  const setCookieHeaders: string[] = [];
  // Node fetch returns a Headers object; getSetCookie works on Node 22+.
  const sc = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (sc) setCookieHeaders.push(...sc);

  return { bodyText, setCookieHeaders, status: res.status };
}

/**
 * Try app-layer decode (base64 + zlib inflate); on failure, return the raw
 * text. Some BOS endpoints respond with bare JSON despite the request
 * carrying `compressed=True` — most notably tiny utility endpoints like
 * `GetSequenceInt32`. Detection is reactive (try → catch) rather than by
 * Content-Type, since the server doesn't set a discriminating one.
 */
function decodeAppLayerOrRaw(rawText: string): string {
  if (!rawText.trim()) return '';
  try {
    return decodeAppLayerString(rawText);
  } catch {
    return rawText;
  }
}

/**
 * Node's undici throws a bare `TypeError: fetch failed` for every transport
 * problem (TCP refused, DNS miss, TLS issue, timeout). The actionable detail
 * sits in `err.cause.code` — without surfacing it the user has to guess
 * whether IIS is down, the URL is typoed, or a firewall is in the way.
 */
function humanizeTransportError(err: unknown, url: string): Error {
  if (!(err instanceof TypeError) || err.message !== 'fetch failed') {
    return err instanceof Error ? err : new Error(String(err));
  }
  const code = extractTransportCode((err as { cause?: unknown }).cause);
  const host = safeHost(url);
  const hint = code ? TRANSPORT_HINTS[code] : null;
  const detail = hint ?? (code ? `transport error ${code}` : 'transport error');
  const wrapped = new Error(`${detail} — ${host}`);
  (wrapped as { cause?: unknown }).cause = err;
  return wrapped;
}

function extractTransportCode(cause: unknown): string | null {
  if (!cause || typeof cause !== 'object') return null;
  const c = cause as { code?: unknown; errors?: unknown };
  if (typeof c.code === 'string') return c.code;
  // Node 22 dual-stack lookup wraps v4+v6 attempts in AggregateError.
  if (Array.isArray(c.errors)) {
    for (const e of c.errors) {
      const inner = (e as { code?: unknown } | null)?.code;
      if (typeof inner === 'string') return inner;
    }
  }
  return null;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const TRANSPORT_HINTS: Record<string, string> = {
  ECONNREFUSED: 'connection refused (IIS not running / wrong port / firewall blocked)',
  ENOTFOUND: 'host not found (typo in URL / DNS unreachable)',
  ETIMEDOUT: 'connection timed out (network unreachable / firewall dropping packets)',
  EHOSTUNREACH: 'host unreachable (no route)',
  ENETUNREACH: 'network unreachable',
  ECONNRESET: 'connection reset (proxy / firewall interrupted)',
  EPIPE: 'connection pipe broken',
  CERT_HAS_EXPIRED: 'TLS certificate expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is self-signed (not trusted)',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate chain incomplete',
};

/**
 * Pull cookie values from Set-Cookie response headers and update the session.
 * Idempotent — call after every kdsvc response.
 */
export function applySetCookieToSession(session: KdSession, setCookies: string[]): void {
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const [name, value] = pair.split('=');
    if (!name || value === undefined) continue;
    if (name.trim() === 'ASP.NET_SessionId') session.aspNetSessionId = value.trim();
    else if (name.trim() === 'kdservice-sessionid') session.kdServiceSessionId = value.trim();
  }
}

/** Convenience: encode a JSON object as the standard app-layer form value. */
export function encodeApField(payload: unknown): string {
  return encodeAppLayer(JSON.stringify(payload));
}

/** Convenience: encode a raw string (e.g. AcctID alone) as app-layer form value. */
export function encodeApFieldRaw(s: string): string {
  return encodeAppLayer(s);
}

/**
 * Parse a decoded RPC body as JSON. On failure, surface the actual body
 * snippet so callers (and agent tool_results) get an actionable message
 * instead of a generic JSON.parse positional error. K/3 occasionally
 * returns concatenated values (e.g. `null{...}`) when proxy methods
 * declare tuple returns — the snippet immediately reveals which case.
 */
export function parseJsonResponse<T = unknown>(bodyText: string): T {
  try {
    return JSON.parse(bodyText) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const snippet = bodyText.length > 400 ? bodyText.slice(0, 400) + '…' : bodyText;
    throw new Error(
      `K/3 RPC body is not valid JSON: ${msg}. ` +
        `bodyText (${bodyText.length} chars): ${JSON.stringify(snippet)}`,
    );
  }
}
