/**
 * Lever 3 followup integration test (2026-05-07) — `connector.addToolbarButton`
 * + `connector.removeToolbarButton` are now Route B (envelope rebuild). This
 * test asserts the connector composes a `SaveExtensionRequest` with all
 * `existingXxxRaw` buckets populated (F5 防护) AND with the new BarButton
 * field set correctly (addBarButtons / removeBarButtons).
 *
 * Why "simulate agent dialog" here: the user's e2e test plan (manual BOS
 * Designer interaction) is replaced for CI by capturing what the connector
 * WOULD send. We mock fetch + getKernelXml so no real BOS server is needed,
 * then assert the wire shape matches the locked wire-replay snapshot.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { encodeAppLayer } from '../../src/main/erp/k3cloud/rpc/codec';
import * as saveForIde from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import type { SaveExtensionRequest, SaveExtensionResult } from '../../src/main/erp/k3cloud/rpc/types';

const realFetch = globalThis.fetch;

const FAKE_PARENT_FKERNEL = `
<?xml version="1.0" encoding="utf-16"?>
<FormMetadata>
  <BusinessInfo><BusinessInfo><Elements></Elements></BusinessInfo></BusinessInfo>
  <LayoutInfos>
    <LayoutInfo oid="parent-layout-oid">
      <Appearances>
        <FormAppearance oid="parent-form-appearance-oid" ElementType="100" ElementStyle="1">
          <Menu><BarDataManager><Id>parent-bar-mgr</Id></BarDataManager></Menu>
        </FormAppearance>
      </Appearances>
    </LayoutInfo>
  </LayoutInfos>
</FormMetadata>`.trim();

const FAKE_EXT_FKERNEL = `
<?xml version="1.0" encoding="utf-16"?>
<FormMetadata>
  <BusinessInfo><BusinessInfo>
    <Elements>
      <Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">
        <Id>00000000000000000000000000000001</Id>
      </Form>
      <TextField oid="FExistingFieldA" ElementType="1"><Key>FExistingFieldA</Key></TextField>
    </Elements>
  </BusinessInfo></BusinessInfo>
  <LayoutInfos>
    <LayoutInfo action="edit" oid="parent-layout-oid">
      <Appearances></Appearances>
    </LayoutInfo>
  </LayoutInfos>
</FormMetadata>`.trim();

function setupConnector(): {
  connector: K3CloudConnector;
  capturedReq: { value: SaveExtensionRequest | null };
  saveSpy: ReturnType<typeof vi.spyOn>;
} {
  const connector = new K3CloudConnector(
    {
      baseUrl: 'http://localhost/k3cloud',
      acctId: 'test-acct',
      username: 'admin',
      password: 'test',
      devCode: 'TEST',
    },
    {},
    'test-project',
  );
  // Inject fake session so `requireSession()` doesn't throw.
  (connector as unknown as { session: object }).session = {
    baseUrl: 'http://localhost/k3cloud',
    aspNetSessionId: 'asp1',
    kdServiceSessionId: 'kd1',
  };

  // Stub the read paths the connector relies on.
  vi.spyOn(connector, 'getObject').mockImplementation(async (id: string) => ({
    id,
    name: '测试扩展',
    baseObjectId: 'SAL_SaleOrder',
    modelTypeId: 100,
    subsystemId: '23',
    isExtension: true,
  }));
  vi.spyOn(connector, 'getKernelXml').mockImplementation(async (id: string) =>
    id === 'SAL_SaleOrder' ? FAKE_PARENT_FKERNEL : FAKE_EXT_FKERNEL,
  );
  vi.spyOn(connector, 'listOperations').mockResolvedValue({
    operations: [],
    toolbarButtons: [
      {
        buttonKey: 'btnExisting',
        buttonId: '33333333333333333333333333333333',
        caption: '已有按钮',
        seq: 1,
        parentEntityKey: null,
        boundOperationKey: 'ExistingOp',
        barItemLinkId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
      },
    ],
  });

  // Spy on saveExtension to capture request shape without actually POSTing.
  const capturedReq = { value: null as SaveExtensionRequest | null };
  const saveSpy = vi.spyOn(saveForIde, 'saveExtension').mockImplementation(
    async (_session, req): Promise<SaveExtensionResult> => {
      capturedReq.value = req;
      return { isSuccess: true, funcResult: true, messageTitle: null, messageDetail: null };
    },
  );

  return { connector, capturedReq, saveSpy };
}

describe('connector.addToolbarButton — Route B envelope (lever 3 followup)', () => {
  beforeEach(() => {
    globalThis.fetch = (async () => new Response(encodeAppLayer(''))) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('composes SaveExtensionRequest with addBarButtons + all existingXxxRaw populated', async () => {
    const { connector, capturedReq } = setupConnector();

    const result = await connector.addToolbarButton({
      extensionFid: '00000000000000000000000000000001',
      target: { kind: 'form' },
      buttonKey: 'OpdpDiscount',
      buttonId: 'aabbccdd11223344aabbccdd11223344',
      caption: '打折',
      seq: 1,
      boundOperationKey: 'OpdpDiscountOp',
      boundOperationName: '打折操作',
      toolbarKey: 'tbToolBar',
      barDataManagerId: '11111111-1111-1111-1111-111111111111',
      formBusinessServiceId: '22222222-2222-2222-2222-222222222222',
      barItemLinkId: '33333333-3333-3333-3333-333333333333',
    });

    expect(result.buttonKey).toBe('OpdpDiscount');

    const req = capturedReq.value;
    expect(req).not.toBeNull();
    if (!req) return;

    // F5 guard: every existingXxxRaw bucket present (even if empty).
    // Forgetting any of these silently wipes that element class server-side.
    expect(req.existingFieldsRaw).toBeDefined();
    expect(req.existingFieldsRaw).toContain('<TextField oid="FExistingFieldA" ElementType="1"><Key>FExistingFieldA</Key></TextField>');
    expect(req.existingAppearancesRaw).toBeDefined();
    expect(req.existingPluginsRaw).toBeDefined();
    expect(req.existingEntriesRaw).toBeDefined();
    expect(req.existingEntryAppearancesRaw).toBeDefined();
    expect(req.existingTabPagesRaw).toBeDefined();
    expect(req.existingTabControlsRaw).toBeDefined();
    expect(req.existingFormOperationsRaw).toBeDefined();

    // Route B target shape — addBarButtons populated, no Route C fallback.
    expect(req.addBarButtons).toBeDefined();
    expect(req.addBarButtons).toHaveLength(1);
    expect(req.addBarButtons![0]).toMatchObject({
      appearanceOid: 'parent-form-appearance-oid',
      appearanceKind: 'FormAppearance',
      appearanceElementType: 100,
      buttonKey: 'OpdpDiscount',
      buttonId: 'aabbccdd11223344aabbccdd11223344',
      caption: '打折',
      boundOperationKey: 'OpdpDiscountOp',
      boundOperationName: '打折操作',
      toolbarKey: 'tbToolBar',
      barDataManagerId: '11111111-1111-1111-1111-111111111111',
      formBusinessServiceId: '22222222-2222-2222-2222-222222222222',
      barItemLinkId: '33333333-3333-3333-3333-333333333333',
    });

    // Envelope basics — F4 guard: layoutInfoOid threaded from parent.
    expect(req.layoutInfoOid).toBe('parent-layout-oid');
    expect(req.isNew).toBe(false);
    expect(req.extension.formId).toBe('00000000000000000000000000000001');
    expect(req.extension.baseObjectId).toBe('SAL_SaleOrder');
  });
});

describe('connector.removeToolbarButton — Route B envelope (lever 3 followup)', () => {
  beforeEach(() => {
    globalThis.fetch = (async () => new Response(encodeAppLayer(''))) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('composes SaveExtensionRequest with removeBarButtons + all existingXxxRaw populated', async () => {
    const { connector, capturedReq } = setupConnector();

    await connector.removeToolbarButton('00000000000000000000000000000001', 'btnExisting');

    const req = capturedReq.value;
    expect(req).not.toBeNull();
    if (!req) return;

    expect(req.removeBarButtons).toBeDefined();
    expect(req.removeBarButtons).toHaveLength(1);
    expect(req.removeBarButtons![0]).toMatchObject({
      appearanceOid: 'parent-form-appearance-oid',
      appearanceKind: 'FormAppearance',
      appearanceElementType: 100,
      buttonId: '33333333333333333333333333333333',
      barItemLinkId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
    });
    expect(req.layoutInfoOid).toBe('parent-layout-oid');
    expect(req.existingFieldsRaw).toBeDefined();
    expect(req.existingFormOperationsRaw).toBeDefined();
  });

  it('throws when buttonKey not found in listOperations', async () => {
    const { connector } = setupConnector();
    await expect(
      connector.removeToolbarButton('00000000000000000000000000000001', 'NonExistentBtn'),
    ).rejects.toThrow(/按钮 NonExistentBtn 不存在/);
  });
});
