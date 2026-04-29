/**
 * Compress a raw `GetConvertRule` response (~240 KB JSON for SaleOrder-OutStock)
 * into an LLM-friendly summary (~3 KB). The full payload would consume ~60K
 * tokens; the summary preserves the parts a consultant actually asks about
 * (formula maps, group-by strategy, plugins, bill-type maps, attachment
 * settings) and drops the noise (Auto-mapped FieldMaps, BOS internal Ids).
 *
 * Pure function — no IO, no session. Called by `K3CloudConnector.describeConvertRule`.
 */

import type {
  LocaleString,
  RawConvertRule,
  RawConvertRuleElement,
  RawFieldMap,
  RawPolicy,
  RawInheritPathEntry,
} from './rpc/convert-rules';
import { LCID_ZH_CN } from './rpc/convert-rules';

/** zh-CN preferred, fall back to first non-empty entry, then empty string. */
function pickName(name: LocaleString[] | undefined, lcid: number = LCID_ZH_CN): string {
  if (!name || name.length === 0) return '';
  return name.find((n) => n.Key === lcid)?.Value ?? name[0]?.Value ?? '';
}

/**
 * `ValueConvertMode` int → readable string. Source: decompiled
 * `Kingdee.BOS.Core.Metadata.ConvertElement.ValueConvertMode` enum.
 */
export const VALUE_CONVERT_MODE_NAMES: Record<number, string> = {
  0: 'Auto',
  1: 'Sum',
  2: 'Average',
  3: 'Count',
  4: 'Max',
  5: 'Min',
  6: 'Formula',
  7: 'Join',
  8: 'SumFormula',
};

/** `GroupByMode` int → readable string. */
export const GROUP_BY_MODE_NAMES: Record<number, string> = {
  0: 'None',
  1: 'OneToOne',
  2: 'GroupByField',
  3: 'GroupByFormula',
};

function valueConvertModeName(mode: number): string {
  return VALUE_CONVERT_MODE_NAMES[mode] ?? `Unknown(${mode})`;
}

function groupByModeName(mode: number): string {
  return GROUP_BY_MODE_NAMES[mode] ?? `Unknown(${mode})`;
}

/** Match a Policy by its class-name suffix (e.g. `DefaultConvertPolicyElement`). */
function findPolicy(policies: RawPolicy[], classNameSuffix: string): RawPolicy | undefined {
  return policies.find((p) => {
    const t = (p.___InstClassType__ as string | undefined) ?? '';
    return t.includes(classNameSuffix);
  });
}

export interface FormulaMapEntry {
  target: string;
  mode: string;
  formula: string | null;
  formulaDesc: string | null;
}

export interface AggregateMapEntry {
  target: string;
  source: string | null;
  mode: string;
}

export interface DefaultConvertSummary {
  sourceEntry: string;
  targetEntry: string;
  fieldMapCount: number;
  formulaMaps: FormulaMapEntry[];
  aggregateMaps: AggregateMapEntry[];
}

export interface GroupBySummary {
  mode: string;
  fields: string[];
  formula: string | null;
}

export interface FilterSummary {
  alertMessage: string | null;
  customFilter: string | null;
}

export interface BillTypeMapEntry {
  source: string;
  target: string;
}

export interface LinkEntitySummary {
  controlEntity: string;
  fieldMapCount: number;
}

export interface AttachmentSummary {
  header: boolean;
  entry: boolean;
  subEntry: boolean;
  deduplication: boolean;
}

export interface TailDiffSummary {
  enabled: boolean;
  markField: string | null;
  recordField: string | null;
}

export interface FormBusinessEntry {
  /** Pre-condition (IronPython expression that gates the service). */
  precondition: string | null;
  /** zh-CN description of the precondition (UI label). */
  preconditionDesc: string | null;
  /** Plugin/service class name when bound to one. */
  className: string | null;
  /** Numeric type code (BOS-internal — exact semantics vary). */
  type: number;
}

