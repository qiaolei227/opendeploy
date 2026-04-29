/**
 * Captured DCXML baselines for `SaveRulesV9` extension lifecycle.
 *
 * BOS Designer's `DcxmlSerializer` (decompile: `KDServiceClient.cs:4310`)
 * emits diff-style XML against a base reference — we don't have a TS port,
 * so we ship the captured wire-format XML as a static fixture and rotate
 * GUIDs per call. `originParas.HasExtends=false` + `InheritPath=",<id>,"`
 * is the canonical "as-if-no-extensions" shape the wire format expects,
 * which diverges from `GetConvertRule(...)` response — server normalizes.
 */

import type { ConvertRuleParas, IsvDescriptor } from './save-convert-rules';

/** zh-CN locale slot — BOS Designer always emits `"2052": ""` in rule envelopes. */
export const DEFAULT_LOCALE_SLOTS: Readonly<Record<string, string>> = Object.freeze({
  '2052': '',
});

export const KINGDEE_ISV_DESCRIPTOR: IsvDescriptor = {
  Id: null,
  Name: 'Kingdee',
  ISVSignal: 'Kingdee',
  PackageSignal: '',
  DevCode: null,
};

export class UnsupportedConvertRuleError extends Error {
  constructor(
    public readonly op: string,
    public readonly originRuleId: string,
  ) {
    super(
      `规则 ${originRuleId} 暂不支持自动扩展(v0.1 仅支持 SaleOrder-OutStock)。请到 BOS Designer 手工建扩展,然后告诉我扩展 ID,我可以帮你往里加字段映射或改策略。`,
    );
    this.name = 'UnsupportedConvertRuleError';
  }
}

export interface ConvertRuleBaseline {
  /** Sent verbatim in `__rules__[0]`; server requires re-emit on every save. */
  originXml: string;
  /** GUID-rotated per call before sending as `__rules__[1]`. */
  extensionTemplateXml: string;
  originParas: ConvertRuleParas;
}

export function buildSaleOrderOutStockBaseline(args: {
  originXml: string;
  extensionTemplateXml: string;
}): ConvertRuleBaseline {
  return {
    originXml: args.originXml,
    extensionTemplateXml: args.extensionTemplateXml,
    originParas: {
      Id: 'SaleOrder-OutStock',
      OldId: 'SaleOrder-OutStock',
      ModelTypeId: 790,
      BaseObjectId: ' ',
      DevType: 0,
      SubSystemId: null,
      Version: '634703641059182961',
      MainVersion: '639131020995091913',
      PackageId: 'K3Cloud_ERP',
      HasExtends: false,
      RunTime: false,
      LayoutViewId: null,
      OldLayoutViewId: null,
      LayoutViewVersion: null,
      DependencyObjectId: null,
      FirstNonExtendObjectID: 'SaleOrder-OutStock',
      ISV: KINGDEE_ISV_DESCRIPTOR,
      UpdateIdToKey: false,
      SourceFormId: null,
      InheritPath: ',SaleOrder-OutStock,',
      IsInheritElement: false,
      ModelTypeSubId: 0,
      Name: '[{"Key":2052,"Value":"销售订单至销售出库单"}]',
    },
  };
}
