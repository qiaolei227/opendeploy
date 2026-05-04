/**
 * Read-side metadata RPC — replaces SQL `T_META_*` reads with HTTP calls
 * to the K/3 Cloud Web Server. Two endpoints cover what the agent needs:
 *
 *  - `getBusinessObjectMetaData(objectId)` — returns the full metadata XML
 *    for one BillModel / extension. Wraps the row of `T_META_OBJECTTYPE`
 *    plus the FKERNELXML blob in a `<MetaData>` envelope.
 *
 *  - `getExtendObjectTypeId(parentId)` — returns the list of extension FIDs
 *    derived from a parent BillModel.
 *
 * Decompile reference (Kingdee.BOS.ServiceFacade.KDServiceClient.dll):
 *   class SQLScriptServiceV9Proxy
 *     ServiceName = "Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.SQLScriptService"
 *     public Dictionary<string,string> GetBusinessObjectMetaData(
 *         string strBusinessObjectID, params int[] localeIDs)
 *
 *   class MetadataServiceProxy
 *     ServiceName = "Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService"
 *     public List<string> GetExtendObjectTypeId(string specificFormId)
 *
 * Wire format verified 2026-04-28 in scripts/bos-recon/smoke-getbomd.ts:
 *   ap0 = raw object id string ("SAL_SaleOrder" or 32-hex extension FID)
 *   ap1 = JSON-encoded int[] of locale IDs (e.g. [2052])
 *   response = JSON Dictionary<string,string>:
 *       { "metaData": "<MetaData>...</MetaData>",
 *         "metaData2052": "<MetaData businessObjectId=...TableName=T_META_OBJECTTYPE_L>..." }
 *   The `metaData` value is the canonical XML — `<SQLData><Comment>` holds
 *   scalar columns (FID/FBASEOBJECTID/FSUPPLIERNAME/etc), `<XmlData
 *   ColName="FKERNELXML"><Comment>` holds the FKERNELXML payload that the
 *   existing parsers in `queries.ts` already understand.
 *
 * GetExtendObjectTypeId returns a JSON array of FID strings.
 */

import { callKdsvc, encodeApField, encodeApFieldRaw, applySetCookieToSession, parseJsonResponse, type KdSession } from './http-client';

const SQL_SCRIPT_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.SQLScriptService';
const METADATA_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

/** Default locale ID — 2052 = zh-CN. */
export const DEFAULT_LOCALE_ID = 2052;

export interface BusinessObjectMetaData {
  /** Full T_META_OBJECTTYPE row + FKERNELXML, wrapped as `<MetaData TableName="T_META_OBJECTTYPE">`. */
  metaData: string;
  /**
   * Localized rows keyed by lcid — e.g. `metaDataByLocale[2052]` is the
   * `<MetaData TableName="T_META_OBJECTTYPE_L">` payload for zh-CN.
   * Empty when the requested locale has no rows.
   */
  metaDataByLocale: Record<number, string>;
}

/**
 * Fetch the complete metadata for one BillModel / extension.
 *
 * Throws on transport failure or when the server returns its
 * `response_error:` plain-text envelope. An object id that doesn't exist
 * yields `metaData: ""` (server returns empty Dictionary, not 404).
 *
 * Cost: one HTTP round-trip; payload sizes range from ~30 KB (small
 * BaseDataModel) to ~2 MB (BillModel like SAL_SaleOrder). Caller should
 * cache by id when looping.
 */
