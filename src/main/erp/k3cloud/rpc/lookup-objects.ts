/**
 * Resolve a basedata friendly FormId (e.g. "BD_Customer", "BD_UNIT") to the
 * T_META_LOOKUPCLASS GUID that BOS expects in `<LookUpObjectID>` of any
 * BaseDataField / UnitField written via SaveForIDEV9.
 *
 * Without this translation, BOS accepts the save (it doesn't validate at
 * save time) but the runtime form fails to render the field's lookup with
 * "未正确配置指向的基础资料" — silently broken at write, loud at runtime.
 *
 * Decompile reference (Kingdee.BOS.ServiceFacade.KDServiceClient.dll):
 *   class MetadataServiceV9Proxy
 *     ServiceName = "Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService"
 *     public List<LookUpObject> GetLookupObjects(LookUpObjectFilter oFilter)
 *
 *   LookUpObjectFilter: { IsAssistData: bool, Filter: string, BaseDataType: int }
 *     BaseDataType: 1=Group, 400=Base, 401=Assistant, 402=ItemClass,
 *                   403=FlexValue, 500=Bill, 800=Flex
 *
 *   LookUpObject (excerpt): Id, FormId, Name, TableName, PkFieldName,
 *                           NumberFieldName, NameFieldName, SubSysId, ...
 *
 * Smoke verified 2026-04-28 (scripts/bos-recon/smoke-lookupobjects.ts):
 *   BaseDataType=400 returns 1864 entries; covers BD_Customer / BD_MATERIAL /
 *   BD_Department / BD_UNIT / BD_UNITGROUP / etc. Empty Filter returns the
 *   full set (Filter="something" can return a server error envelope).
 */

import {
  callKdsvc,
  encodeApField,
  applySetCookieToSession,
  parseJsonResponse,
  type KdSession,
} from './http-client';

const METADATA_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

/** Lookup-class kinds the server accepts. 0 = treated as "all" in observed responses. */
export type LookUpBaseDataType = 0 | 1 | 400 | 401 | 402 | 403 | 500 | 800;

export interface GetLookupObjectsOptions {
  isAssistData?: boolean;
  /** Server-side filter string. Empty/missing returns the full set. */
  filter?: string;
  /** Default 400 (basic basedata). Use 0 to fetch every lookup-class kind. */
  baseDataType?: LookUpBaseDataType;
}

export interface LookupObject {
  /** T_META_LOOKUPCLASS.FID — the GUID `<LookUpObjectID>` expects. */
  id: string;
  /** Friendly FormId, e.g. "BD_Customer", "BD_MATERIAL", "BD_UNIT". */
  formId: string;
  name: string;
  tableName: string;
  pkFieldName: string;
  numberFieldName: string;
  nameFieldName: string;
  subSysId?: string;
  subSysName?: string;
}

interface RawLookupObject {
  Id: string;
  FormId: string;
  Name: string;
  TableName: string;
  PkFieldName: string;
  NumberFieldName: string;
  NameFieldName: string;
  SubSysId?: string;
  SubSysName?: string;
}

/**
 * Fetch lookup-class registrations from the K/3 Cloud server.
 *
 * Cost: one HTTP call returning ~1 MB JSON (1864 entries on a fresh demo
 * account). Callers should cache — see `K3CloudConnector.listLookupObjects`.
 */
export async function getLookupObjects(
  session: KdSession,
  opts: GetLookupObjectsOptions = {},
): Promise<LookupObject[]> {
  const filter = {
    IsAssistData: opts.isAssistData ?? false,
    Filter: opts.filter ?? '',
    BaseDataType: opts.baseDataType ?? 400,
  };
  const res = await callKdsvc(session, METADATA_SERVICE, 'GetLookupObjects', {
    apFields: { ap0: encodeApField(filter) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return [];
  const raw = parseJsonResponse<RawLookupObject[]>(res.bodyText);
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    id: r.Id,
    formId: r.FormId,
    name: r.Name,
    tableName: r.TableName,
    pkFieldName: r.PkFieldName,
    numberFieldName: r.NumberFieldName,
    nameFieldName: r.NameFieldName,
    subSysId: r.SubSysId,
    subSysName: r.SubSysName,
  }));
}

/**
 * Build a case-insensitive index of FormId → LookupObject. Useful because
 * BOS's FormId casing is inconsistent (`BD_Customer` mixed-case but
 * `BD_MATERIAL` upper-case), and agents/users won't always match exactly.
 */
export function indexByFormId(list: LookupObject[]): Map<string, LookupObject> {
  const map = new Map<string, LookupObject>();
  for (const lo of list) {
    if (lo.formId) map.set(lo.formId.toLowerCase(), lo);
  }
  return map;
}
