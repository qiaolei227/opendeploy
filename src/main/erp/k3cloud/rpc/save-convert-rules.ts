/**
 * ConvertService.SaveRulesV9 — single endpoint for create / modify / delete
 * of bill-conversion rules. The wire format is unified DCXML-on-JSON:
 *
 *   ap0 = {
 *     "__rules__": [<ruleStr1>, <ruleStr2>, ...],   // each is JSON-stringified
 *     "__oldIds__": "[<id1>, <id2>, ...]",          // JSON string of string array
 *     "__isv__": "{...}"                            // JSON string of IsvDescriptor
 *   }
 *
 *   each ruleStr = {
 *     "<lcid>": "",                                 // multilingual slots, e.g. "2052": ""
 *     "__source__": "<?xml ...?><ConvertRuleMetaData>...DCXML...</ConvertRuleMetaData>",
 *     "__paras__": "<JSON-string of ConvertRuleParas>"
 *   }
 *
 * Operation semantics encoded by `__rules__` ∩ `__oldIds__` (set membership):
 *   - **create**:  oldIds = [origin],            rules = [origin, newExt with paras.OldId=null]
 *   - **modify**:  oldIds = [origin, ext],       rules = [origin, ext with paras.OldId=ext.Id]
 *   - **delete**:  oldIds = [origin, deletedExt], rules = [origin]
 *
 * Server applies the diff: ids in oldIds but not in rules → delete; rules
 * with paras.OldId=null → create; OldId=non-null → modify.
 *
 * Wire format empirically verified 2026-04-29 (captures #0081, #0153, #0163);
 * decode dumps in `.scratch/captures/decoded/req-{81,153,163}/`.
 */

import {
  callKdsvc,
  encodeApField,
  applySetCookieToSession,
  type KdSession,
} from './http-client';
import type { LocaleString } from './convert-rules';

const CONVERT_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService';

/** ConvertRule's ModelTypeId — fixed `790`, baked into BOS server constants. */
export const CONVERT_RULE_MODEL_TYPE_ID = 790;

/**
 * BOS-internal ISV / 开发商 descriptor. The `Id` field is a 5×4 alphanumeric
 * activation-key style string (e.g. `IBHC-LMFG-QIMZ-LHQA-VFBK`) issued at
 * BOS Designer install time and reachable via `DataCenterService.GetCurrentISV`.
 */
export interface IsvDescriptor {
  Id: string | null;
  Name: string;
  ISVSignal: string;
  PackageSignal: string;
  DevCode: string | null;
}

/**
 * The `__paras__` field on each rule envelope — a flat JSON record of every
 * piece of rule metadata BOS uses for save-time validation and lineage
 * tracking. Mirrors the field set seen in the live capture exactly.
 */
export interface ConvertRuleParas {
  /** Rule id; for new extensions a freshly-generated GUID, else the existing id. */
  Id: string;
  /** Existing rule id when modifying / deleting; `null` when creating new. */
  OldId: string | null;
  /** Always `790` — ConvertRule's ModelTypeId. */
  ModelTypeId: number;
  BaseObjectId: string;
  DevType: number;
  SubSystemId: string | null;
  /** Server-assigned version stamp; `null` for new rules. */
  Version: string | null;
  MainVersion: string | null;
  PackageId: string | null;
  /** True when this rule has at least one extension overlay. */
  HasExtends: boolean;
  RunTime: boolean;
  LayoutViewId: string | null;
  OldLayoutViewId: string | null;
  LayoutViewVersion: string | null;
  DependencyObjectId: string | null;
  /** First non-extension ancestor; `null` for new rules until server fills it. */
  FirstNonExtendObjectID: string | null;
  ISV: IsvDescriptor;
  UpdateIdToKey: boolean;
  SourceFormId: string | null;
  /** Comma-wrapped lineage path, e.g. `,SaleOrder-OutStock,`; `null` for new. */
  InheritPath: string | null;
  /** Wire-format flag; new rules always send `false` (server infers overlay status). */
  IsInheritElement: boolean;
  ModelTypeSubId: number;
  /** JSON-stringified `LocaleString[]` of multilingual rule names. */
  Name: string;
}

