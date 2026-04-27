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

export interface KdSession {
  /** K/3 Cloud Web Server root, e.g. "http://localhost/k3cloud". No trailing slash. */
  baseUrl: string;
  /** ASP.NET_SessionId cookie value. */
  aspNetSessionId?: string;
  /** kdservice-sessionid cookie + header value. */
  kdServiceSessionId?: string;
  /** Returned by Login flow; not currently used outside Login. */
  accessToken?: string;
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

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: form.toString(),
  });

  // Node fetch decompresses gzip transparently. The response body, after
  // HTTP-layer gunzip, is itself an app-layer base64+zlib payload.
  const rawText = await res.text();
  const bodyText = rawText.trim() ? decodeAppLayerString(rawText) : '';

  const setCookieHeaders: string[] = [];
  // Node fetch returns a Headers object; getSetCookie works on Node 22+.
  const sc = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (sc) setCookieHeaders.push(...sc);

  return { bodyText, setCookieHeaders, status: res.status };
}

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

/** Convenience: parse a JSON response body. */
export function parseJsonResponse<T = unknown>(bodyText: string): T {
  return JSON.parse(bodyText) as T;
}
