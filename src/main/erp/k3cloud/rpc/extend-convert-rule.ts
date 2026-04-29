/**
 * Convert-rule extension lifecycle. Server diffs `oldIds` vs `__rules__.Id`:
 * id absent from rules ⇒ delete; rule with `paras.OldId=null` ⇒ create.
 * See `save-convert-rules.ts` for the wire format.
 */

import {
  saveConvertRules,
  buildNewExtensionParas,
  type ConvertRuleEnvelope,
  type IsvDescriptor,
  type SaveConvertRulesResult,
} from './save-convert-rules';
import type { KdSession } from './http-client';
import { DEFAULT_LOCALE_SLOTS, type ConvertRuleBaseline } from './convert-rule-baselines';
import { regenerateGuidsInXml } from './regenerate-guids';
import { newCompactGuid } from './dcxml';

export interface ExtendConvertRuleArgs {
  baseline: ConvertRuleBaseline;
  isv: IsvDescriptor;
  /** zh-CN extension name shown in BOS Designer. Defaults to `转换规则`. */
  displayName?: string;
}

export interface ExtendConvertRuleResult extends SaveConvertRulesResult {
  newExtensionId: string;
}

function originEnvelope(baseline: ConvertRuleBaseline): ConvertRuleEnvelope {
  return {
    localeSlots: DEFAULT_LOCALE_SLOTS,
    source: baseline.originXml,
    paras: baseline.originParas,
  };
}

export async function extendConvertRule(
  session: KdSession,
  args: ExtendConvertRuleArgs,
): Promise<ExtendConvertRuleResult> {
  const { baseline, isv, displayName } = args;
  const newExtensionId = newCompactGuid();
  const newExtEnv: ConvertRuleEnvelope = {
    localeSlots: DEFAULT_LOCALE_SLOTS,
    source: regenerateGuidsInXml(baseline.extensionTemplateXml),
    paras: buildNewExtensionParas({ newRuleId: newExtensionId, isv, displayName }),
  };

  const result = await saveConvertRules(session, {
    rules: [originEnvelope(baseline), newExtEnv],
    oldIds: [baseline.originParas.Id],
    isv,
  });
  return { ...result, newExtensionId };
}

export interface DeleteConvertRuleExtensionArgs {
  baseline: ConvertRuleBaseline;
  extId: string;
  isv: IsvDescriptor;
}

export async function deleteConvertRuleExtension(
  session: KdSession,
  args: DeleteConvertRuleExtensionArgs,
): Promise<SaveConvertRulesResult> {
  const { baseline, extId, isv } = args;
  return saveConvertRules(session, {
    rules: [originEnvelope(baseline)],
    oldIds: [baseline.originParas.Id, extId],
    isv,
  });
}
