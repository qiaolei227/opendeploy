import { describe, expect, it, afterEach } from 'vitest';
import { encodeAppLayer, decodeAppLayerString } from '../../../src/main/erp/k3cloud/rpc/codec';
import {
  getAllConvertPaths,
  getConvertRule,
} from '../../../src/main/erp/k3cloud/rpc/convert-rules';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';

const realFetch = globalThis.fetch;

const session: KdSession = {
  baseUrl: 'http://localhost/k3cloud',
  aspNetSessionId: 'asp1',
  kdServiceSessionId: 'kd1',
};

describe('getAllConvertPaths', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('hits ConvertService.GetAllPaths endpoint', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(encodeAppLayer(JSON.stringify([])));
    }) as typeof fetch;

    await getAllConvertPaths(session);

    expect(capturedUrl).toBe(
      'http://localhost/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService.GetAllPaths.common.kdsvc',
    );
  });

  it('returns parsed array of paths', async () => {
    const sample = [
      {
        SourceFormId: 'SAL_SaleOrder',
        TargetFormId: 'SAL_OUTSTOCK',
        SourceFormName: [{ Key: 2052, Value: '销售订单' }],
        TargetFormName: [{ Key: 2052, Value: '销售出库单' }],
      },
      {
        SourceFormId: 'SAL_SaleOrder',
        TargetFormId: 'SAL_DELIVERYNOTICE',
        SourceFormName: [{ Key: 2052, Value: '销售订单' }],
        TargetFormName: [{ Key: 2052, Value: '发货通知单' }],
      },
    ];
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify(sample)))) as typeof fetch;

    const result = await getAllConvertPaths(session);
    expect(result).toHaveLength(2);
    expect(result[0].SourceFormId).toBe('SAL_SaleOrder');
    expect(result[0].TargetFormId).toBe('SAL_OUTSTOCK');
    expect(result[0].SourceFormName[0].Value).toBe('销售订单');
  });

  it('returns empty array when server body is empty', async () => {
    globalThis.fetch = (async () => new Response('')) as typeof fetch;
    const result = await getAllConvertPaths(session);
    expect(result).toEqual([]);
  });

  it('handles raw-JSON response (no app-layer encoding)', async () => {
    const sample = [{ SourceFormId: 'A', TargetFormId: 'B', SourceFormName: [], TargetFormName: [] }];
    globalThis.fetch = (async () => new Response(JSON.stringify(sample))) as typeof fetch;
    const result = await getAllConvertPaths(session);
    expect(result).toHaveLength(1);
  });
});

describe('getConvertRule', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('hits ConvertService.GetConvertRule endpoint', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(encodeAppLayer(JSON.stringify(minimalRule())));
    }) as typeof fetch;

    await getConvertRule(session, 'SaleOrder-OutStock');

    expect(capturedUrl).toBe(
      'http://localhost/k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService.GetConvertRule.common.kdsvc',
    );
  });

  it('encodes ap0 = ruleId as raw app-layer string', async () => {
    let capturedAp0 = '';
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      capturedAp0 = params.get('ap0') ?? '';
      return new Response(encodeAppLayer(JSON.stringify(minimalRule())));
    }) as typeof fetch;

    await getConvertRule(session, 'SaleOrder-OutStock');

    expect(capturedAp0).toBeTruthy();
    expect(decodeAppLayerString(capturedAp0)).toBe('SaleOrder-OutStock');
  });

  it('returns parsed top-level + Rule + Policies', async () => {
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify(minimalRule())))) as typeof fetch;

    const result = await getConvertRule(session, 'SaleOrder-OutStock');
    expect(result.Id).toBe('SaleOrder-OutStock');
    expect(result.ModelTypeId).toBe(790);
    expect(result.Rule.SourceFormId).toBe('SAL_SaleOrder');
    expect(result.Rule.Policies).toHaveLength(1);
    expect(result.Rule.Policies[0].___InstClassType__).toContain('DefaultConvertPolicyElement');
  });

  it('throws when Rule field missing (contract violation)', async () => {
    globalThis.fetch = (async () =>
      new Response(encodeAppLayer(JSON.stringify({ Id: 'X' })))) as typeof fetch;
    await expect(getConvertRule(session, 'X')).rejects.toThrow(/Rule/);
  });

  it('throws when server body empty', async () => {
    globalThis.fetch = (async () => new Response('')) as typeof fetch;
    await expect(getConvertRule(session, 'X')).rejects.toThrow();
  });
});

function minimalRule() {
  return {
    Id: 'SaleOrder-OutStock',
    ModelTypeId: 790,
    Name: [{ Key: 2052, Value: '销售订单->销售出库单' }],
    SourceFormId: 'SAL_SaleOrder',
    Rule: {
      ___InstClassType__: 'Kingdee.BOS.Core.Metadata.ConvertElement.ConvertRuleElement,Kingdee.BOS.Core',
      SourceFormId: 'SAL_SaleOrder',
      TargetFormId: 'SAL_OUTSTOCK',
      Status: true,
      IsDefault: true,
      Invisible: false,
      IsRandom: true,
      FreePush: false,
      CheckLinkSet: true,
      Formula: null,
      PushRunCondition: null,
      PushRunConditionExt: null,
      ConvertType: 0,
      Policies: [
        {
          ___InstClassType__:
            'Kingdee.BOS.Core.Metadata.ConvertElement.DefaultConvertPolicyElement,Kingdee.BOS.Core',
          SourceEntryKey: 'FSaleOrderEntry',
          TargetEntryKey: 'FEntity',
          FieldMaps: [],
          ConvertPolicyTypeName: 'DefaultConvertPolicy',
          OrderNo: 3,
        },
      ],
    },
  };
}
