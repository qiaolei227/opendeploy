/**
 * Pre-login data-center discovery — replicates BOS Designer's flow where
 * the user enters only a server URL and the client fetches the available
 * account-sets (DataCenters) before asking for credentials.
 *
 * Why this matters:
 *   - In production, consultants typically CAN'T reach the customer's SQL
 *     Server directly (firewall, no remote SQL access). They can only reach
 *     the K/3 Cloud Web Server via HTTP(S). BOS Designer works the same way.
 *   - The acctId (e.g. `69a531ee82525a`) is NOT in any user-visible DB table.
 *     A scan of all 11399 tables in `AIS20260302144343` returned 0 hits.
 *     It's only on the K/3 Cloud server (LoginSetting.xml + central config DB).
 *   - This RPC endpoint is the supported way to discover what acctIds a
 *     server hosts. It's unauthenticated — works before the user has
 *     credentials.
 *
 * Wire format reference: capture log 2026-04-27T05-58-02-806Z.log REQ 2:
 *   POST /k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService.GetDataCenterList.common.kdsvc
 *   request body: standard frame ONLY (no ap0/ap1) — clientinfo + nonce + v + compressed flags
 *   response: base64(zlib(JSON List<DataCenter>))
 *
 * Decompiled signature (Kingdee.BOS.ServiceFacade.KDServiceClient.dll):
 *   public List<DataCenter> GetDataCenterList()  // no args
 *
 * DataCenter has many fields; we surface only what the consumer cares about
 * (id / number / name) to keep the IPC payload tight.
 */

import { callKdsvc, parseJsonResponse } from './http-client';
import type { KdSession } from './http-client';

const ACCOUNT_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService';

export interface DataCenter {
  /** The acctId — what gets passed to login as `AcctID`. */
  id: string;
  /** Mnemonic, e.g. "001". */
  number: string;
  /** Localized display name, e.g. "演示账套". */
  name: string;
}

/** Raw shape of one DataCenter object as the server returns it. */
interface RawDataCenter {
  Id: string;
  Number: string;
  Name: string;
  // ...many more fields we don't need; ignored
}

/**
 * Fetch the list of data-centers (account-sets) hosted by the K/3 Cloud
 * server at `baseUrl`. No credentials required — the endpoint is
 * unauthenticated and returns the public catalog.
 *
 * Throws on transport failure or malformed response. Empty array is a
 * legitimate result for a freshly-installed K/3 Cloud server with no
 * data-centers configured yet.
 */
export async function getDataCenterList(baseUrl: string): Promise<DataCenter[]> {
  const session: KdSession = { baseUrl };
  const res = await callKdsvc(session, ACCOUNT_SERVICE, 'GetDataCenterList', {
    apFields: {},
  });
  if (!res.bodyText) return [];
  const raw = parseJsonResponse<RawDataCenter[]>(res.bodyText);
  return raw.map((dc) => ({
    id: dc.Id,
    number: dc.Number,
    name: dc.Name,
  }));
}
