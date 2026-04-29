/**
 * ConvertService — read-side endpoints for K/3 Cloud bill conversion rules.
 *
 * Two POCO endpoints that return DataContract JSON (NOT BinaryFormatter — the
 * sibling `GetRuleDatas` / `GetConvertRuleByRunTime` / `LoadByModelTypeIdV9`
 * methods all return MS-NRBF wrapped in `<KingdeeXMLPack>`, which Node cannot
 * read; see `docs/plans/2026-04-29-plan-5.12.4-convert-rules-readonly.md`):
 *
 *   - `getAllConvertPaths()` — system-wide list of source→target paths,
 *     no auth-scoped filter; client filters by sourceFormId.
 *   - `getConvertRule(ruleId)` — full ConvertRuleMetaData JSON object including
 *     all 10 Policy children. ~240 KB for SaleOrder-OutStock; caller should
 *     pass through a summarizer (Plan 5.12.4 Task 2) before sending to LLM.
 *
 * Wire format empirically verified 2026-04-29 in
 * `scripts/bos-recon/smoke-convert-rule-element.ts` against demo data center.
 *
 * Decompile reference (Kingdee.BOS.ServiceFacade.KDServiceClient.dll):
 *   class ConvertServiceProxy
 *     ServiceName = "Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService"
 *     public List<ConvertRulePath> GetAllPaths()
 *     public ConvertRuleMetaData GetConvertRule(string Id)
 */

import {
  callKdsvc,
  encodeApFieldRaw,
  applySetCookieToSession,
  parseJsonResponse,
  type KdSession,
} from './http-client';

const CONVERT_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService';

/** zh-CN locale id used everywhere by BOS (`FLOCALEID = 2052`). */
export const LCID_ZH_CN = 2052;

/** Multilingual string slot — `[{Key: 2052, Value: "..."}, ...]`. */
export interface LocaleString {
  Key: number;
  Value: string;
  ToolTips?: string;
}

/** One row of `GetAllPaths()` — a directed source→target path declaration. */
export interface ConvertRulePath {
  SourceFormId: string;
  TargetFormId: string;
  SourceFormName: LocaleString[];
  TargetFormName: LocaleString[];
}

/**
 * Single FieldMap entry inside `DefaultConvertPolicyElement.FieldMaps` /
 * `LinkEntityPolicyElement.FieldMaps` / `ConvertTailDiffPolicyElement.FieldMaps`.
 *
 * `ValueConvertMode` is an int enum (0=Auto, 6=Formula, etc.) — the
 * summarizer in Task 2 maps it back to a readable string.
 */
export interface RawFieldMap {
  ___InstClassType__: string;
  TargetFieldKey: string;
  TargetFieldName: string | null;
  SourceFieldKey: string | null;
  SourceFieldName: string | null;
  ValueConvertMode: number;
  Formula: string | null;
  FormulaDesc: string | null;
  IsFilter: boolean;
}

/**
 * Generic Policy shape with discriminator. Concrete Policy types
 * (DefaultConvertPolicyElement / ConvertGroupByPolicyElement / etc.) are
 * narrowed by the summarizer based on the `___InstClassType__` value.
 */
export interface RawPolicy {
  ___InstClassType__: string;
  ConvertPolicyTypeName?: string;
  OrderNo?: number;
  Name?: LocaleString[];
  Id?: string;
  Key?: string;
  /** Untyped passthrough — concrete fields per Policy subtype handled later. */
  [k: string]: unknown;
}

/** `Rule` field — the ConvertRuleElement object. */
export interface RawConvertRuleElement {
  ___InstClassType__: string;
  SourceFormId: string;
  TargetFormId: string;
  Status: boolean;
  IsDefault: boolean;
  Invisible: boolean;
  IsRandom: boolean;
  FreePush: boolean;
  CheckLinkSet: boolean;
  Formula: string | null;
  PushRunCondition: string | null;
  PushRunConditionExt: string | null;
  ConvertType: number;
  Policies: RawPolicy[];
  Name?: LocaleString[];
  Id?: string;
  Key?: string;
}

