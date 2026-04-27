/**
 * K/3 Cloud BOS RPC client — public API barrel.
 *
 * See `./README.md` for architecture and extension points.
 */

export * from './types';
export { buildDcxmlSource } from './dcxml';
export { encodeAppLayer, decodeAppLayer, decodeAppLayerString } from './codec';
export { buildClientInfo } from './clientinfo';
export {
  callKdsvc,
  buildKdsvcUrl,
  bosTimestamp,
  applySetCookieToSession,
  encodeApField,
  encodeApFieldRaw,
  parseJsonResponse,
} from './http-client';
export type { KdSession, KdsvcCallOptions, KdsvcResponse } from './http-client';
export { login, getAuthPublicKey } from './login';
export type { LoginCredentials, LoginResult } from './login';
export { saveExtension, buildParas, buildAp0Plain } from './save-for-ide';
