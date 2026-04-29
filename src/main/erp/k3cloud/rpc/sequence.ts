/**
 * BusinessDataService.GetSequenceInt32 — server-side int allocator.
 *
 * BOS Designer calls this when allocating internal table identifiers (e.g.
 * `t_BOS_CustEntry` for new EntryEntities). The server keeps a per-category
 * monotonically increasing counter and returns the next free int.
 *
 * Wire format (capture #1315 / 2026-04-29):
 *   - ap0 = category string (e.g. "t_BOS_CustEntry"), app-layer encoded
 *   - ap1 = increment (literal "1" string), app-layer encoded
 *   - response = JSON array `[<int>]` (single-element)
 *
 * The category is a hard-coded BOS internal token — `t_BOS_CustEntry` for
 * client-built entries. We expose `category` as a parameter so callers can
 * specify it explicitly (no implicit defaults), but in practice v0.1 only
 * uses `t_BOS_CustEntry`.
 */

import {
  callKdsvc,
  encodeApFieldRaw,
  applySetCookieToSession,
  parseJsonResponse,
  type KdSession,
} from './http-client';

const BUSINESS_DATA_SERVICE =
  'Kingdee.BOS.ServiceFacade.ServicesStub.BusinessData.BusinessDataService';

/** Category for client-built EntryEntity tables (`<DevCode>_t_Cust_Entry<int>`). */
export const SEQUENCE_CATEGORY_CUST_ENTRY = 't_BOS_CustEntry';

/**
 * Allocate the next int from the server's sequence for `category`.
 * Returns the allocated int (the server reserves it on call — no rollback).
 *
 * Throws when the server returns no body or an empty array — both indicate
 * a contract violation (sequence allocator should always succeed once auth'd).
 */
export async function getNextSequenceInt32(
  session: KdSession,
  category: string,
  increment: number,
): Promise<number> {
  const res = await callKdsvc(session, BUSINESS_DATA_SERVICE, 'GetSequenceInt32', {
    apFields: {
      ap0: encodeApFieldRaw(category),
      ap1: encodeApFieldRaw(String(increment)),
    },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) {
    throw new Error(`GetSequenceInt32(${category}): empty response from server`);
  }
  const arr = parseJsonResponse<number[]>(res.bodyText);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(
      `GetSequenceInt32(${category}): expected non-empty number array, got ${res.bodyText}`,
    );
  }
  return arr[0];
}