/**
 * One entry in `InheritPathDescription` — a `(id, localized-name)` tuple
 * walking the extension chain from origin Kingdee rule to the active overlay.
 */
export interface RawInheritPathEntry {
  Item1: string;
  Item2: LocaleString[];
}

/**
 * ISV (开发商) descriptor on the rule wrapper. `Name === "Kingdee"` flags
 * the original-vendor rule; anything else (e.g. `"UNW"`) is a customer
 * extension overlay.
 */
export interface RawIsv {
  Id: string | null;
  Name: string;
  ISVSignal: string;
  PackageSignal: string;
  DevCode: string | null;
}

/** Top-level response from `GetConvertRule(ruleId)` — wraps the rule with metadata. */
export interface RawConvertRule {
  Id: string;
  ModelTypeId: number;
  Name: LocaleString[];
  SourceFormId: string;
  BaseObjectId?: string;
  SubSystemId?: string;
  Version?: string;
  MainVersion?: string;
  Rule: RawConvertRuleElement;
  /** True when the rule has at least one customer / ISV extension overlay. */
  HasExtends?: boolean;
  /** Extension chain inheritance path: `",ruleId1,ruleId2,"` style or empty. */
  InheritPath?: string;
  /**
   * Decoded extension lineage with names. Element [0] is the origin Kingdee
   * rule, subsequent elements are extension overlays in inheritance order.
   */
  InheritPathDescription?: RawInheritPathEntry[];
  /** First non-extension (original-vendor) ancestor in the chain. */
  FirstNonExtendObjectID?: string;
  /** Whether this object itself is an inherited overlay vs the origin. */
  IsInheritElement?: boolean;
  /** Whether this object was authored by Kingdee (vs a customer ISV). */
  IsKingdeeElement?: boolean;
  /** ISV / 开发商 descriptor — `Name: "Kingdee"` is original-vendor, else extension. */
  ISV?: RawIsv;
  /** Untyped overflow — top-level wrapper has 28 keys, summarizer ignores most. */
  [k: string]: unknown;
}

/**
 * List the system-wide source→target conversion paths.
 *
 * The server returns the full table (~173 KB JSON, several hundred entries)
 * with no parameter; pass-through to the caller. Filtering by sourceFormId
 * is the caller's responsibility (cheap client-side `filter`).
 */
export async function getAllConvertPaths(session: KdSession): Promise<ConvertRulePath[]> {
  const res = await callKdsvc(session, CONVERT_SERVICE, 'GetAllPaths', { apFields: {} });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) return [];
  const parsed = parseJsonResponse<ConvertRulePath[]>(res.bodyText);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Fetch one ConvertRule by its business id (e.g. `"SaleOrder-OutStock"`).
 *
 * Returns the full ConvertRuleMetaData wrapper including all 10 Policy
 * children — typically ~240 KB JSON. **Caller must pass through a
 * summarizer before forwarding to an LLM** (raw payload would consume
 * ~60 K tokens).
 *
 * Throws when the response is empty or the `Rule` field is missing.
 * Underlying `callKdsvc` already surfaces `response_error:` envelopes
 * as `BosResponseError`.
 */
export async function getConvertRule(session: KdSession, ruleId: string): Promise<RawConvertRule> {
  const res = await callKdsvc(session, CONVERT_SERVICE, 'GetConvertRule', {
    apFields: { ap0: encodeApFieldRaw(ruleId) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) {
    throw new Error(`GetConvertRule(${ruleId}): empty response from server`);
  }
  const parsed = parseJsonResponse<RawConvertRule>(res.bodyText);
  if (!parsed || typeof parsed !== 'object' || !parsed.Rule) {
    throw new Error(
      `GetConvertRule(${ruleId}): expected object with Rule field, got ${res.bodyText.slice(0, 200)}`,
    );
  }
  return parsed;
}