export async function getBusinessObjectMetaData(
  session: KdSession,
  objectId: string,
  localeIds: number[] = [DEFAULT_LOCALE_ID],
): Promise<BusinessObjectMetaData> {
  const res = await callKdsvc(session, SQL_SCRIPT_SERVICE, 'GetBusinessObjectMetaData', {
    apFields: {
      ap0: encodeApFieldRaw(objectId),
      ap1: encodeApField(localeIds),
    },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return { metaData: '', metaDataByLocale: {} };
  const dict = parseJsonResponse<Record<string, string>>(res.bodyText);
  const out: BusinessObjectMetaData = { metaData: dict['metaData'] ?? '', metaDataByLocale: {} };
  for (const [k, v] of Object.entries(dict)) {
    if (k === 'metaData') continue;
    // Keys look like "metaData2052" — strip the prefix to recover the lcid.
    const m = /^metaData(\d+)$/.exec(k);
    if (m) out.metaDataByLocale[Number(m[1])] = v;
  }
  return out;
}

/**
 * Fetch the FIDs of all extensions whose `FBASEOBJECTID` is `parentId`.
 *
 * Cheap call (small response, just an array of GUID strings); used by
 * `k3cloud_list_extensions` to enumerate extensions before pulling each
 * one's metadata via `getBusinessObjectMetaData`.
 */
export async function getExtendObjectTypeId(
  session: KdSession,
  parentId: string,
): Promise<string[]> {
  const res = await callKdsvc(session, METADATA_SERVICE, 'GetExtendObjectTypeId', {
    apFields: { ap0: encodeApFieldRaw(parentId) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return [];
  const arr = parseJsonResponse<string[]>(res.bodyText);
  return Array.isArray(arr) ? arr : [];
}

// ─── Cross-cutting JSON shapes returned by GetSubSystems / GetObjectTypes ───
//
// The server returns rich objects with localized name arrays. We surface the
// minimum the agent tools actually consume; extra keys are ignored.

interface RawLocaleString {
  Key: number;
  Value: string;
  ToolTips?: string;
}

interface RawSubSystem {
  Id: string;
  Number: string;
  Name: RawLocaleString[];
}

interface RawObjectType {
  Id: string;
  Name: RawLocaleString[];
  ModelTypeId: number;
  BaseObjectId: string | null;
  SubSystemId?: string;
  // Lots more — DevType, FuncSubsystemId, etc. — ignored.
}

/** Pull one locale's value (default zh-CN 2052), falling back to the first entry. */
function pickName(name: RawLocaleString[] | undefined, lcid: number = DEFAULT_LOCALE_ID): string {
  if (!name || name.length === 0) return '';
  return name.find((n) => n.Key === lcid)?.Value ?? name[0]?.Value ?? '';
}

/**
 * List the K/3 Cloud sub-systems (SAL / PUR / STK / FIN / etc).
 *
 * Mirrors `GetSubSystems()` in MetadataServiceProxy. Used by the agent's
 * `k3cloud_list_subsystems` tool.
 */
export async function getSubSystems(
  session: KdSession,
  lcid: number = DEFAULT_LOCALE_ID,
): Promise<Array<{ id: string; number: string; name: string }>> {
  const res = await callKdsvc(session, METADATA_SERVICE, 'GetSubSystems', { apFields: {} });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return [];
  const raw = parseJsonResponse<RawSubSystem[]>(res.bodyText);
  return raw.map((s) => ({ id: s.Id, number: s.Number, name: pickName(s.Name, lcid) }));
}

/**
 * Server-side keyword search across object metadata. Maps to BOS Designer's
 * "search" UX in the form-picker dialog. Used by `k3cloud_search_metadata`.
 */
export async function queryObjectType(
  session: KdSession,
  keyword: string,
  lcid: number = DEFAULT_LOCALE_ID,
): Promise<Array<{ id: string; name: string; baseObjectId: string | null; modelTypeId: number }>> {
  const res = await callKdsvc(session, METADATA_SERVICE, 'QueryObjectType', {
    apFields: { ap0: encodeApFieldRaw(keyword) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return [];
  const raw = parseJsonResponse<RawObjectType[]>(res.bodyText);
  return raw.map((o) => ({
    id: o.Id,
    name: pickName(o.Name, lcid),
    baseObjectId: o.BaseObjectId ?? null,
    modelTypeId: o.ModelTypeId,
  }));
}

/**
 * List object types — by sub-system, optionally model-type filtered.
 * Mirrors `GetObjectTypes(subsystemIDs, modelTypes, onlyTempalte)` overload.
 *
 * `subsystemIds` empty/undefined returns all sub-systems' objects. `modelTypeIds`
 * empty/undefined returns all model types.
 */
export async function getObjectTypes(
  session: KdSession,
  options: { subsystemIds?: string[]; modelTypeIds?: number[]; onlyTemplate?: boolean } = {},
  lcid: number = DEFAULT_LOCALE_ID,
): Promise<Array<{ id: string; name: string; baseObjectId: string | null; modelTypeId: number; subSystemId?: string }>> {
  const res = await callKdsvc(session, METADATA_SERVICE, 'GetObjectTypes', {
    apFields: {
      ap0: encodeApField(options.subsystemIds ?? []),
      ap1: encodeApField(options.modelTypeIds ?? []),
      ap2: encodeApField(options.onlyTemplate ?? false),
    },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return [];
  const raw = parseJsonResponse<RawObjectType[]>(res.bodyText);
  return raw.map((o) => ({
    id: o.Id,
    name: pickName(o.Name, lcid),
    baseObjectId: o.BaseObjectId ?? null,
    modelTypeId: o.ModelTypeId,
    subSystemId: o.SubSystemId,
  }));
}
