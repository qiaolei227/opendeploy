/**
 * BOS Login flow orchestration (skeleton — RSA password encryption TODO).
 *
 * Captured login sequence (REQ #9-#11 in 2026-04-27 session):
 *
 *   #9  GetAuthPublicKey
 *       ap0  = AcctID (plain string, e.g. "69a531ee82525a")
 *       resp = base64-encoded X.509 SubjectPublicKeyInfo (3072-bit RSA)
 *
 *   #10 GetPublicKeyInfo
 *       ap0  = AcctID
 *       resp = empty (probably a cache prime — investigate if not strictly needed)
 *
 *   #11 ValidateLoginInfo  ← the actual login
 *       ap1  = LoginInfo JSON {
 *         AcctID, Username, Password, Lcid, AuthenticateType, EncyptType,
 *         LoginType, PasswordIsEncrypted, ClientInfo, UserToken, ...
 *       }
 *       (note: ap0 is empty; the LoginInfo argument occupies ap1 because
 *        the C# method signature reserves ap0 for the user/AcctID position)
 *       resp = LoginResult { LoginResultType, Context: {SessionId, ...},
 *                            KDSVCSessionId, AccessToken, ... }
 *       Set-Cookie: ASP.NET_SessionId=...; kdservice-sessionid=...
 *
 * UNRESOLVED: The Password field in ap1 contained 6 CJK chars
 * ("丠伊丠伊丠伊丠伊丠伊丠伊") rather than ~512 chars of base64 RSA
 * ciphertext. Meanwhile UserToken was a ~1380-char base64 blob. We need
 * to confirm whether:
 *   (a) UserToken contains the encrypted password and Password is just a
 *       placeholder/marker for "encrypted", OR
 *   (b) Password uses some non-standard encoding (e.g. "fake CJK" form
 *       of base64 to obfuscate from log scrubbers), OR
 *   (c) Some other LoginCryptography routine in the client.
 *
 * Path forward: capture a fresh login with a known plaintext password
 * (e.g. "test1234") and reverse the mapping; OR decompile
 * Kingdee.BOS.WinForm.Login.dll to find the plaintext → wire transform.
 */

import { KdSession, callKdsvc, encodeApField, encodeApFieldRaw, parseJsonResponse, applySetCookieToSession } from './http-client';
import { decodeAppLayerString } from './codec';
import { buildClientInfo } from './clientinfo';

export interface LoginCredentials {
  baseUrl: string;
  acctId: string;
  username: string;
  password: string;
  lcid?: number;
}

export interface LoginResult {
  session: KdSession;
  userId: number;
  userName: string;
  customName: string;
  /** True for happy path; false means look at the message for reason. */
  isSuccess: boolean;
  message?: string;
}

const ACCOUNT_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService';
const USER_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.User.UserService';

export async function getAuthPublicKey(baseUrl: string, acctId: string): Promise<string> {
  const session: KdSession = { baseUrl };
  const res = await callKdsvc(session, USER_SERVICE, 'GetAuthPublicKey', {
    apFields: { ap0: encodeApFieldRaw(acctId) },
  });
  // Response is base64-encoded X.509 SubjectPublicKeyInfo, optionally
  // wrapped in JSON quoting depending on the deserializer behavior.
  return res.bodyText.replace(/^"|"$/g, '');
}

/**
 * RSA-encrypt password using the X.509 public key returned by GetAuthPublicKey.
 *
 * TODO(login): determine PKCS#1 v1.5 vs OAEP padding — capture sample with
 * known plaintext to reverse. For now this throws.
 */
export function encryptPassword(_publicKeyBase64: string, _password: string): string {
  throw new Error(
    'rpc/login.encryptPassword: NOT IMPLEMENTED — see TODO in module docstring; ' +
      'requires reversing BOS Designer LoginCryptography (likely RSA + base64), ' +
      'cross-checked against a fresh capture with a known plaintext password.',
  );
}

/**
 * Full Login orchestration.
 *
 * SKELETON: signature is final, body is incomplete. Wire it up after
 * resolving the password encryption transform.
 */
export async function login(creds: LoginCredentials): Promise<LoginResult> {
  const session: KdSession = { baseUrl: creds.baseUrl };

  const publicKey = await getAuthPublicKey(creds.baseUrl, creds.acctId);
  const encryptedPassword = encryptPassword(publicKey, creds.password);

  const loginInfo = {
    AcctID: creds.acctId,
    Username: creds.username,
    Password: encryptedPassword,
    Lcid: creds.lcid ?? 2052,
    AuthenticateType: 8,
    EncyptType: 0,
    LoginType: 0,
    PasswordIsEncrypted: true,
    ClientInfo: buildClientInfo(),
    // UserToken: TODO — observed format unclear, see module docstring.
  };

  const res = await callKdsvc(session, USER_SERVICE, 'ValidateLoginInfo', {
    apFields: { ap0: '', ap1: encodeApField(loginInfo) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);

  const parsed = parseJsonResponse<{
    LoginResultType: number;
    Message?: string | null;
    Context?: { SessionId?: string; UserId?: number; UserName?: string; CustomName?: string; AccessToken?: string };
    KDSVCSessionId?: string;
  }>(res.bodyText);

  if (parsed.Context?.SessionId) session.aspNetSessionId = parsed.Context.SessionId;
  if (parsed.KDSVCSessionId) session.kdServiceSessionId = parsed.KDSVCSessionId;
  if (parsed.Context?.AccessToken) session.accessToken = parsed.Context.AccessToken;

  return {
    session,
    userId: parsed.Context?.UserId ?? 0,
    userName: parsed.Context?.UserName ?? '',
    customName: parsed.Context?.CustomName ?? '',
    isSuccess: parsed.LoginResultType === 1,
    message: parsed.Message ?? undefined,
  };
}

// Suppress unused-import warning until login is fully wired.
void decodeAppLayerString;
