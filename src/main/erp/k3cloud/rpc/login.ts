/**
 * BOS Login flow — local-account direct login (frmLogin path).
 *
 * Mirrors the C# `UserServiceProxy.ValidateUser(string ServerUrl, LoginInfo info)`
 * (Kingdee.BOS.ServiceFacade.KDServiceClient.dll line 7449) which:
 *   1. Calls `GetPublicKeyInfo(acctID)` over RPC — returns an obfuscated
 *      public key, or empty when password encryption is disabled server-side.
 *   2. If non-empty: deobfuscates the key and RSA-PKCS#1-v1.5 encrypts the
 *      plaintext password.
 *      If empty: falls back to single-arg `CipherText` obfuscation (NOT
 *      real encryption — matches `ConfidentialDataSecurityUtil.CipherText(string)`,
 *      Kingdee.BOS.dll line 68547).
 *   3. Submits `ValidateLoginInfo` with the cooked password.
 *
 * NOT implemented: frmCloudLogin path (KingdeeCloud-mediated, requires
 * `cp.GetKingdeeTokenByUserEx` against cloud.kingdee.com — we don't want
 * to depend on Kingdee Cloud for OpenDeploy). Local-account login covers
 * the consultant-friendly use case: BOS account `demo` / `admin` / etc.
 *
 * Captured reference: `.scratch/captures/decoded/req-11/request-ap1.dec.txt`
 * is a frmCloudLogin sample — same RPC endpoint, slightly different field
 * population (UserToken populated, Password="******" obfuscated, AuthType=8).
 */

import { KdSession, callKdsvc, encodeApField, encodeApFieldRaw, parseJsonResponse, applySetCookieToSession } from './http-client';
import { buildClientInfo } from './clientinfo';
import { cipherPasswordForLogin } from './password';

const USER_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.User.UserService';

export interface LoginCredentials {
  /** K/3 Cloud Web Server URL, e.g. "http://localhost/k3cloud". No trailing slash. */
  baseUrl: string;
  /** Data center / account ID, e.g. "69a531ee82525a". From LoginSetting.xml `<DataCenterID>`. */
  acctId: string;
  /** Local account name (NOT cloud phone number), e.g. "demo" / "Administrator". */
  username: string;
  /** Plaintext password — encrypted on the wire by GetPublicKeyInfo flow. */
  password: string;
  /** Locale for messages. Default 2052 (zh-CN). */
  lcid?: number;
}

export interface LoginResult {
  session: KdSession;
  isSuccess: boolean;
  /** Set when Login succeeds. */
  userId?: number;
  /** Internal name (e.g. "demo"). */
  userName?: string;
  /** Display name (Chinese). */
  customName?: string;
  /** Server-issued token, useful for re-login / cross-service calls. */
  accessToken?: string;
  /** When isSuccess=false. */
  message?: string;
  messageCode?: string;
}

/**
 * Step 1: pull the (obfuscated) public key for password encryption.
 * Returns empty string when server has password encryption disabled — caller
 * must fall back to obfuscation (cipherPasswordForLogin handles this).
 */