/**
 * Extension overlay metadata extracted from the rule wrapper. Surfaces what
 * the agent (and consultant) needs to know about whether a runtime view
 * carries customer extensions baked in.
 */
export interface ExtensionInfo {
  /** True when the rule has at least one customer / ISV extension overlay. */
  hasExtends: boolean;
  /**
   * Inheritance lineage as a list of `{id, displayName}` tuples — element [0]
   * is always the origin Kingdee rule, [1+] are extension overlays applied
   * in order. Empty array means no inheritance info.
   */
  lineage: Array<{ id: string; displayName: string }>;
  /** First non-extension ancestor (= the original Kingdee rule id). */
  originId: string | null;
  /** ISV (开发商) of THIS view — `"Kingdee"` = original-vendor; else extension. */
  isv: { name: string; signal: string; devCode: string | null } | null;
  /**
   * True when this view is an inherited overlay (extension), vs the runtime-
   * merged view of an origin rule. Tells agent which "shape" the data has.
   */
  isInheritView: boolean;
}

export interface ConvertRuleSummary {
  ruleId: string;
  displayName: string;
  sourceFormId: string;
  targetFormId: string;
  isDefault: boolean;
  isActive: boolean;
  invisible: boolean;
  convertType: number;
  pushRunCondition: string | null;
  /**
   * Extension overlay metadata. When `hasExtends: true` the rule has been
   * customized by an ISV — the runtime view shown in the rest of this
   * summary already includes the extension's effect (status flips, custom
   * field maps, etc.). Use the `lineage` to identify which extension(s).
   */
  extension: ExtensionInfo;
  defaultConvert: DefaultConvertSummary | null;
  groupBy: GroupBySummary | null;
  filter: FilterSummary | null;
  plugins: string[];
  billTypeMaps: BillTypeMapEntry[];
  linkEntity: LinkEntitySummary | null;
  attachment: AttachmentSummary | null;
  tailDiff: TailDiffSummary | null;
  orderByField: string | null;
  /** 表单服务策略 — services fired post-conversion (gated by IronPython pre-conditions). */
  formBusinessServices: FormBusinessEntry[];
}

function summarizeDefaultConvert(p: RawPolicy | undefined): DefaultConvertSummary | null {
  if (!p) return null;
  const fieldMaps = ((p.FieldMaps as RawFieldMap[]) ?? []) as RawFieldMap[];
  const formulaMaps: FormulaMapEntry[] = [];
  const aggregateMaps: AggregateMapEntry[] = [];

  for (const m of fieldMaps) {
    const mode = m.ValueConvertMode;
    if (mode === 6) {
      formulaMaps.push({
        target: m.TargetFieldKey,
        mode: 'Formula',
        formula: m.Formula ?? null,
        formulaDesc: m.FormulaDesc ?? null,
      });
    } else if (mode >= 1 && mode <= 5) {
      // Sum / Average / Count / Max / Min — aggregate without formula
      aggregateMaps.push({
        target: m.TargetFieldKey,
        source: m.SourceFieldKey,
        mode: valueConvertModeName(mode),
      });
    } else if (mode === 7 || mode === 8) {
      // Join / SumFormula — also aggregate-flavored
      aggregateMaps.push({
        target: m.TargetFieldKey,
        source: m.SourceFieldKey,
        mode: valueConvertModeName(mode),
      });
    }
    // mode === 0 (Auto) is the noise we drop
  }

  return {
    sourceEntry: (p.SourceEntryKey as string) ?? '',
    targetEntry: (p.TargetEntryKey as string) ?? '',
    fieldMapCount: fieldMaps.length,
    formulaMaps,
    aggregateMaps,
  };
}

function summarizeGroupBy(p: RawPolicy | undefined): GroupBySummary | null {
  if (!p) return null;
  const fields = String(p.GroupByField ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    mode: groupByModeName(Number(p.GroupByMode ?? 0)),
    fields,
    formula: (p.GroupByFormula as string) || null,
  };
}

