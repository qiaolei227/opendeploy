/**
 * Enum-type metadata: list, create, delete.
 *
 * BOS distinguishes two stores:
 *   - Lookup classes (T_META_LOOKUPCLASS) — basedata refs (BD_Customer / BD_UNIT).
 *     Read via MetadataService.GetLookupObjects (see ./lookup-objects.ts).
 *   - Enum types (T_META_FORMENUM + items in T_META_FORMENUMITEM) — combo
 *     drop-down sources. Read via MetadataService.GetEnumObjectList; written
 *     via BusinessDataService.SaveV9 (NOT SaveForIDEV9 — enums are stored as
 *     business data rows, not form metadata).
 *
 * Decompile reference (Kingdee.BOS.ServiceFacade.KDServiceClient.dll):
 *   class MetadataServiceV9Proxy
 *     ServiceName = "Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService"
 *     public List<DynamicObject> GetEnumObjectList()         // list all (no args)
 *     public bool AddEnumObjectToRecycle(string enumTypeId)  // soft-delete
 *     public bool RecoverEnumObject(string enumTypeId)
 *     public bool IsPresetEnumType(string enumid)
 *     public string CheckEnumObjectNameExistsV9WithJson(...)
 *     public void UpdateMetaCacheByEnumTypeId(string enumTypeId)
 *
 *   Save path: BusinessDataService.SaveV9 with a serialized DynamicObject
 *   carrying the EnumObject schema + data. See `save-enum-object.ts` for
 *   the wire format and template.
 *
 * Wire format verified 2026-04-28 in scripts/bos-recon/smoke-enum-objects.ts
 * + capture req-583 (SaveV9) / req-579 (GetEnumObjectList).
 */

import {
  callKdsvc,
  encodeApField,
  encodeApFieldRaw,
  applySetCookieToSession,
  parseJsonResponse,
  type KdSession,
} from './http-client';

const METADATA_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

export interface EnumObjectSummary {
  /** GUID — value that goes into ComboField's `<EnumType>` element. */
  id: string;
  /** zh-CN display name (the friendly identifier the agent / user works with). */
  name: string;
  /** All locale variants observed in the response. */
  nameLocalized: Array<{ key: number; value: string }>;
  /** Server's category code; observed values 0/1. Pass through opaquely. */
  category: number;
  /** "1" for system-preset; "0" or null otherwise. */
  isSysPreset: string | null;
}

interface RawEnumObject {
  Id: string;
  Name: Array<{ Key: number; Value: string }>;
  Category: number;
  IsSysPreset: string | null;
}

/**
 * List every enum type registered on the server. Returns ~3500 entries on a
 * fresh demo account (covers all Kingdee preset enums plus any client-built
 * customs). One HTTP call returning ~700 KB JSON; callers should cache.
 */
export async function getEnumObjectList(
  session: KdSession,
  preferredLcid: number = 2052,
): Promise<EnumObjectSummary[]> {
  const res = await callKdsvc(session, METADATA_SERVICE, 'GetEnumObjectList', {
    apFields: {},
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return [];
  const raw = parseJsonResponse<RawEnumObject[]>(res.bodyText);
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const localized = (e.Name ?? []).map((n) => ({ key: n.Key, value: n.Value }));
    const preferred = localized.find((n) => n.key === preferredLcid)?.value ?? localized[0]?.value ?? '';
    return {
      id: e.Id,
      name: preferred,
      nameLocalized: localized,
      category: e.Category,
      isSysPreset: e.IsSysPreset,
    };
  });
}

/**
 * Build a case-insensitive name → enum index. Useful because users / agents
 * call enums by friendly name (`审核状态`) and BOS only recognizes the GUID.
 *
 * Caveat: ~3500 entries with frequent duplicates — many "状态" / "类型" / "级别"
 * names recur across modules. We index by exact name string; ambiguous lookups
 * return the first match. Callers wanting strict resolution should let the
 * agent see the full list (via kingdee_list_enum_types) and pick by id.
 */
