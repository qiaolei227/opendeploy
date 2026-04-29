import { describe, expect, it, afterEach } from 'vitest';
import { encodeAppLayer, decodeAppLayerString } from '../../../src/main/erp/k3cloud/rpc/codec';
import {
  extendConvertRule,
  deleteConvertRuleExtension,
} from '../../../src/main/erp/k3cloud/rpc/extend-convert-rule';
import {
  buildSaleOrderOutStockBaseline,
  type ConvertRuleBaseline,
} from '../../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';
import type { IsvDescriptor } from '../../../src/main/erp/k3cloud/rpc/save-convert-rules';

const realFetch = globalThis.fetch;

const session: KdSession = {
  baseUrl: 'http://localhost/k3cloud',
  aspNetSessionId: 'asp1',
  kdServiceSessionId: 'kd1',
};

const UNW_ISV: IsvDescriptor = {
  Id: 'IBHC-LMFG-QIMZ-LHQA-VFBK',
  Name: 'UNW',
  ISVSignal: 'Kingdee',
  PackageSignal: '',
  DevCode: 'UNW',
};

const ORIGIN_XML =
  '<?xml version="1.0" encoding="utf-16"?><ConvertRuleMetaData><Rule>' +
  '<ConvertRule ElementType="6000"><Id>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</Id></ConvertRule>' +
  '</Rule></ConvertRuleMetaData>';
const EXT_TEMPLATE_XML =
  '<?xml version="1.0" encoding="utf-16"?><ConvertRuleMetaData><Rule>' +
  '<ConvertRule ElementType="6000"><Policies>' +
  '<LinkEntityPolicy ElementType="7008"><Id>11111111-2222-3333-4444-555555555555</Id></LinkEntityPolicy>' +
  '<DefaultConvertPolicy ElementType="7002"><FieldMaps>' +
  '<FieldMap ElementType="60002"><Id>aabbccddeeff00112233445566778899</Id></FieldMap>' +
  '</FieldMaps></DefaultConvertPolicy>' +
  '</Policies></ConvertRule></Rule></ConvertRuleMetaData>';

const SAMPLE_BASELINE: ConvertRuleBaseline = buildSaleOrderOutStockBaseline({
  originXml: ORIGIN_XML,
  extensionTemplateXml: EXT_TEMPLATE_XML,
});

function captureSavePayload(): {
  capturedAp0: { value: string };
  fetchSpy: typeof fetch;
} {
  const capturedAp0 = { value: '' };
  const fetchSpy = (async (_url: string, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body ?? ''));
    capturedAp0.value = params.get('ap0') ?? '';
    return new Response(encodeAppLayer(''));
  }) as typeof fetch;
  return { capturedAp0, fetchSpy };
}

describe('extendConvertRule', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends rules=[origin, newExt] with oldIds=[origin.Id]', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    const result = await extendConvertRule(session, {
      baseline: SAMPLE_BASELINE,
      isv: UNW_ISV,
    });

    expect(result.ok).toBe(true);
    expect(result.newExtensionId).toMatch(/^[0-9a-f]{32}$/);

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    expect(outer.__rules__).toHaveLength(2);
    const oldIds = JSON.parse(outer.__oldIds__);
    expect(oldIds).toEqual(['SaleOrder-OutStock']);

    const rule0 = JSON.parse(outer.__rules__[0]);
    const rule1 = JSON.parse(outer.__rules__[1]);
    const paras0 = JSON.parse(rule0.__paras__);
    const paras1 = JSON.parse(rule1.__paras__);
    expect(paras0.Id).toBe('SaleOrder-OutStock');
    expect(paras0.OldId).toBe('SaleOrder-OutStock');
    expect(paras1.Id).toBe(result.newExtensionId);
    expect(paras1.OldId).toBeNull();
  });

  it('passes origin XML verbatim in rule[0]', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, { baseline: SAMPLE_BASELINE, isv: UNW_ISV });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule0 = JSON.parse(outer.__rules__[0]);
    expect(rule0.__source__).toBe(ORIGIN_XML);
  });

  it('regenerates every GUID in the new extension XML (no template GUID survives)', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, { baseline: SAMPLE_BASELINE, isv: UNW_ISV });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule1 = JSON.parse(outer.__rules__[1]);
    expect(rule1.__source__).not.toContain('11111111-2222-3333-4444-555555555555');
    expect(rule1.__source__).not.toContain('aabbccddeeff00112233445566778899');
    expect(rule1.__source__).toMatch(/<LinkEntityPolicy ElementType="7008">/);
    expect(rule1.__source__).toMatch(/<FieldMap ElementType="60002">/);
  });

  it('uses caller-supplied ISV for top-level __isv__ and new-ext paras.ISV', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, { baseline: SAMPLE_BASELINE, isv: UNW_ISV });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const topIsv = JSON.parse(outer.__isv__);
    expect(topIsv.Name).toBe('UNW');
    expect(topIsv.Id).toBe('IBHC-LMFG-QIMZ-LHQA-VFBK');

    const rule1 = JSON.parse(outer.__rules__[1]);
    const paras1 = JSON.parse(rule1.__paras__);
    expect(paras1.ISV.Name).toBe('UNW');
  });

  it('keeps origin paras.ISV as Kingdee (not the caller ISV)', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, { baseline: SAMPLE_BASELINE, isv: UNW_ISV });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule0 = JSON.parse(outer.__rules__[0]);
    const paras0 = JSON.parse(rule0.__paras__);
    expect(paras0.ISV.Name).toBe('Kingdee');
    expect(paras0.ISV.Id).toBeNull();
  });

  it('threads displayName into the new extension Name (zh-CN slot 2052)', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, {
      baseline: SAMPLE_BASELINE,
      isv: UNW_ISV,
      displayName: '我的扩展',
    });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule1 = JSON.parse(outer.__rules__[1]);
    const paras1 = JSON.parse(rule1.__paras__);
    const names = JSON.parse(paras1.Name) as { Key: number; Value: string }[];
    expect(names.find((n) => n.Key === 2052)?.Value).toBe('我的扩展');
  });
});

describe('deleteConvertRuleExtension', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends rules=[origin] with oldIds=[origin.Id, extId]', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    const result = await deleteConvertRuleExtension(session, {
      baseline: SAMPLE_BASELINE,
      extId: 'fe6154fe-7144-4633-97e9-601f65135ae9',
      isv: UNW_ISV,
    });

    expect(result.ok).toBe(true);
    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    expect(outer.__rules__).toHaveLength(1);
    const oldIds = JSON.parse(outer.__oldIds__);
    expect(oldIds).toEqual(['SaleOrder-OutStock', 'fe6154fe-7144-4633-97e9-601f65135ae9']);
  });

  it('passes origin XML and origin paras unchanged', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await deleteConvertRuleExtension(session, {
      baseline: SAMPLE_BASELINE,
      extId: 'some-ext',
      isv: UNW_ISV,
    });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule0 = JSON.parse(outer.__rules__[0]);
    expect(rule0.__source__).toBe(ORIGIN_XML);
    const paras0 = JSON.parse(rule0.__paras__);
    expect(paras0.Id).toBe('SaleOrder-OutStock');
  });

  it('uses the caller ISV in top-level __isv__', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await deleteConvertRuleExtension(session, {
      baseline: SAMPLE_BASELINE,
      extId: 'some-ext',
      isv: UNW_ISV,
    });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const topIsv = JSON.parse(outer.__isv__);
    expect(topIsv.Name).toBe('UNW');
  });
});
