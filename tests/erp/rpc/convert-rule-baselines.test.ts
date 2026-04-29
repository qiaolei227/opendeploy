import { describe, expect, it } from 'vitest';
import {
  buildSaleOrderOutStockBaseline,
  KINGDEE_ISV_DESCRIPTOR,
  UnsupportedConvertRuleError,
  DEFAULT_LOCALE_SLOTS,
} from '../../../src/main/erp/k3cloud/rpc/convert-rule-baselines';

const FAKE_ORIGIN = '<?xml version="1.0"?><ConvertRuleMetaData/>';
const FAKE_EXT = '<?xml version="1.0"?><ConvertRuleMetaData/>';

describe('buildSaleOrderOutStockBaseline', () => {
  it('sets origin paras matching req-163 capture (Id, OldId, ModelTypeId, lineage)', () => {
    const baseline = buildSaleOrderOutStockBaseline({
      originXml: FAKE_ORIGIN,
      extensionTemplateXml: FAKE_EXT,
    });
    expect(baseline.originParas.Id).toBe('SaleOrder-OutStock');
    expect(baseline.originParas.OldId).toBe('SaleOrder-OutStock');
    expect(baseline.originParas.ModelTypeId).toBe(790);
    expect(baseline.originParas.InheritPath).toBe(',SaleOrder-OutStock,');
    expect(baseline.originParas.FirstNonExtendObjectID).toBe('SaleOrder-OutStock');
  });

  it('uses Kingdee ISV (Name=Kingdee, Id=null) for origin paras', () => {
    const baseline = buildSaleOrderOutStockBaseline({
      originXml: FAKE_ORIGIN,
      extensionTemplateXml: FAKE_EXT,
    });
    expect(baseline.originParas.ISV.Name).toBe('Kingdee');
    expect(baseline.originParas.ISV.Id).toBeNull();
    expect(baseline.originParas.ISV.DevCode).toBeNull();
  });

  it('passes through injected XMLs verbatim', () => {
    const baseline = buildSaleOrderOutStockBaseline({
      originXml: '<custom-origin/>',
      extensionTemplateXml: '<custom-ext/>',
    });
    expect(baseline.originXml).toBe('<custom-origin/>');
    expect(baseline.extensionTemplateXml).toBe('<custom-ext/>');
  });

  it('exports the canonical Kingdee ISV descriptor', () => {
    expect(KINGDEE_ISV_DESCRIPTOR.Name).toBe('Kingdee');
    expect(KINGDEE_ISV_DESCRIPTOR.ISVSignal).toBe('Kingdee');
    expect(KINGDEE_ISV_DESCRIPTOR.Id).toBeNull();
  });
});

describe('UnsupportedConvertRuleError', () => {
  it('user-facing message names the rule and proposes BOS Designer fallback', () => {
    const err = new UnsupportedConvertRuleError('extendConvertRule', 'PUR-foo');
    expect(err.message).toContain('PUR-foo');
    expect(err.message).toContain('SaleOrder-OutStock');
    expect(err.message).toContain('BOS Designer');
    expect(err.op).toBe('extendConvertRule');
    expect(err.originRuleId).toBe('PUR-foo');
    expect(err).toBeInstanceOf(UnsupportedConvertRuleError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('DEFAULT_LOCALE_SLOTS', () => {
  it('exposes zh-CN slot and is frozen', () => {
    expect(DEFAULT_LOCALE_SLOTS['2052']).toBe('');
    expect(Object.isFrozen(DEFAULT_LOCALE_SLOTS)).toBe(true);
  });
});