export function indexByEnumName(list: EnumObjectSummary[]): Map<string, EnumObjectSummary> {
  const map = new Map<string, EnumObjectSummary>();
  for (const e of list) {
    if (!e.name) continue;
    const key = e.name.toLowerCase();
    if (!map.has(key)) map.set(key, e);
  }
  return map;
}

/**
 * Soft-delete an enum type. Server moves the row to a recycle-bin equivalent
 * — recoverable via `RecoverEnumObject`. Hard delete isn't exposed.
 *
 * Returns true on success. Throws on transport error or `response_error`
 * envelope (caught by callKdsvc → rethrow).
 */
export async function addEnumObjectToRecycle(
  session: KdSession,
  enumTypeId: string,
): Promise<boolean> {
  const res = await callKdsvc(session, METADATA_SERVICE, 'AddEnumObjectToRecycle', {
    apFields: { ap0: encodeApFieldRaw(enumTypeId) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return false;
  const trimmed = res.bodyText.trim();
  if (trimmed === 'true' || trimmed === 'True') return true;
  try {
    const parsed = parseJsonResponse<unknown>(res.bodyText);
    return parsed === true;
  } catch {
    return false;
  }
}

/**
 * Bust the server's metadata cache for one enum type after a save.
 *
 * BOS Designer issues this after every CreateEnum / EditEnum so subsequent
 * GetEnumObjectList / form metadata reads pick up the new data without
 * waiting for natural cache expiry. Without this, the new enum may not be
 * visible to a freshly-fetched ComboField metadata for a few minutes.
 */
export async function updateMetaCacheByEnumTypeId(
  session: KdSession,
  enumTypeId: string,
  formId?: string,
): Promise<void> {
  // BOS Designer's variant — UpdateMetaCacheByFormIdAndEnumTypeId — accepts
  // the parent form id too. We default to empty since v0.1 doesn't yet
  // attach enums to a specific form at creation time.
  const method = formId ? 'UpdateMetaCacheByFormIdAndEnumTypeId' : 'UpdateMetaCacheByEnumTypeId';
  const apFields: Record<string, string> = formId
    ? { ap0: encodeApFieldRaw(enumTypeId), ap1: encodeApFieldRaw(formId) }
    : { ap0: encodeApFieldRaw(enumTypeId) };
  const res = await callKdsvc(session, METADATA_SERVICE, method, { apFields });
  applySetCookieToSession(session, res.setCookieHeaders);
}

/**
 * Pre-flight name uniqueness check. BOS Designer fires this before save to
 * give a synchronous "name already taken" error in the UI; the actual save
 * also validates server-side. v0.1 callers may skip and let the save fail,
 * but using this gives a friendlier error to surface to the user.
 *
 * Returns the empty string on "name OK to use", or a non-empty Chinese
 * message string on conflict (e.g. "名称已被使用").
 */
export async function checkEnumObjectNameExists(
  session: KdSession,
  newId: string,
  name: string,
  lcid: number = 2052,
): Promise<string> {
  // The decompile signature is `CheckEnumObjectNameExistsV9WithJson(json)` —
  // it expects a JSON-serialized DynamicObject describing the enum being
  // checked. The simplest shape that satisfies the server: an object with
  // Id + the localized name array.
  const probe = {
    Id: newId,
    Name: [{ Key: lcid, Value: name }],
  };
  const res = await callKdsvc(session, METADATA_SERVICE, 'CheckEnumObjectNameExistsV9', {
    apFields: { ap0: encodeApField(probe) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return '';
  // Server returns a JSON string (could be empty `""` or a Chinese message).
  try {
    const parsed = parseJsonResponse<unknown>(res.bodyText);
    if (typeof parsed === 'string') return parsed;
  } catch {
    /* server may return raw JSON; below catches that */
  }
  return res.bodyText.replace(/^"|"$/g, '');
}
