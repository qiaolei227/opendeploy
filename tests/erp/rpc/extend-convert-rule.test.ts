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

// Server-side live Version values (`getConvertRule` returns these in the
// rule wrapper, the new code threads them into rule[0] paras to avoid
// MainVersion-mismatch creating duplicate origin rules).
const LIVE_VERSION = '634703641059182961';
const LIVE_MAIN_VERSION = '639131611327136100';

const ORIGIN_XML =
  '<?xml version="1.0" encoding="utf-16"?><ConvertRuleMetaData><Rule>' +
  '<ConvertRule ElementType="6000"><Id>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</Id></ConvertRule>' +
  '</Rule></ConvertRuleMetaData>';
const EXT_TEMPLATE_XML =
  '<?xml version="1.0" encoding="utf-16"?><ConvertRuleMetaData><Rule>' +
  '<ConvertRule ElementType="6000"><Policies>' +
  '<LinkEntityPolicy ElementType="7008"><Id>11111111-2222-3333-4444-555555555555</Id></LinkEntityPolicy>' +
  '</Policies></ConvertRule></Rule></ConvertRuleMetaData>';

const SAMPLE_BASELINE: ConvertRuleBaseline = buildSaleOrderOutStockBaseline({
  originXml: ORIGIN_XML,
  extensionTemplateXml: EXT_TEMPLATE_XML,
});

/**
 * The new `extendConvertRule` issues two RPC calls per save:
 *   1. `GetConvertRule(originRuleId)` to read live `Version` / `MainVersion`
 *   2. `SaveRulesV9` with the assembled envelope
 *
 * The mock returns canned `Version` / `MainVersion` for #1 and captures
 * the ap0 payload sent to #2.
 */
function captureSavePayload(): {
  capturedAp0: { value: string };
  fetchSpy: typeof fetch;
} {
  const capturedAp0 = { value: '' };
  const fetchSpy = (async (url: string, init?: RequestInit) => {
    if (url.includes('GetConvertRule')) {
      return new Response(
        encodeAppLayer(
          JSON.stringify({
            Id: 'SaleOrder-OutStock',
            Version: LIVE_VERSION,
            MainVersion: LIVE_MAIN_VERSION,
            Rule: { Policies: [] },
          }),
        ),
      );
    }
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

  it('rule[0] sends a minimal origin envelope (Status reset, Id/Key only) — not the full origin XML', async () => {
    // Sending the full baseline.originXml triggers a server-side modify of
    // the standard rule against stale baseline content and was observed to
    // flip <IsDefault> / <Status> on it. The minimal shape leaves the
    // standard rule untouched while still anchoring the new extension's
    // lineage via oldIds.
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, { baseline: SAMPLE_BASELINE, isv: UNW_ISV });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule0 = JSON.parse(outer.__rules__[0]);
    expect(rule0.__source__).not.toBe(ORIGIN_XML);
    expect(rule0.__source__).toContain('<Status action="reset" />');
    expect(rule0.__source__).toContain('<Id>SaleOrder-OutStock</Id>');
    expect(rule0.__source__).toContain('<Key>SaleOrder-OutStock</Key>');
    expect(rule0.__source__).not.toContain('LinkEntityPolicy');
  });

  it('rule[0] paras carry live Version + MainVersion (not the baseline snapshot)', async () => {
    // MainVersion ticks up on every save of the standard rule. If we send the
    // baseline-frozen value, the server treats the modify as stale and creates
    // an independent duplicate of the rule. Live values come from getConvertRule.
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, { baseline: SAMPLE_BASELINE, isv: UNW_ISV });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const paras0 = JSON.parse(JSON.parse(outer.__rules__[0]).__paras__);
    expect(paras0.Version).toBe(LIVE_VERSION);
    expect(paras0.MainVersion).toBe(LIVE_MAIN_VERSION);
  });

  it('rule[1] sends a minimal extension XML (Status reset + Name + Id/Key) — not a full template clone', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    const result = await extendConvertRule(session, {
      baseline: SAMPLE_BASELINE, isv: UNW_ISV, displayName: '我的扩展',
    });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule1Source = JSON.parse(outer.__rules__[1]).__source__;
    expect(rule1Source).toContain('<Status action="reset" />');
    expect(rule1Source).toContain(`<Id>${result.newExtensionId}</Id>`);
    expect(rule1Source).toContain(`<Key>${result.newExtensionId}</Key>`);
    expect(rule1Source).toContain('<Name>我的扩展</Name>');
    // Server inherits Policies from BaseObjectId; we don't ship them
    expect(rule1Source).not.toContain('LinkEntityPolicy');
  });

  it('rule[1] paras.BaseObjectId points at the origin rule id (server lineage anchor)', async () => {
    // Without BaseObjectId, the server creates the rule as a top-level
    // sibling instead of an extension child of SaleOrder-OutStock.
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await extendConvertRule(session, { baseline: SAMPLE_BASELINE, isv: UNW_ISV });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const paras1 = JSON.parse(JSON.parse(outer.__rules__[1]).__paras__);
    expect(paras1.BaseObjectId).toBe('SaleOrder-OutStock');
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

  it('rule[0] sends the same minimal origin envelope on delete (no full XML body)', async () => {
    const { capturedAp0, fetchSpy } = captureSavePayload();
    globalThis.fetch = fetchSpy;

    await deleteConvertRuleExtension(session, {
      baseline: SAMPLE_BASELINE,
      extId: 'some-ext',
      isv: UNW_ISV,
    });

    const outer = JSON.parse(decodeAppLayerString(capturedAp0.value));
    const rule0 = JSON.parse(outer.__rules__[0]);
    expect(rule0.__source__).toContain('<Status action="reset" />');
    expect(rule0.__source__).toContain('<Id>SaleOrder-OutStock</Id>');
    expect(rule0.__source__).not.toContain('LinkEntityPolicy');
    const paras0 = JSON.parse(rule0.__paras__);
    expect(paras0.Version).toBe(LIVE_VERSION);
    expect(paras0.MainVersion).toBe(LIVE_MAIN_VERSION);
  });
});