/**
 * One element of `__rules__`. Surfaces the three distinct wire-format pieces:
 *   - `localeSlots` carries placeholder `"2052": ""` (and optionally `"1033"`,
 *     `"3076"`) entries that BOS Designer always emits but never populates.
 *   - `source` is the canonical DCXML string (already serialized).
 *   - `paras` is the metadata record; serializer JSON-strings it before wrapping.
 */
export interface ConvertRuleEnvelope {
  localeSlots: Record<string, string>;
  source: string;
  paras: ConvertRuleParas;
}

export interface SaveConvertRulesPayload {
  /**
   * All rules participating in this save call. To delete a rule, **omit it
   * from this array** (and include its id in `oldIds`); BOS computes
   * `oldIds \ rules.Id` as the deletion set.
   */
  rules: ConvertRuleEnvelope[];
  /** All rule ids that previously existed (origin + any current extensions). */
  oldIds: string[];
  /** Top-level ISV — the developer initiating this save (matches Designer's "current ISV"). */
  isv: IsvDescriptor;
}

export interface SaveConvertRulesResult {
  ok: boolean;
  /** Raw response body, useful when the server returns structured error info. */
  raw: string;
}

/**
 * Serialize one envelope into the JSON-string form BOS expects inside `__rules__`.
 * Locale slots come first (matches Designer-emitted wire format ordering),
 * followed by `__source__` and `__paras__`. `paras` is JSON.stringify'd so the
 * outer wrapper can keep it as a single string field (server expects this).
 */
export function envelopeToJsonString(env: ConvertRuleEnvelope): string {
  return JSON.stringify({
    ...env.localeSlots,
    __source__: env.source,
    __paras__: JSON.stringify(env.paras),
  });
}

/**
 * Construct paras for a brand-new extension rule. Caller supplies:
 *   - `newRuleId`: GUID generated client-side (e.g. via `randomUUID`)
 *   - `isv`: usually the ISV returned by `DataCenterService.GetCurrentISV`
 *   - `displayName`: optional zh-CN name; defaults to `转换规则` to match
 *     BOS Designer's behavior when the user creates without naming
 *
 * Fields left `null` (`Version`, `MainVersion`, `PackageId`, `InheritPath`,
 * `FirstNonExtendObjectID`) are server-filled.
 */
export function buildNewExtensionParas(args: {
  newRuleId: string;
  /**
   * Parent rule id (e.g. "SaleOrder-OutStock"). Server uses this to
   * register the new rule as an extension of that parent — without it,
   * the server creates a sibling rule and BOS Designer renders it
   * as a top-level "(stopped) rule" instead of a child of the standard
   * rule. Verified against capture #0081 (real BOS Designer extend op).
   */
  baseObjectId: string;
  isv: IsvDescriptor;
  displayName?: string;
}): ConvertRuleParas {
  const name = args.displayName ?? '转换规则';
  const localeNames: LocaleString[] = [
    { Key: 1033, Value: '' },
    { Key: 2052, Value: name },
    { Key: 3076, Value: '' },
  ];
  return {
    Id: args.newRuleId,
    OldId: null,
    ModelTypeId: CONVERT_RULE_MODEL_TYPE_ID,
    BaseObjectId: args.baseObjectId,
    DevType: 0,
    SubSystemId: null,
    Version: null,
    MainVersion: null,
    PackageId: null,
    HasExtends: false,
    RunTime: false,
    LayoutViewId: null,
    OldLayoutViewId: null,
    LayoutViewVersion: null,
    DependencyObjectId: null,
    FirstNonExtendObjectID: null,
    ISV: args.isv,
    UpdateIdToKey: false,
    SourceFormId: null,
    InheritPath: null,
    IsInheritElement: false,
    ModelTypeSubId: 0,
    Name: JSON.stringify(localeNames),
  };
}