export async function fetchPublicKeyInfo(session: KdSession, acctId: string): Promise<string> {
  const res = await callKdsvc(session, USER_SERVICE, 'GetPublicKeyInfo', {
    apFields: { ap0: encodeApFieldRaw(acctId) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  // Response is a JSON-quoted string (or empty). Strip outer quotes if present.
  const text = res.bodyText.trim();
  if (!text) return '';
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text;
}

/**
 * Full Login orchestration for local-account auth.
 *
 * Returns {session, isSuccess: true, ...} on success — pass `session` into
 * subsequent RPC calls (e.g. saveExtension). Cookie state is mutated on
 * `session` in-place.
 */
export async function login(creds: LoginCredentials): Promise<LoginResult> {
  const session: KdSession = { baseUrl: creds.baseUrl };
  const obfuscatedKey = await fetchPublicKeyInfo(session, creds.acctId);
  const cookedPassword = cipherPasswordForLogin(creds.password, obfuscatedKey);

  const loginInfo = {
    AcctID: creds.acctId,
    Username: creds.username,
    Password: cookedPassword,
    AuthSign: null,
    Lcid: creds.lcid ?? 2052,
    /**
     * AuthenticationType enum (Kingdee.BOS.dll line 915):
     *   0 = DomainAuthentication               (Windows domain / AD — DON'T USE for local accounts)
     *   1 = PwdAuthentication                   ← OpenDeploy default: local account + password
     *   2 = DynamicPwdAuthentication
     *   3 = CAAuthentication
     *   8 = IDECloudEntryAuthentication        (cloud entry, requires UserToken)
     *   ...
     * Empirical (smoke test 2026-04-27): AuthType=0 with `15197395239` got
     *   "应用服务器不能访问域"15197395239"，请联系管理员！" (msgCode 002005030013399)
     *   — server tried to do AD/LDAP lookup. Switching to 1 (PwdAuthentication).
     */
    AuthenticateType: 1,
    ValidationCode: null,
    EncyptType: 0,
    LoginType: 0,
    /**
     * True when Password field carries server-cooked content (obfuscated or
     * RSA). False would mean raw plaintext — server may reject. We always
     * pass cooked-form so this stays true.
     */
    PasswordIsEncrypted: true,
    IpAddress: null,
    ComputerName: null,
    RawSignData: null,
    SignedData: null,
    OpenToken: null,
    ClientInfo: buildClientInfo(),
    EntryRole: null,
    LoginMethod: 0,
    SessionId: null,
    UserToken: null,
    AppId: null,
    AppSecret: null,
    Timestamp: 0,
    RequstIP: null,
    IgnoreVer: false,
    IsShowLoggedInMessage: false,
    IsSameUserToken: false,
    KickoutFlag: 0,
    CustomizationParameter: null,
    OrgNumber: null,
    OriginalClientIP: null,
    SMSCode: null,
    LoginIden: null,
    LoginAgain: null,
  };

  // ValidateLoginInfo signature is `(string ServerUrl, LoginInfo info)` so
  // the LoginInfo argument occupies ap1 (ap0 is the ServerUrl, empty here).
  const res = await callKdsvc(session, USER_SERVICE, 'ValidateLoginInfo', {
    apFields: { ap0: '', ap1: encodeApField(loginInfo) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);

  if (!res.bodyText) {
    return { session, isSuccess: false, message: 'empty response from ValidateLoginInfo' };
  }

  const parsed = parseJsonResponse<{
    LoginResultType: number;
    Message?: string | null;
    MessageCode?: string | null;
    Context?: {
      SessionId?: string;
      UserId?: number;
      UserName?: string;
      CustomName?: string;
      AccessToken?: string;
    };
    KDSVCSessionId?: string;
    AccessToken?: string;
  }>(res.bodyText);

  // Server sets cookies on the response too; primary source is Set-Cookie
  // headers (already applied above). The LoginResult body fields below are
  // a backup for environments where cookie handling is finicky.
  if (parsed.Context?.SessionId && !session.aspNetSessionId) {
    session.aspNetSessionId = parsed.Context.SessionId;
  }
  if (parsed.KDSVCSessionId && !session.kdServiceSessionId) {
    session.kdServiceSessionId = parsed.KDSVCSessionId;
  }
  const accessToken = parsed.AccessToken ?? parsed.Context?.AccessToken;
  if (accessToken) session.accessToken = accessToken;

  return {
    session,
    isSuccess: parsed.LoginResultType === 1,
    userId: parsed.Context?.UserId,
    userName: parsed.Context?.UserName,
    customName: parsed.Context?.CustomName,
    accessToken,
    message: parsed.Message ?? undefined,
    messageCode: parsed.MessageCode ?? undefined,
  };
}
