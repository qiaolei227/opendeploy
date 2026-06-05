/**
 * BOS RPC clientinfo payload.
 *
 * Every BOS RPC request carries a `clientinfo` form field — base64+zlib
 * encoded JSON describing the client machine (MAC/IP/host/OS/version).
 *
 * Real BOS Designer payload (captured 2026-04-27 REQ #98):
 *
 * ```json
 * {
 *   "vH":1024,"vW":768,
 *   "MacAddress":"28:A4:4A:19:8B:D3","HostName":"Qiao",
 *   "IpAddress":"192.168.1.15","Version":"9.0.553.12",
 *   "ScreenSize":null,"AvailableAreaSize":null,
 *   "macAddress":"28:A4:4A:19:8B:D3","hostName":"Qiao",
 *   "ipAddress":"192.168.1.15",
 *   "OperationSystem":"Microsoft Windows NT 6.2.9200.0"
 * }
 * ```
 *
 * Note: MAC/host/IP fields appear in BOTH PascalCase and camelCase — the
 * server reads both forms in different code paths, so we emit both to
 * match BOS Designer wire output exactly.
 *
 * The product version field carries the K3 Cloud client version it pretends
 * to be (`9.0.553.12` matches the install we reverse-engineered against).
 * Hardcoded for now — bumped per K3 Cloud version when we expand support.
 */

import * as os from 'node:os';

export interface BosClientInfo {
  vH: number;
  vW: number;
  MacAddress: string;
  HostName: string;
  IpAddress: string;
  Version: string;
  ScreenSize: null;
  AvailableAreaSize: null;
  macAddress: string;
  hostName: string;
  ipAddress: string;
  OperationSystem: string;
  /**
   * `Kingdee.BOS.Authentication.ClientType` enum value. Matters at login —
   * `UserService.isLoginNeedBoundary` (decompiled 2026-05-18) bypasses CAPTCHA
   * for the "programmatic" client types {Mobile=8, WebApi=32, Speaker=512}.
   *
   * We use **WPF=1** (the interactive desktop client BOS Designer sends), NOT
   * a CAPTCHA-exempt type. Reason (issue #7, 2026-06-05): the K/3 server ties
   * CAPTCHA-exemption to a complementary request anti-tamper/signature gate
   * ("FlatShake") — every CAPTCHA-exempt type {8,32,512} has its post-login
   * business RPCs rejected with "ByRspRetStatusCode N001 Unexpectable request"
   * because OpenDeploy doesn't sign requests. WPF=1 is exempt from FlatShake;
   * the trade-off is CAPTCHA, which we now handle via the captcha flow
   * (`captcha.ts` → `AccountService.GetValidationCodeImageByte`).
   *
   * Recon doc: `.scratch/recon/captcha-login.md`.
   */
  ClientType: number;
}

const K3_CLIENT_VERSION_PRETENDED_BY_OPENDEPLOY = '9.0.553.12';

/**
 * `Kingdee.BOS.Authentication.ClientType.WPF` — the interactive desktop client.
 * Subject to CAPTCHA (handled via the captcha flow) but EXEMPT from the
 * FlatShake request anti-tamper gate that blocks the programmatic types.
 */
const CLIENT_TYPE_WPF = 1;

function pickPrimaryIPv4(): string {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const ni of list) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

function pickPrimaryMac(): string {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const ni of list) {
      if (ni.family === 'IPv4' && !ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        return ni.mac.toUpperCase();
      }
    }
  }
  return '00:00:00:00:00:00';
}

export function buildClientInfo(): BosClientInfo {
  const mac = pickPrimaryMac();
  const ip = pickPrimaryIPv4();
  const host = os.hostname();
  // os.release() gives e.g. "10.0.26200" on Windows 11. K3 client puts a NT-style
  // string. Match shape; exact value isn't validated by the server (we tested).
  const osStr = `Microsoft Windows NT ${os.release()}`;
  return {
    vH: 1024,
    vW: 768,
    MacAddress: mac,
    HostName: host,
    IpAddress: ip,
    Version: K3_CLIENT_VERSION_PRETENDED_BY_OPENDEPLOY,
    ScreenSize: null,
    AvailableAreaSize: null,
    macAddress: mac,
    hostName: host,
    ipAddress: ip,
    OperationSystem: osStr,
    ClientType: CLIENT_TYPE_WPF,
  };
}
