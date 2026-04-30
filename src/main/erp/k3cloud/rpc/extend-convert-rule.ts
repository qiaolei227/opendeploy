/**
 * Convert-rule extension lifecycle. Server diffs `oldIds` vs `__rules__.Id`:
 * id absent from rules ⇒ delete; rule with `paras.OldId=null` ⇒ create.
 * See `save-convert-rules.ts` for the wire format.
 */

import {
  saveConvertRules,
  buildNewExtensionParas,
  type ConvertRuleEnvelope,
  type ConvertRuleParas,
  type IsvDescriptor,
  type SaveConvertRulesResult,
} from './save-convert-rules';
import type { KdSession } from './http-client';
import { DEFAULT_LOCALE_SLOTS, type ConvertRuleBaseline } from './convert-rule-baselines';
import { getConvertRule } from './convert-rules';
import { newCompactGuid } from './dcxml';

export interface ExtendConvertRuleArgs {
  baseline: ConvertRuleBaseline;
  isv: IsvDescriptor;
  /** zh-CN extension name shown in BOS Designer. Defaults to `转换规则`. */
  displayName?: string;
}

export interface ExtendConvertRuleResult extends SaveConvertRulesResult {
  newExtensionId: string;
  /** The DCXML we sent as the extension's `__source__` in SaveRulesV9. */
  extensionXml: string;
}

/**
 * Server-side modify check requires `paras.Version` / `MainVersion` to match
 * the rule's current state — stale values cause the server to silently
 * create an independent duplicate rule instead of recognizing the modify.
 * `MainVersion` ticks up on every save, so the values frozen into our
 * baseline are wrong as soon as anyone saves the standard rule on the
 * customer's server. Re-read the live values right before each save.
 */
async function liveOriginParas(
  session: KdSession,
  baseline: ConvertRuleBaseline,
): Promise<ConvertRuleParas> {
  const live = await getConvertRule(session, baseline.originParas.Id);
  return {
    ...baseline.originParas,
    Version: live.Version ?? baseline.originParas.Version,
    MainVersion: live.MainVersion ?? baseline.originParas.MainVersion,
  };
}

/**
 * Minimal "origin envelope" — declares the rule's Id+Key and resets Status,
 * but doesn't carry the full rule body. Sending the cached 100KB origin XML
 * triggers a server-side modify of the standard rule using whatever fields
 * differ from the live state, which has been observed to silently flip
 * `<IsDefault>` / `<Status>` based on stale baseline content (e.g. the
 * standard rule getting marked "(stopped)" after our save). The minimal
 * shape lets the server treat the entry as "no-op presence" — enough to
 * anchor the new extension's lineage via `oldIds`, without rewriting the
 * standard rule's body.
 */
function buildMinimalOriginXml(originRuleId: string): string {
  return (
    '<?xml version="1.0" encoding="utf-16"?>' +
    '<ConvertRuleMetaData><Rule><ConvertRule ElementType="6000" ElementStyle="0">' +
    '<Status action="reset" />' +
    `<Id>${originRuleId}</Id>` +
    `<Key>${originRuleId}</Key>` +
    '</ConvertRule></Rule></ConvertRuleMetaData>'
  );
}

function originEnvelope(
  baseline: ConvertRuleBaseline,
  paras: ConvertRuleParas,
): ConvertRuleEnvelope {
  return {
    localeSlots: DEFAULT_LOCALE_SLOTS,
    source: buildMinimalOriginXml(baseline.originParas.Id),
    paras,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal extension source XML — the BOS Designer pattern (capture #0081).
 * Server inherits all Policies / FieldMaps from the parent rule (paras
 * `BaseObjectId`); the extension only declares its own Id/Key plus a
 * `<Status action="reset"/>` marker telling the server to take Status from
 * the parent. Sending a full deep copy of the parent XML (our previous
 * approach) makes the server treat the rule as standalone, and BOS
 * Designer renders it at the top level instead of under the parent.
 *
 * `<Name>` is included in the extension body so BOS Designer's tree shows
 * the developer's chosen label (otherwise it falls back to the parent's
 * name and every OpenDeploy-built extension renders as
 * "销售订单至销售出库单" — indistinguishable in a long list).
 */
function buildMinimalExtensionXml(newExtensionId: string, displayName: string): string {
  return (
    '<?xml version="1.0" encoding="utf-16"?>' +
    '<ConvertRuleMetaData><Rule><ConvertRule ElementType="6000" ElementStyle="0">' +
    '<Status action="reset" />' +
    `<Name>${escapeXml(displayName)}</Name>` +
    `<Id>${newExtensionId}</Id>` +
    `<Key>${newExtensionId}</Key>` +
    '</ConvertRule></Rule></ConvertRuleMetaData>'
  );
}

export async function extendConvertRule(
  session: KdSession,
  args: ExtendConvertRuleArgs,
): Promise<ExtendConvertRuleResult> {
  const { baseline, isv, displayName } = args;
  const originParas = await liveOriginParas(session, baseline);
  const newExtensionId = newCompactGuid();
  const effectiveName = displayName ?? '转换规则';
  const newExtEnv: ConvertRuleEnvelope = {
    localeSlots: DEFAULT_LOCALE_SLOTS,
    source: buildMinimalExtensionXml(newExtensionId, effectiveName),
    paras: buildNewExtensionParas({
      newRuleId: newExtensionId,
      baseObjectId: baseline.originParas.Id,
      isv,
      displayName: effectiveName,
    }),
  };

  const result = await saveConvertRules(session, {
    rules: [originEnvelope(baseline, originParas), newExtEnv],
    oldIds: [baseline.originParas.Id],
    isv,
  });
  return { ...result, newExtensionId, extensionXml: newExtEnv.source };
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
  const originParas = await liveOriginParas(session, baseline);
  return saveConvertRules(session, {
    rules: [originEnvelope(baseline, originParas)],
    oldIds: [baseline.originParas.Id, extId],
    isv,
  });
}
