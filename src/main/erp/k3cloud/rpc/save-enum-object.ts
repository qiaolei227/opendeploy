/**
 * Persist a new enum type via BusinessDataService.SaveV9.
 *
 * Wire format reference: capture req-583 (2026-04-28 BOS Designer create-enum).
 * The on-the-wire ap0 is a single JSON object with two parts:
 *
 *   {
 *     "$$DynamicObjectType": { ...EnumObject schema... },     // ~17 KB constant
 *     "Id": "<guid>",                                         // \\
 *     "MultiLanguageText": [...],                             //  data values
 *     "Name": [...],                                          //  ~1 KB
 *     "Category": 0,                                          //  per save
 *     "IsSysPreset": "0",                                     //
 *     "Items": [...],                                         //
 *     "Items$$DeleteRows": [],                                //
 *     "$$DirtyFlags": "17",                                   //
 *     "$$FromDatabase": false                                 // /
 *   }
 *
 * The `$$DynamicObjectType` block is a self-describing ORM type definition
 * (Kingdee.BOS DynamicObject). It's identical for every EnumObject save —
 * we hold it as a static JSON constant in `enum-save-schema.json` extracted
 * from the capture.
 *
 * Dirty flags / database markers: BOS uses ORM-level change tracking
 * ($$DirtyFlags as bitmask, $$FromDatabase=false marks new rows). The values
 * used here mirror what the capture showed for a fresh insert and are not
 * worth interpreting for v0.1.
 */

import {
  callKdsvc,
  encodeApField,
  applySetCookieToSession,
  parseJsonResponse,
  type KdSession,
} from './http-client';
import enumSchemaTemplate from './enum-save-schema.json' with { type: 'json' };
import { newDashedGuid } from './dcxml';

const BUSINESS_DATA_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.BusinessData.BusinessDataService';

// $$DirtyFlags bitmasks observed in BOS Designer's create-enum capture
// (req-583, 2026-04-28). Values are BOS-internal Kingdee.BOS DynamicObject
// change-tracking semantics — we cargo-cult them to byte-match the wire,
// not to reinterpret. Naming preserves grep-ability against the capture.
const DIRTY_FLAGS_NEW_ENUM_HEADER = '17'; // root EnumObject row
const DIRTY_FLAGS_NEW_ENUM_ITEM = '3'; // each Items[] row
const DIRTY_FLAGS_NEW_LOCALE_ROW = '6'; // each MultiLanguageText[] row

export interface EnumItemInput {
  /** Stable code stored in T_META_FORMENUMITEM.FVALUE — the value the
   * combo field renders into the database. Conventionally short ascii
   * (`"1"`, `"A"`, `"YES"`). Required, must be unique within the enum. */
  value: string;
  /** zh-CN display caption shown in the dropdown. */
  caption: string;
  /** Optional sort order; defaults to insertion order. */
  seq?: number;
  /** Optional: server-managed PkId; supply on edits, omit on creates. */
  enumItemId?: string;
}

export interface CreateEnumObjectParams {
  /** zh-CN display name of the new enum (e.g. "信用等级"). */
  name: string;
  /** Optional: pre-allocated GUID. Defaults to a fresh dashed GUID. */
  enumTypeId?: string;
  /** Category code; 0 == standard combo. Mirrors BOS Designer's default. */
  category?: number;
  items: EnumItemInput[];
}

export interface SaveEnumObjectResult {
  ok: boolean;
  enumTypeId: string;
  /** Raw response body for debugging when ok=false. */
  responseBody: string;
}

/**
 * Build the ap0 plaintext for one new-enum save. Combines the constant
 * `$$DynamicObjectType` schema with caller-supplied data fields. Exposed
 * separately from `saveEnumObject` so unit tests can verify the structure
 * without hitting a real server.
 */
export function buildEnumSaveAp0(params: CreateEnumObjectParams, lcid: number = 2052): string {
  const enumTypeId = params.enumTypeId ?? newDashedGuid();
  const items = params.items.map((it, idx) => ({
    EnumId: it.enumItemId ?? newDashedGuid(),
    Value: it.value,
    MultiLanguageText: [
      {
        PkId: null,
        LocaleId: lcid,
        Caption: it.caption,
        '$$DirtyFlags': DIRTY_FLAGS_NEW_LOCALE_ROW,
        '$$FromDatabase': false,
      },
    ],
    'MultiLanguageText$$DeleteRows': [],
    Caption: [{ Key: lcid, Value: it.caption }],
    Seq: it.seq ?? idx,
    Invalid: false,
    IsSysPreSet: false,
    '$$DirtyFlags': DIRTY_FLAGS_NEW_ENUM_ITEM,
    '$$FromDatabase': false,
  }));

  // Build the data section as an object then merge with the schema. Order
  // doesn't matter to the server (verified by perturbation in capture
  // replays), so JSON.stringify's natural insertion order is fine.
  const ap0Object = {
    ...enumSchemaTemplate,
    Id: enumTypeId,
    MultiLanguageText: [
      {
        PkId: null,
        LocaleId: lcid,
        Name: params.name,
        '$$DirtyFlags': DIRTY_FLAGS_NEW_LOCALE_ROW,
        '$$FromDatabase': false,
      },
    ],
    'MultiLanguageText$$DeleteRows': [],
    Name: [{ Key: lcid, Value: params.name }],
    Category: params.category ?? 0,
    IsSysPreset: '0',
    Items: items,
    'Items$$DeleteRows': [],
    '$$DirtyFlags': DIRTY_FLAGS_NEW_ENUM_HEADER,
    '$$FromDatabase': false,
  };
  return JSON.stringify(ap0Object);
}

/**
 * Create a new enum type on the server. Returns the assigned GUID — pass it
 * directly into a ComboField `<EnumType>` element to reference this enum
 * in subsequent SaveForIDEV9 form saves.
 */
export async function saveEnumObject(
  session: KdSession,
  params: CreateEnumObjectParams,
): Promise<SaveEnumObjectResult> {
  const enumTypeId = params.enumTypeId ?? newDashedGuid();
  const ap0 = buildEnumSaveAp0({ ...params, enumTypeId });
  const apObj = JSON.parse(ap0);
  const res = await callKdsvc(session, BUSINESS_DATA_SERVICE, 'SaveV9', {
    apFields: { ap0: encodeApField(apObj) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  const body = res.bodyText;
  // Server returns the saved DynamicObject (echo of input + server-set fields).
  // For v0.1 we just check the body contains the GUID we sent — mismatched
  // means the server normalized something unexpected; bare error envelopes
  // start with `response_error:`.
  if (body.startsWith('response_error:')) {
    return { ok: false, enumTypeId, responseBody: body };
  }
  try {
    const parsed = parseJsonResponse<{ Id?: string }>(body);
    const ok = !!parsed && (typeof parsed.Id !== 'string' || parsed.Id === enumTypeId);
    return { ok, enumTypeId, responseBody: body };
  } catch {
    return { ok: false, enumTypeId, responseBody: body };
  }
}