/**
 * Build paras for modifying an existing extension rule. `OldId = extId`
 * (non-null) tells the server this is a modify rather than a create.
 *
 * `baseObjectId` MUST be the parent rule's id (e.g. 'SaleOrder-OutStock').
 * Empty string here makes the server orphan the extension — it persists
 * with FBASEOBJECTID = '' and BOS Designer renders it as an independent
 * top-level convert rule rather than a child of the parent. UAT
 * 2026-05-01 实证 (rule 0c537acc5b88...) confirmed this.
 *
 * `DevType: 2`, `InheritPath / Version / MainVersion / SourceFormId` all
 * null — matches BOS Designer's own modify wire (capture #1354 paras).
 * The server fills in version/path from its own state; passing stale local
 * values risks optimistic-concurrency mismatches.
 */
export function buildModifyExtensionParas(args: {
  extId: string;
  baseObjectId: string;
  isv: IsvDescriptor;
  displayName?: string;
}): ConvertRuleParas {
  const name = args.displayName ?? '转换规则';
  const localeNames: LocaleString[] = [
    { Key: 1033, Value: '' },
    { Key: 2052, Value: name },
    { Key: 3076, Value: '' },
  ];
  return {
    Id: args.extId,
    OldId: args.extId,
    ModelTypeId: CONVERT_RULE_MODEL_TYPE_ID,
    BaseObjectId: args.baseObjectId,
    DevType: 2,
    SubSystemId: null,
    Version: null,
    MainVersion: null,
    PackageId: null,
    HasExtends: false,
    RunTime: false,
    LayoutViewId: null,
    OldLayoutViewId: null,
    LayoutViewVersion: null,
    DependencyObjectId: null,
    FirstNonExtendObjectID: null,
    ISV: args.isv,
    UpdateIdToKey: false,
    SourceFormId: null,
    InheritPath: null,
    IsInheritElement: false,
    ModelTypeSubId: 0,
    Name: JSON.stringify(localeNames),
  };
}

/**
 * Save (create / modify / delete) one or more conversion rules in a single
 * server call. Throws when transport fails or BOS returns its plain-text
 * `response_error:` envelope (already surfaced by `callKdsvc` since Plan 5.13).
 */
export async function saveConvertRules(
  session: KdSession,
  payload: SaveConvertRulesPayload,
): Promise<SaveConvertRulesResult> {
  // Build the outer ap0 object. Each field's value is JSON-stringified — the
  // server expects strings, not nested objects/arrays directly. The `__rules__`
  // value is itself an array (of strings), not stringified.
  const ap0Payload = {
    __rules__: payload.rules.map(envelopeToJsonString),
    __oldIds__: JSON.stringify(payload.oldIds),
    __isv__: JSON.stringify(payload.isv),
  };

  // TEMP DEBUG — dump ap0 to disk for wire-format diff vs real BOS Designer captures
  if (process.env.OD_DUMP_SAVE_RULES) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = '.scratch/saveconvertrules-dumps';
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    fs.writeFileSync(path.join(dir, `${stamp}-ap0.json`), JSON.stringify(ap0Payload, null, 2), 'utf-8');
    console.log(`[debug] saveConvertRules ap0 dumped → ${dir}/${stamp}-ap0.json`);
  }

  const res = await callKdsvc(session, CONVERT_SERVICE, 'SaveRulesV9', {
    apFields: { ap0: encodeApField(ap0Payload) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);

  // BOS returns an empty body on success for SaveRulesV9 (matches capture #0081).
  // Any non-empty body that survived `callKdsvc` here is unexpected — surface
  // it to the caller for inspection but treat empty/whitespace as success.
  return {
    ok: res.bodyText.trim() === '' || res.bodyText.trim().toLowerCase() === 'true',
    raw: res.bodyText,
  };
}
