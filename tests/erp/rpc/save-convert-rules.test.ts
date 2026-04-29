import { describe, expect, it, afterEach } from 'vitest';
import { encodeAppLayer, decodeAppLayerString } from '../../../src/main/erp/k3cloud/rpc/codec';
import {
  saveConvertRules,
  buildNewExtensionParas,
  envelopeToJsonString,
  type ConvertRuleEnvelope,
  type IsvDescriptor,
} from '../../../src/main/erp/k3cloud/rpc/save-convert-rules';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';

const realFetch = globalThis.fetch;

const session: KdSession = {
  baseUrl: 'http://localhost/k3cloud',
  aspNetSessionId: 'asp1',
  kdServiceSessionId: 'kd1',
};

const KINGDEE_ISV: IsvDescriptor = {
  Id: null,
  Name: 'Kingdee',
  ISVSignal: 'Kingdee',
  PackageSignal: '',
  DevCode: null,
};
const UNW_ISV: IsvDescriptor = {
  Id: 'IBHC-LMFG-QIMZ-LHQA-VFBK',
  Name: 'UNW',
  ISVSignal: 'Kingdee',
  PackageSignal: '',
  DevCode: 'UNW',
};

const ORIGIN_ENV: ConvertRuleEnvelope = {
  localeSlots: { '2052': '' },
  source: '<?xml version="1.0" encoding="utf-16"?><ConvertRuleMetaData><Rule><ConvertRule ElementType="6000"/></Rule></ConvertRuleMetaData>',
  paras: {
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
    ISV: KINGDEE_ISV,
    UpdateIdToKey: false,
    SourceFormId: null,
    InheritPath: ',SaleOrder-OutStock,',
    IsInheritElement: false,
    ModelTypeSubId: 0,
    Name: JSON.stringify([{ Key: 2052, Value: '销售订单至销售出库单' }]),
  },
};

describe('envelopeToJsonString', () => {
  it('serializes envelope with locale slots + __source__ + __paras__ (paras nested as string)', () => {
    const str = envelopeToJsonString(ORIGIN_ENV);
    const parsed = JSON.parse(str);
    expect(parsed['2052']).toBe('');
    expect(parsed['__source__']).toContain('<ConvertRuleMetaData>');
    // paras must be a JSON string (matches BOS Designer wire format), not nested object
    expect(typeof parsed['__paras__']).toBe('string');
    const paras = JSON.parse(parsed['__paras__']);
    expect(paras.Id).toBe('SaleOrder-OutStock');
    expect(paras.ModelTypeId).toBe(790);
    expect(paras.ISV.Name).toBe('Kingdee');
  });
});

describe('buildNewExtensionParas', () => {
  it('builds paras for a brand-new extension rule', () => {
    const p = buildNewExtensionParas({
      newRuleId: 'abc12345-1234-5678-90ab-cdef01234567',
      isv: UNW_ISV,
      displayName: '我的扩展',
    });
    expect(p.Id).toBe('abc12345-1234-5678-90ab-cdef01234567');
    expect(p.OldId).toBeNull();
    expect(p.ModelTypeId).toBe(790);
    expect(p.HasExtends).toBe(false);
    expect(p.IsInheritElement).toBe(false);
    expect(p.ISV).toEqual(UNW_ISV);
    expect(p.Version).toBeNull();
    expect(p.MainVersion).toBeNull();
    expect(p.PackageId).toBeNull();
    expect(p.InheritPath).toBeNull();
    expect(p.FirstNonExtendObjectID).toBeNull();
    // displayName goes into the multilingual Name field (zh-CN slot 2052)
    const names = JSON.parse(p.Name);
    expect(names).toEqual([
      { Key: 1033, Value: '' },
      { Key: 2052, Value: '我的扩展' },
      { Key: 3076, Value: '' },
    ]);
  });

  it('defaults displayName to "转换规则" (matches BOS Designer behavior)', () => {
    const p = buildNewExtensionParas({
      newRuleId: 'x',
      isv: UNW_ISV,
    });
    const names = JSON.parse(p.Name);
    expect(names.find((n: { Key: number; Value: string }) => n.Key === 2052)?.Value).toBe('转换规则');
  });
});