function summarizeFilter(p: RawPolicy | undefined): FilterSummary | null {
  if (!p) return null;
  const alertRaw = p.AlertMessage as LocaleString[] | string | undefined;
  let alertMessage: string | null = null;
  if (typeof alertRaw === 'string') {
    alertMessage = alertRaw || null;
  } else if (Array.isArray(alertRaw)) {
    alertMessage = pickName(alertRaw) || null;
  }
  return {
    alertMessage,
    customFilter: (p.CustFilter as string) || null,
  };
}

function summarizePlugins(p: RawPolicy | undefined): string[] {
  if (!p) return [];
  const plugs = (p.Plugs as Array<{ ClassName?: string }> | undefined) ?? [];
  return plugs.map((x) => x.ClassName ?? '').filter(Boolean);
}

function summarizeBillTypeMaps(p: RawPolicy | undefined): BillTypeMapEntry[] {
  if (!p) return [];
  const maps = (p.BillTypeMaps as Array<{ SourceBillTypeId?: string; TargetBillTypeId?: string }> | undefined) ?? [];
  return maps
    .map((m) => ({ source: m.SourceBillTypeId ?? '', target: m.TargetBillTypeId ?? '' }))
    .filter((m) => m.source || m.target);
}

function summarizeLinkEntity(p: RawPolicy | undefined): LinkEntitySummary | null {
  if (!p) return null;
  const fieldMaps = (p.FieldMaps as RawFieldMap[] | undefined) ?? [];
  return {
    controlEntity: (p.ControlEntityKey as string) ?? '',
    fieldMapCount: fieldMaps.length,
  };
}

function summarizeAttachment(p: RawPolicy | undefined): AttachmentSummary | null {
  if (!p) return null;
  return {
    header: Boolean(p.EnabledHeader),
    entry: Boolean(p.EnabledEntry),
    subEntry: Boolean(p.EnabledSubEntry),
    deduplication: Boolean(p.Deduplication),
  };
}

function summarizeTailDiff(p: RawPolicy | undefined): TailDiffSummary | null {
  if (!p) return null;
  return {
    enabled: Boolean(p.IsEnabled),
    markField: (p.MarkFieldKey as string) || null,
    recordField: (p.RecordFieldKey as string) || null,
  };
}

function summarizeOrderBy(p: RawPolicy | undefined): string | null {
  if (!p) return null;
  return (p.OrderByField as string) || null;
}

/**
 * 表单服务策略 — list of business services that fire on the target form
 * after conversion completes. Each entry is gated by an optional IronPython
 * `PreCondition` expression. Real rules (SaleOrder-OutStock) carry 50+
 * entries with most ClassName=null (indirect framework dispatch); we list
 * all of them so agent can answer "下推后会触发哪些联动".
 */
function summarizeFormBusinessServices(p: RawPolicy | undefined): FormBusinessEntry[] {
  if (!p) return [];
  const services =
    (p.FormBusinessList as Array<Record<string, unknown>> | undefined) ?? [];
  return services.map((s) => {
    const descRaw = s.PreConditionDesc as LocaleString[] | undefined;
    return {
      precondition: (s.PreCondition as string) || null,
      preconditionDesc: descRaw && descRaw.length > 0 ? pickName(descRaw) : null,
      className: (s.ClassName as string) || null,
      type: Number(s.Type ?? 0),
    };
  });
}

/**
 * Pull extension overlay metadata off the rule wrapper. The interesting
 * signals are:
 *   - `HasExtends` flags whether ANY extension overlay exists for this rule
 *   - `InheritPathDescription` walks the lineage from origin to active overlay
 *   - `ISV.Name` reveals the developer of the **currently-loaded view**
 *     ("Kingdee" = original-vendor view; anything else = extension)
 *   - `IsInheritElement` flags whether THIS object is an overlay (true)
 *     or the merged runtime view of an origin rule (false)
 *
 * Without these, agent has no way to tell the consultant "your rule was
 * customized by ISV X" — the summary would look like a plain Kingdee rule.
 */
function summarizeExtension(raw: RawConvertRule): ExtensionInfo {
  const lineageRaw = (raw.InheritPathDescription as RawInheritPathEntry[] | undefined) ?? [];
  const lineage = lineageRaw.map((e) => ({
    id: e.Item1,
    displayName: pickName(e.Item2),
  }));
  const isvRaw = raw.ISV;
  return {
    hasExtends: Boolean(raw.HasExtends),
    lineage,
    originId: (raw.FirstNonExtendObjectID as string | undefined) || null,
    isv: isvRaw
      ? { name: isvRaw.Name || '', signal: isvRaw.ISVSignal || '', devCode: isvRaw.DevCode ?? null }
      : null,
    isInheritView: Boolean(raw.IsInheritElement),
  };
}

/**
 * Compress a `GetConvertRule` response into an LLM-friendly summary.
 *
 * Auto-mapped FieldMaps (`ValueConvertMode === 0`) are dropped — only the
 * count is preserved. Formula and aggregate maps are listed in full because
 * those are what consultants need to explain to customers ("FBaseUnitQty
 * 用了什么逻辑算").
 */
export function summarizeConvertRule(raw: RawConvertRule): ConvertRuleSummary {
  const rule: RawConvertRuleElement = raw.Rule;
  const policies = rule.Policies ?? [];

  return {
    ruleId: raw.Id,
    displayName: pickName(raw.Name),
    sourceFormId: rule.SourceFormId,
    targetFormId: rule.TargetFormId,
    isDefault: Boolean(rule.IsDefault),
    isActive: Boolean(rule.Status),
    invisible: Boolean(rule.Invisible),
    convertType: Number(rule.ConvertType ?? 0),
    pushRunCondition: rule.PushRunCondition ?? null,

    extension: summarizeExtension(raw),

    defaultConvert: summarizeDefaultConvert(findPolicy(policies, 'DefaultConvertPolicyElement')),
    groupBy: summarizeGroupBy(findPolicy(policies, 'ConvertGroupByPolicyElement')),
    filter: summarizeFilter(findPolicy(policies, 'ConvertFilterPolicyElement')),
    plugins: summarizePlugins(findPolicy(policies, 'ConvertPlugInPolicyElement')),
    billTypeMaps: summarizeBillTypeMaps(findPolicy(policies, 'BillTypeMapPolicyElement')),
    linkEntity: summarizeLinkEntity(findPolicy(policies, 'LinkEntityPolicyElement')),
    attachment: summarizeAttachment(findPolicy(policies, 'ConvertAttachmentPolicyElement')),
    tailDiff: summarizeTailDiff(findPolicy(policies, 'ConvertTailDiffPolicyElement')),
    orderByField: summarizeOrderBy(findPolicy(policies, 'ConvertOrderByPolicyElement')),
    formBusinessServices: summarizeFormBusinessServices(
      findPolicy(policies, 'ConvertFormBusinessPolicyElement'),
    ),
  };
}

/** Light list-item shape (output of `listConvertRules`). */
export interface ConvertRulePathSummary {
  sourceFormId: string;
  targetFormId: string;
  sourceFormName: string;
  targetFormName: string;
}

/** Pick the zh-CN display label out of each path entry. */
export function summarizeConvertPath(p: {
  SourceFormId: string;
  TargetFormId: string;
  SourceFormName: LocaleString[];
  TargetFormName: LocaleString[];
}): ConvertRulePathSummary {
  return {
    sourceFormId: p.SourceFormId,
    targetFormId: p.TargetFormId,
    sourceFormName: pickName(p.SourceFormName),
    targetFormName: pickName(p.TargetFormName),
  };
}