describe('saveConvertRules', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('hits ConvertService.SaveRulesV9 endpoint', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(encodeAppLayer(''));
    }) as typeof fetch;

    await saveConvertRules(session, {
      rules: [ORIGIN_ENV],
      oldIds: ['SaleOrder-OutStock'],
      isv: UNW_ISV,
    });

    expect(capturedUrl).toBe(
      'http://localhost/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService.SaveRulesV9.common.kdsvc',
    );
  });

  it('wraps payload as ap0 = {__rules__, __oldIds__, __isv__} with each value JSON-stringified', async () => {
    let capturedAp0 = '';
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      capturedAp0 = params.get('ap0') ?? '';
      return new Response(encodeAppLayer(''));
    }) as typeof fetch;

    await saveConvertRules(session, {
      rules: [ORIGIN_ENV],
      oldIds: ['SaleOrder-OutStock', 'fe6154fe-7144-4633-97e9-601f65135ae9'],
      isv: UNW_ISV,
    });

    const decoded = decodeAppLayerString(capturedAp0);
    const outer = JSON.parse(decoded);
    // each field at the top level must be a JSON string (matches BOS Designer wire format)
    expect(typeof outer.__rules__).toBe('object');  // array of strings
    expect(Array.isArray(outer.__rules__)).toBe(true);
    expect(outer.__rules__).toHaveLength(1);
    expect(typeof outer.__rules__[0]).toBe('string');
    expect(typeof outer.__oldIds__).toBe('string');
    expect(typeof outer.__isv__).toBe('string');

    const oldIds = JSON.parse(outer.__oldIds__);
    expect(oldIds).toEqual([
      'SaleOrder-OutStock',
      'fe6154fe-7144-4633-97e9-601f65135ae9',
    ]);
    const isv = JSON.parse(outer.__isv__);
    expect(isv.Name).toBe('UNW');
    expect(isv.Id).toBe('IBHC-LMFG-QIMZ-LHQA-VFBK');
  });

  it('serializes multiple rules in the wire format', async () => {
    let capturedAp0 = '';
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      capturedAp0 = params.get('ap0') ?? '';
      return new Response(encodeAppLayer(''));
    }) as typeof fetch;

    const newExt: ConvertRuleEnvelope = {
      localeSlots: { '2052': '' },
      source: '<?xml version="1.0" encoding="utf-16"?><ConvertRuleMetaData><Rule><ConvertRule ElementType="6000"/></Rule></ConvertRuleMetaData>',
      paras: buildNewExtensionParas({
        newRuleId: 'new-ext-guid',
        isv: UNW_ISV,
        displayName: '新扩展',
      }),
    };

    await saveConvertRules(session, {
      rules: [ORIGIN_ENV, newExt],
      oldIds: ['SaleOrder-OutStock'],
      isv: UNW_ISV,
    });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0));
    expect(outer.__rules__).toHaveLength(2);
    const rule0 = JSON.parse(outer.__rules__[0]);
    const rule1 = JSON.parse(outer.__rules__[1]);
    expect(JSON.parse(rule0.__paras__).Id).toBe('SaleOrder-OutStock');
    expect(JSON.parse(rule1.__paras__).Id).toBe('new-ext-guid');
    expect(JSON.parse(rule1.__paras__).OldId).toBeNull();
  });

  it('returns ok: true when server responds successfully (non-error envelope)', async () => {
    globalThis.fetch = (async () => new Response(encodeAppLayer(''))) as typeof fetch;
    const result = await saveConvertRules(session, {
      rules: [ORIGIN_ENV],
      oldIds: ['SaleOrder-OutStock'],
      isv: KINGDEE_ISV,
    });
    expect(result.ok).toBe(true);
  });
});
