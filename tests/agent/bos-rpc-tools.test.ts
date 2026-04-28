import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildBosRpcTools } from '../../src/main/agent/bos-rpc-tools';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '../../src/shared/erp-types';
import type { KdSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import type { DeleteExtensionResult } from '../../src/main/erp/k3cloud/rpc/delete-extension';

vi.mock('../../src/main/projects/store', () => ({
  getProject: vi.fn(),
}));
vi.mock('../../src/main/erp/k3cloud/rpc/delete-extension', () => ({
  deleteExtension: vi.fn(),
}));
vi.mock('../../src/main/erp/k3cloud/rpc/save-for-ide', () => ({
  saveExtension: vi.fn(),
}));
vi.mock('../../src/main/erp/k3cloud/rpc/save-enum-object', async (importOriginal) => {
  // Keep buildEnumSaveAp0 (pure builder) real; only mock the RPC.
  const original = await importOriginal<typeof import('../../src/main/erp/k3cloud/rpc/save-enum-object')>();
  return {
    ...original,
    saveEnumObject: vi.fn(),
  };
});
vi.mock('../../src/main/erp/k3cloud/rpc/enum-objects', () => ({
  addEnumObjectToRecycle: vi.fn(),
  updateMetaCacheByEnumTypeId: vi.fn(),
}));

import { getProject } from '../../src/main/projects/store';
import { deleteExtension } from '../../src/main/erp/k3cloud/rpc/delete-extension';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import { saveEnumObject } from '../../src/main/erp/k3cloud/rpc/save-enum-object';
import { addEnumObjectToRecycle, updateMetaCacheByEnumTypeId } from '../../src/main/erp/k3cloud/rpc/enum-objects';
import type { ObjectMeta } from '../../src/shared/erp-types';
import type { SaveExtensionRequest } from '../../src/main/erp/k3cloud/rpc/types';

const mockedGetProject = getProject as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = deleteExtension as unknown as ReturnType<typeof vi.fn>;
const mockedSave = saveExtension as unknown as ReturnType<typeof vi.fn>;
const mockedSaveEnum = saveEnumObject as unknown as ReturnType<typeof vi.fn>;
const mockedRecycle = addEnumObjectToRecycle as unknown as ReturnType<typeof vi.fn>;
const mockedUpdateCache = updateMetaCacheByEnumTypeId as unknown as ReturnType<typeof vi.fn>;

const SAL_LAYOUT_OID = 'bc952920-057d-4790-9c27-1134091eb298';

const SAL_PARENT_OBJECT: ObjectMeta = {
  id: 'SAL_SaleOrder',
  name: '销售订单',
  modelTypeId: 100,
  subsystemId: '23',
  baseObjectId: null,
  isTemplate: false,
  modifyDate: null,
};

/**
 * Stable fake mapping covering the basedata FormIds the tests touch. Real
 * server returns ~1864 entries; this covers everything we exercise.
 */
const FAKE_LOOKUP_GUID: Record<string, string> = {
  bd_customer: '407d24cb-57f7-46bf-afb6-a9ab458fd845',
  bd_material: '624b39cf-5504-42e0-9124-7d75e64a05f1',
  bd_department: '5b43df86-906c-4b59-95bc-884f05e2533c',
  bd_unit: 'e6213815-6b93-4cff-83bf-f26f807b7f4d',
  bd_unitgroup: '4a483516-0d08-4927-9d0b-c749ddc616ea',
};

/** Stable fake enum types covering the combo tests. */
const FAKE_ENUM_GUID: Record<string, string> = {
  '审核状态': '328c8d2f-593c-4685-8772-36ed6f9b2340',
  '单据状态': '0740da73-21ca-4c7f-9935-0dbb59096c27',
  'opendeploy_test_enum': 'b2016b47-df73-4639-acff-68d95f87e724',
};

const makeFakeConnector = (
  overrides: Partial<{
    getObject: (id: string) => Promise<ObjectMeta | null>;
    getKernelXml: (id: string) => Promise<string | null>;
    resolveLookupClassGuid: (formId: string) => Promise<{ id: string; formId: string } | null>;
    resolveEnumTypeGuid: (name: string) => Promise<{ id: string; name: string } | null>;
  }> = {},
): K3CloudConnector =>
  ({
    config: {
      server: 'localhost',
      database: 'AIS001',
      user: 'sa',
      password: 'x',
    },
    getObject: overrides.getObject ?? (async () => SAL_PARENT_OBJECT),
    getKernelXml:
      overrides.getKernelXml ??
      (async () => `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`),
    resolveLookupClassGuid:
      overrides.resolveLookupClassGuid ??
      (async (formId: string) => {
        const id = FAKE_LOOKUP_GUID[formId.toLowerCase()];
        return id ? { id, formId } : null;
      }),
    resolveEnumTypeGuid:
      overrides.resolveEnumTypeGuid ??
      (async (name: string) => {
        const id = FAKE_ENUM_GUID[name.toLowerCase()];
        return id ? { id, name } : null;
      }),
    invalidateEnumCache: vi.fn(),
  }) as unknown as K3CloudConnector;

const makeProject = (withBos = true): Project => ({
  id: 'p1',
  name: 'Test',
  erpProvider: 'k3cloud',
  connection: {
    server: 'localhost',
    database: 'AIS001',
    user: 'sa',
    password: 'x',
  },
  bos: withBos
    ? {
        baseUrl: 'http://localhost/k3cloud',
        acctId: 'acct1',
        username: 'demo',
        password: '1qaz',
        devCode: 'PAIJ',
      }
    : undefined,
  createdAt: '2026-04-27T00:00:00Z',
  updatedAt: '2026-04-27T00:00:00Z',
});

const makeSessionMgr = (
  session: KdSession = { baseUrl: 'http://localhost/k3cloud' },
) => ({
  getOrLogin: vi.fn().mockResolvedValue(session),
  invalidate: vi.fn(),
});

beforeEach(() => {
  mockedGetProject.mockReset();
  mockedDelete.mockReset();
  mockedSave.mockReset();
  mockedSaveEnum.mockReset();
  mockedRecycle.mockReset();
  mockedUpdateCache.mockReset();
});

describe('buildBosRpcTools', () => {
  it('returns all six write tools when project has bos creds', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    expect(tools.map((t) => t.definition.name).sort()).toEqual([
      'kingdee_add_fields',
      'kingdee_create_enum_type',
      'kingdee_create_extension',
      'kingdee_delete_enum_type',
      'kingdee_delete_extension',
      'kingdee_register_python_plugins',
    ]);
  });

  it('returns empty when project has no bos creds', async () => {
    mockedGetProject.mockResolvedValue(makeProject(false));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    expect(tools).toEqual([]);
  });

  it('returns empty when no project is provided', async () => {
    // No connector → active singleton is idle in tests → no projectId
    const tools = await buildBosRpcTools();
    expect(tools).toEqual([]);
  });
});

describe('kingdee_delete_extension', () => {
  it('logs in via session manager, calls deleteExtension RPC, returns ok json', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    mockedDelete.mockResolvedValue({
      ok: true,
      responseBody: '',
    } satisfies DeleteExtensionResult);
    const session: KdSession = {
      baseUrl: 'http://localhost/k3cloud',
      kdServiceSessionId: 'sid',
    };
    const sessionMgr = makeSessionMgr(session);
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', sessionMgr);
    const tool = tools.find((t) => t.definition.name === 'kingdee_delete_extension')!;

    const result = JSON.parse(await tool.execute({ extId: 'abc123' }));

    expect(sessionMgr.getOrLogin).toHaveBeenCalledWith('p1');
    expect(mockedDelete).toHaveBeenCalledWith(session, 'abc123', { devCode: 'PAIJ' });
    expect(result.ok).toBe(true);
    expect(result.extId).toBe('abc123');
    expect(result.reminder).toContain('刷新');
  });

  it('surfaces server-side failure as ok=false with message', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    mockedDelete.mockResolvedValue({
      ok: false,
      responseBody: '{"Message":"扩展不存在"}',
      message: '扩展不存在',
    } satisfies DeleteExtensionResult);
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'kingdee_delete_extension')!;

    const result = JSON.parse(await tool.execute({ extId: 'ghost' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('扩展不存在');
  });

  it('throws clear error when extId is missing or empty', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'kingdee_delete_extension')!;

    await expect(tool.execute({})).rejects.toThrow(/extId/);
    await expect(tool.execute({ extId: '   ' })).rejects.toThrow(/extId/);
  });

  it('throws when project loses creds between build and execute', async () => {
    // Build phase sees creds...
    mockedGetProject.mockResolvedValueOnce(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'kingdee_delete_extension')!;
    // ...but execute phase finds them gone.
    mockedGetProject.mockResolvedValueOnce(makeProject(false));

    await expect(tool.execute({ extId: 'abc123' })).rejects.toThrow(/未配置 BOS 写入凭据/);
  });

  it('uses devCode from project on the RPC call', async () => {
    const project = makeProject(true);
    project.bos!.devCode = 'CUSTOM_ISV';
    mockedGetProject.mockResolvedValue(project);
    mockedDelete.mockResolvedValue({ ok: true, responseBody: '' });
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'kingdee_delete_extension')!;

    await tool.execute({ extId: 'abc123' });

    expect(mockedDelete).toHaveBeenCalledWith(
      expect.anything(),
      'abc123',
      { devCode: 'CUSTOM_ISV' },
    );
  });
});

describe('kingdee_create_extension', () => {
  const findCreate = async (connector = makeFakeConnector(), session = makeSessionMgr()) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(connector, 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'kingdee_create_extension');
    if (!tool) throw new Error('kingdee_create_extension not in tool list');
    return { tool, session };
  };

  it('discovers layoutInfoOid from parent FKERNELXML and calls saveExtension as isNew', async () => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
    const { tool } = await findCreate();

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '信用额度预警' }),
    );

    expect(out.ok).toBe(true);
    expect(out.parentFormId).toBe('SAL_SaleOrder');
    expect(out.extName).toBe('信用额度预警');
    expect(out.layoutInfoOid).toBe(SAL_LAYOUT_OID);
    expect(out.extId).toMatch(/^[a-f0-9]{32}$/); // compact GUID

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.isNew).toBe(true);
    expect(req.layoutInfoOid).toBe(SAL_LAYOUT_OID);
    expect(req.extension.formId).toBe(out.extId);
    expect(req.extension.baseObjectId).toBe('SAL_SaleOrder');
    expect(req.extension.modelTypeId).toBe(100);
    expect(req.extension.subSystemId).toBe('23');
    expect(req.extension.name).toEqual([{ localeId: 2052, value: '信用额度预警' }]);
    expect(req.extension.isv.devCode).toBe('PAIJ');
    expect(req.addFields).toBeUndefined();
    expect(req.addAppearances).toBeUndefined();
  });

  it('uses agent-supplied layoutInfoOid when provided (skips auto-discovery)', async () => {
    mockedSave.mockResolvedValue({ isSuccess: true, funcResult: true, messageTitle: null, messageDetail: null });
    const getKernelXml = vi.fn().mockResolvedValue(null);
    const { tool } = await findCreate(makeFakeConnector({ getKernelXml }));

    await tool.execute({
      parentFormId: 'SAL_SaleOrder',
      extName: '测试',
      layoutInfoOid: 'manual-oid-1234',
    });

    expect(getKernelXml).not.toHaveBeenCalled();
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.layoutInfoOid).toBe('manual-oid-1234');
  });

  it('errors out when parent form does not exist', async () => {
    const { tool } = await findCreate(
      makeFakeConnector({ getObject: async () => null }),
    );

    await expect(
      tool.execute({ parentFormId: 'GHOST_FORM', extName: '测试' }),
    ).rejects.toThrow(/GHOST_FORM 不存在/);
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('errors out when parent has no FKERNELXML and agent did not supply layoutInfoOid', async () => {
    const { tool } = await findCreate(
      makeFakeConnector({ getKernelXml: async () => null }),
    );

    await expect(
      tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '测试' }),
    ).rejects.toThrow(/无 FKERNELXML/);
  });

  it('errors out when FKERNELXML has no LayoutInfo element', async () => {
    const { tool } = await findCreate(
      makeFakeConnector({ getKernelXml: async () => '<FormMetadata></FormMetadata>' }),
    );

    await expect(
      tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '测试' }),
    ).rejects.toThrow(/未找到 <LayoutInfo/);
  });

  it('surfaces server-side rejection as ok=false', async () => {
    mockedSave.mockResolvedValue({
      isSuccess: false,
      funcResult: false,
      messageTitle: '保存失败',
      messageDetail: '当前用户无权限',
    });
    const { tool } = await findCreate();

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '测试' }),
    );
    expect(out.ok).toBe(false);
    expect(out.messageTitle).toBe('保存失败');
    expect(out.messageDetail).toBe('当前用户无权限');
  });

  it('rejects empty parentFormId / extName', async () => {
    const { tool } = await findCreate();
    await expect(tool.execute({ parentFormId: '', extName: 'x' })).rejects.toThrow(/parentFormId/);
    await expect(tool.execute({ parentFormId: 'x', extName: '' })).rejects.toThrow(/extName/);
  });

  it('errors when parent metadata is incomplete (missing modelTypeId / subsystemId)', async () => {
    const { tool } = await findCreate(
      makeFakeConnector({
        getObject: async () => ({
          ...SAL_PARENT_OBJECT,
          modelTypeId: null,
          subsystemId: null,
        }),
      }),
    );

    await expect(
      tool.execute({ parentFormId: 'BROKEN_FORM', extName: '测试' }),
    ).rejects.toThrow(/元数据不完整/);
  });
});

describe('kingdee_add_fields', () => {
  const EXT_ID = 'ee0011223344556677889900aabbccdd';
  const EXTENSION_OBJECT: ObjectMeta = {
    id: EXT_ID,
    name: '信用额度预警',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: 'SAL_SaleOrder',
    isTemplate: false,
    modifyDate: null,
  };

  const PARENT_LAYOUT_XML = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;
  /** Empty extension XML — no existing fields/appearances/plugins yet. */
  const EMPTY_EXT_XML = `<FormMetadata><BusinessInfo><BusinessInfo><Elements><Form><Id>${EXT_ID}</Id></Form></Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

  const findAddFields = async (
    connector?: K3CloudConnector,
    session = makeSessionMgr(),
  ) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c =
      connector ??
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? EMPTY_EXT_XML : PARENT_LAYOUT_XML,
      });
    const tools = await buildBosRpcTools(c, 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'kingdee_add_fields');
    if (!tool) throw new Error('kingdee_add_fields not in tool list');
    return { tool };
  };

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it('writes one field in a single saveExtension call', async () => {
    const { tool } = await findAddFields();

    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        fields: [{ type: 'text', key: 'F_PAIJ_Note', caption: '备注' }],
      }),
    );

    expect(out.ok).toBe(true);
    expect(out.addedCount).toBe(1);
    expect(out.fields[0]).toMatchObject({ key: 'F_PAIJ_Note', type: 'TextField' });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.isNew).toBe(false);
    expect(req.extension.formId).toBe(EXT_ID);
    expect(req.extension.baseObjectId).toBe('SAL_SaleOrder');
    expect(req.layoutInfoOid).toBe(SAL_LAYOUT_OID);
    expect(req.addFields).toHaveLength(1);
    expect(req.addAppearances).toHaveLength(1);
    expect(req.addFields![0]).toEqual({
      type: 'TextField',
      key: 'F_PAIJ_Note',
      caption: '备注',
      listTabIndex: 9000,
    });
  });

  it('writes multiple fields in ONE saveExtension call (the bug fix)', async () => {
    const { tool } = await findAddFields();

    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_A', caption: 'A' },
        { type: 'int', key: 'F_B', caption: 'B' },
        { type: 'date', key: 'F_C', caption: 'C' },
      ],
    });

    // Critical: only ONE saveExtension call, with all three fields packed in.
    expect(mockedSave).toHaveBeenCalledTimes(1);
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields).toHaveLength(3);
    expect(req.addFields!.map((f) => f.key)).toEqual(['F_A', 'F_B', 'F_C']);
    expect(req.addAppearances).toHaveLength(3);
  });

  it('reads extension FKERNELXML and forwards existing chunks (read-merge)', async () => {
    const existingFieldXml =
      '<TextField ElementType="1" ElementStyle="0"><Key>F_OLD</Key><Name>旧</Name><Id>old1</Id></TextField>';
    const existingAppearanceXml =
      '<TextFieldAppearance ElementType="1" ElementStyle="1"><Key>F_OLD</Key><Container>FTAB_P0</Container></TextFieldAppearance>';
    const existingPluginXml =
      '<PlugIn ElementType="0" ElementStyle="0"><ClassName>old_plug</ClassName><PlugInType>1</PlugInType><PyScript><![CDATA[#old]]></PyScript></PlugIn>';

    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>${EXT_ID}</Id><FormPlugins>${existingPluginXml}</FormPlugins></Form>
      ${existingFieldXml}
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>${existingAppearanceXml}</Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? populatedExtXml : PARENT_LAYOUT_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'text', key: 'F_NEW', caption: '新' }],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingFieldsRaw).toEqual([existingFieldXml]);
    expect(req.existingAppearancesRaw).toEqual([existingAppearanceXml]);
    expect(req.existingPluginsRaw?.[0]).toContain('<ClassName>old_plug</ClassName>');
    expect(req.existingPluginsRaw?.[0]).toContain('<![CDATA[#old]]>');
    // New field still in addFields (separate from existing).
    expect(req.addFields).toHaveLength(1);
    expect(req.addFields![0].key).toBe('F_NEW');
  });

  it('rejects empty fields array', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({ extId: EXT_ID, fields: [] }),
    ).rejects.toThrow(/fields/);
  });

  it('rejects duplicate keys within the batch', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [
          { type: 'text', key: 'F_DUP', caption: 'A' },
          { type: 'int', key: 'F_DUP', caption: 'B' },
        ],
      }),
    ).rejects.toThrow(/重复.*F_DUP/);
  });

  it('rejects extId pointing to a non-extension (no FBASEOBJECTID)', async () => {
    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async () => ({ ...SAL_PARENT_OBJECT, baseObjectId: null }),
      }),
    );
    await expect(
      tool.execute({
        extId: 'X',
        fields: [{ type: 'text', key: 'F_X', caption: 'X' }],
      }),
    ).rejects.toThrow(/不是 BOS 扩展/);
  });

  it('builds DecimalField with default scale/precision', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'decimal', key: 'F_PAIJ_Amt', caption: '金额' }],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      type: 'DecimalField',
      fieldScale: 2,
      fieldPrecision: 23,
    });
  });

  it('passes through agent-supplied scale/precision per field', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'amount', key: 'F_PAIJ_Amt', caption: '金额', fieldScale: 4, fieldPrecision: 28 },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      type: 'AmountField',
      fieldScale: 4,
      fieldPrecision: 28,
    });
  });

  it('qty type requires controlFieldKey', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [{ type: 'qty', key: 'F_X', caption: 'X' }],
      }),
    ).rejects.toThrow(/controlFieldKey/);
  });

  it('base_data resolves friendly FormId to GUID via connector lookup', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        {
          type: 'base_data',
          key: 'F_PAIJ_Cust',
          caption: '客户',
          refBaseDataObjectKey: 'BD_Customer',
        },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    // The friendly FormId must NOT pass through to LookUpObjectID — runtime
    // BOS would reject that with "未正确配置指向的基础资料". Should be the GUID.
    expect(req.addFields![0]).toMatchObject({
      type: 'BaseDataField',
      lookUpObjectId: FAKE_LOOKUP_GUID.bd_customer,
    });
  });

  it('base_data lookup is case-insensitive (BD_CUSTOMER == BD_Customer)', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        {
          type: 'base_data',
          key: 'F_X',
          caption: 'x',
          refBaseDataObjectKey: 'BD_CUSTOMER',
        },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      lookUpObjectId: FAKE_LOOKUP_GUID.bd_customer,
    });
  });

  it('base_data with unknown FormId throws helpful error', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [
          {
            type: 'base_data',
            key: 'F_X',
            caption: 'x',
            refBaseDataObjectKey: 'BD_DOES_NOT_EXIST',
          },
        ],
      }),
    ).rejects.toThrow(/找不到名为 "BD_DOES_NOT_EXIST"/);
  });

  it('unit defaults to BD_UNIT lookup-class GUID + UnitTypeKey="1"', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'unit', key: 'F_PAIJ_Unit', caption: '计量单位' }],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      type: 'UnitField',
      key: 'F_PAIJ_Unit',
      lookUpObjectId: FAKE_LOOKUP_GUID.bd_unit,
      unitTypeKey: '1',
    });
  });

  it('combo resolves enumTypeName → GUID via connector cache (matches captured wire format)', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'combo', key: 'F_PAIJ_Combo', caption: '下拉', enumTypeName: '审核状态' },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      type: 'ComboField',
      key: 'F_PAIJ_Combo',
      enumTypeId: FAKE_ENUM_GUID['审核状态'],
    });
    // Appearance should also be ComboField type.
    expect(req.addAppearances![0]).toMatchObject({
      type: 'ComboField',
      key: 'F_PAIJ_Combo',
    });
  });

  it('combo lookup is case-insensitive for English enum names', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'combo', key: 'F_X', caption: 'x', enumTypeName: 'OPENDEPLOY_TEST_ENUM' },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      enumTypeId: FAKE_ENUM_GUID['opendeploy_test_enum'],
    });
  });

  it('combo without enumTypeName throws helpful error', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [{ type: 'combo', key: 'F_X', caption: 'x' }],
      }),
    ).rejects.toThrow(/combo 字段必须指定 enumTypeName/);
  });

  it('combo with unknown enum name throws clear error', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [
          { type: 'combo', key: 'F_X', caption: 'x', enumTypeName: '不存在的枚举名' },
        ],
      }),
    ).rejects.toThrow(/找不到名为 "不存在的枚举名"/);
  });

  it('unit accepts agent-supplied alternate basedata + unitTypeKey', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        {
          type: 'unit',
          key: 'F_PAIJ_Unit2',
          caption: '其它单位',
          refBaseDataObjectKey: 'BD_UnitGroup',
          unitTypeKey: '2',
        },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      type: 'UnitField',
      lookUpObjectId: FAKE_LOOKUP_GUID.bd_unitgroup,
      unitTypeKey: '2',
    });
  });

  it('base_property requires sourceField', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [{ type: 'base_property', key: 'F_X', caption: 'X' }],
      }),
    ).rejects.toThrow(/sourceField/);
  });

  it('base_property maps sourceField → controlFieldKey on the BasePropertyField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        {
          type: 'base_property',
          key: 'F_PAIJ_CustName',
          caption: '客户名',
          sourceField: 'FCustId',
          srcDisplayFieldName: 'FName',
        },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      type: 'BasePropertyField',
      controlFieldKey: 'FCustId',
      srcDisplayFieldName: 'FName',
    });
  });

  it('rejects unknown type', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [{ type: 'fake_type', key: 'F_X', caption: 'X' }],
      }),
    ).rejects.toThrow(/不支持的字段类型/);
  });

  it('agent-supplied position overrides auto-placement', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_X', caption: 'X', top: 200, left: 50, width: 400 },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addAppearances![0]).toMatchObject({ left: 50, top: 200, width: 400 });
  });

  it('auto-places batch as a vertical column past parent maxRight', async () => {
    // Parent has two fields in FTAB_P0 ending at left+width = 200+300 = 500
    // and 600+280 = 880. Expected: new fields start at left = 880+20 = 900.
    const parentXml = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TextFieldAppearance><Container>FTAB_P0</Container><Left>200</Left><Top>10</Top><Width>300</Width></TextFieldAppearance>
        <BaseDataFieldAppearance><Container>FTAB_P0</Container><Left>600</Left><Top>40</Top><Width>280</Width></BaseDataFieldAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) => (id === EXT_ID ? EMPTY_EXT_XML : parentXml),
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_A', caption: 'A' },
        { type: 'int', key: 'F_B', caption: 'B' },
        { type: 'date', key: 'F_C', caption: 'C' },
      ],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addAppearances).toHaveLength(3);
    // All three on the same column (left=900) and stacking 28px apart from top=0.
    expect(req.addAppearances![0]).toMatchObject({ left: 900, top: 0 });
    expect(req.addAppearances![1]).toMatchObject({ left: 900, top: 28 });
    expect(req.addAppearances![2]).toMatchObject({ left: 900, top: 56 });
  });

  it('ignores non-field appearance bounding boxes (region / sub-head / tab control)', async () => {
    // SubHeadEntityAppearance + RegionAppearance carry container-wide widths;
    // they must NOT inflate maxRight. Real fields end at 600+280=880.
    const parentXml = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <SubHeadEntityAppearance><Container>FTAB_P0</Container><Left>0</Left><Top>0</Top><Width>1500</Width></SubHeadEntityAppearance>
        <TextFieldAppearance><Container>FTAB_P0</Container><Left>600</Left><Top>0</Top><Width>280</Width></TextFieldAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) => (id === EXT_ID ? EMPTY_EXT_XML : parentXml),
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'text', key: 'F_X', caption: 'X' }],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    // Should hug the field's right edge (880+20), NOT the sub-head's (1500+20).
    expect(req.addAppearances![0]).toMatchObject({ left: 900, top: 0 });
  });

  it('falls back to left=1100 when parent has no fields in target container', async () => {
    // Parent has no head-tab appearances at all (e.g. raw skeleton form).
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'text', key: 'F_X', caption: 'X' }],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addAppearances![0]).toMatchObject({ left: 1100, top: 0 });
  });

  it('stacks new fields below existing extension fields in same container', async () => {
    // Extension already has one field at top=84; next batch should start at 112.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <TextField ElementType="1"><Key>F_OLD</Key><Name>旧</Name><Id>old1</Id></TextField>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TextFieldAppearance><Container>FTAB_P0</Container><Left>1100</Left><Top>84</Top><Width>280</Width></TextFieldAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? populatedExtXml : PARENT_LAYOUT_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'text', key: 'F_NEW', caption: '新' }],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addAppearances![0]).toMatchObject({ top: 112 });
  });

  it('surfaces server-side rejection as ok=false with attempted field keys', async () => {
    mockedSave.mockResolvedValue({
      isSuccess: false,
      funcResult: false,
      messageTitle: '校验失败',
      messageDetail: '字段 key 已存在',
    });
    const { tool } = await findAddFields();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        fields: [
          { type: 'text', key: 'F_DUP', caption: 'X' },
          { type: 'int', key: 'F_OK', caption: 'Y' },
        ],
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.messageDetail).toBe('字段 key 已存在');
    expect(out.attemptedFields).toEqual(['F_DUP', 'F_OK']);
  });
});

describe('kingdee_register_python_plugins', () => {
  const EXT_ID = 'ee0011223344556677889900aabbccdd';
  const EXTENSION_OBJECT: ObjectMeta = {
    id: EXT_ID,
    name: '信用额度预警',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: 'SAL_SaleOrder',
    isTemplate: false,
    modifyDate: null,
  };

  const PARENT_LAYOUT_XML = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;
  const EMPTY_EXT_XML = `<FormMetadata><BusinessInfo><BusinessInfo><Elements><Form><Id>${EXT_ID}</Id></Form></Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

  const findPluginTool = async (
    connector?: K3CloudConnector,
    session = makeSessionMgr(),
  ) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c =
      connector ??
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? EMPTY_EXT_XML : PARENT_LAYOUT_XML,
      });
    const tools = await buildBosRpcTools(c, 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'kingdee_register_python_plugins');
    if (!tool) throw new Error('kingdee_register_python_plugins not in tool list');
    return { tool };
  };

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it('writes one plugin in a single saveExtension call', async () => {
    const { tool } = await findPluginTool();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        plugins: [
          {
            className: 'credit_warn',
            pyBody:
              '#stub plugin\nfrom Kingdee.BOS.Core.DynamicForm.PlugIn import AbstractDynamicFormPlugIn',
          },
        ],
      }),
    );

    expect(out.ok).toBe(true);
    expect(out.addedCount).toBe(1);
    expect(out.plugins[0].className).toBe('credit_warn');

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.isNew).toBe(false);
    expect(req.extension.formId).toBe(EXT_ID);
    expect(req.extension.baseObjectId).toBe('SAL_SaleOrder');
    expect(req.layoutInfoOid).toBe(SAL_LAYOUT_OID);
    expect(req.addPlugins).toHaveLength(1);
    expect(req.addPlugins![0]).toEqual({
      className: 'credit_warn',
      type: 'python',
      pyScript:
        '#stub plugin\nfrom Kingdee.BOS.Core.DynamicForm.PlugIn import AbstractDynamicFormPlugIn',
    });
    expect(req.addFields).toBeUndefined();
    expect(req.addAppearances).toBeUndefined();
  });

  it('writes multiple plugins in ONE saveExtension call (the bug fix)', async () => {
    const { tool } = await findPluginTool();
    await tool.execute({
      extId: EXT_ID,
      plugins: [
        { className: 'first', pyBody: '#a' },
        { className: 'second', pyBody: '#b' },
      ],
    });
    expect(mockedSave).toHaveBeenCalledTimes(1);
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addPlugins).toHaveLength(2);
    expect(req.addPlugins!.map((p) => p.className)).toEqual(['first', 'second']);
  });

  it('reads extension FKERNELXML and forwards existing chunks (read-merge)', async () => {
    const existingFieldXml =
      '<TextField ElementType="1" ElementStyle="0"><Key>F_OLD</Key><Name>旧</Name></TextField>';
    const existingPluginXml =
      '<PlugIn ElementType="0" ElementStyle="0"><ClassName>old_plug</ClassName><PlugInType>1</PlugInType><PyScript><![CDATA[#old]]></PyScript></PlugIn>';
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>${EXT_ID}</Id><FormPlugins>${existingPluginXml}</FormPlugins></Form>
      ${existingFieldXml}
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const { tool } = await findPluginTool(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? populatedExtXml : PARENT_LAYOUT_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      plugins: [{ className: 'new_plug', pyBody: '#new' }],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingFieldsRaw).toEqual([existingFieldXml]);
    expect(req.existingPluginsRaw?.[0]).toContain('<ClassName>old_plug</ClassName>');
    expect(req.existingPluginsRaw?.[0]).toContain('<![CDATA[#old]]>');
    // New plugin still in addPlugins (separate from existing).
    expect(req.addPlugins).toHaveLength(1);
    expect(req.addPlugins![0].className).toBe('new_plug');
  });

  it('rejects empty / missing required args', async () => {
    const { tool } = await findPluginTool();
    await expect(
      tool.execute({ plugins: [{ className: 'x', pyBody: '#x' }] }),
    ).rejects.toThrow(/extId/);
    await expect(
      tool.execute({ extId: EXT_ID, plugins: [] }),
    ).rejects.toThrow(/plugins/);
    await expect(
      tool.execute({ extId: EXT_ID, plugins: [{ pyBody: '#x' }] }),
    ).rejects.toThrow(/className/);
    await expect(
      tool.execute({ extId: EXT_ID, plugins: [{ className: 'x', pyBody: '   ' }] }),
    ).rejects.toThrow(/pyBody/);
  });

  it('rejects className with disallowed characters', async () => {
    const { tool } = await findPluginTool();
    await expect(
      tool.execute({
        extId: EXT_ID,
        plugins: [{ className: 'bad-name', pyBody: '#x' }],
      }),
    ).rejects.toThrow(/不合法/);
    await expect(
      tool.execute({
        extId: EXT_ID,
        plugins: [{ className: 'with space', pyBody: '#x' }],
      }),
    ).rejects.toThrow(/不合法/);
  });

  it('rejects duplicate className within the batch', async () => {
    const { tool } = await findPluginTool();
    await expect(
      tool.execute({
        extId: EXT_ID,
        plugins: [
          { className: 'dup', pyBody: '#a' },
          { className: 'dup', pyBody: '#b' },
        ],
      }),
    ).rejects.toThrow(/重复.*dup/);
  });

  it('rejects when extId points to a non-extension', async () => {
    const { tool } = await findPluginTool(
      makeFakeConnector({
        getObject: async () => ({ ...SAL_PARENT_OBJECT, baseObjectId: null }),
      }),
    );
    await expect(
      tool.execute({
        extId: 'X',
        plugins: [{ className: 'x', pyBody: '#x' }],
      }),
    ).rejects.toThrow(/不是 BOS 扩展/);
  });

  it('surfaces server-side rejection as ok=false with attempted classNames', async () => {
    mockedSave.mockResolvedValue({
      isSuccess: false,
      funcResult: false,
      messageTitle: '保存失败',
      messageDetail: '同名插件已存在',
    });
    const { tool } = await findPluginTool();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        plugins: [
          { className: 'dup', pyBody: '#x' },
          { className: 'ok', pyBody: '#y' },
        ],
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.messageDetail).toBe('同名插件已存在');
    expect(out.attemptedClassNames).toEqual(['dup', 'ok']);
  });
});

describe('kingdee_create_enum_type', () => {
  const findCreateEnum = async (session = makeSessionMgr()) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'kingdee_create_enum_type')!;
    if (!tool) throw new Error('kingdee_create_enum_type not in tool list');
    return { tool };
  };

  beforeEach(() => {
    mockedSaveEnum.mockResolvedValue({
      ok: true,
      enumTypeId: '99999999-9999-9999-9999-999999999999',
      responseBody: '{"Id":"99999999-9999-9999-9999-999999999999"}',
    });
    mockedUpdateCache.mockResolvedValue(undefined);
  });

  it('forwards name + items to saveEnumObject and busts caches on success', async () => {
    const { tool } = await findCreateEnum();
    const out = JSON.parse(
      await tool.execute({
        name: '信用等级',
        items: [
          { value: 'A', caption: '优秀' },
          { value: 'B', caption: '良好' },
        ],
      }),
    );

    expect(out.ok).toBe(true);
    expect(out.name).toBe('信用等级');
    expect(out.itemCount).toBe(2);
    expect(out.enumTypeId).toBe('99999999-9999-9999-9999-999999999999');

    const params = mockedSaveEnum.mock.calls[0][1];
    expect(params.name).toBe('信用等级');
    expect(params.items).toHaveLength(2);
    expect(params.items[0]).toMatchObject({ value: 'A', caption: '优秀' });

    // Cache invalidation called.
    expect(mockedUpdateCache).toHaveBeenCalledWith(expect.anything(), '99999999-9999-9999-9999-999999999999');
  });

  it('rejects empty items array', async () => {
    const { tool } = await findCreateEnum();
    await expect(tool.execute({ name: 'X', items: [] })).rejects.toThrow(/items/);
  });

  it('rejects missing name', async () => {
    const { tool } = await findCreateEnum();
    await expect(tool.execute({ items: [{ value: 'A', caption: '甲' }] })).rejects.toThrow(/name/);
  });

  it('rejects items with empty value or caption', async () => {
    const { tool } = await findCreateEnum();
    await expect(
      tool.execute({ name: 'X', items: [{ value: '', caption: '甲' }] }),
    ).rejects.toThrow(/value/);
    await expect(
      tool.execute({ name: 'X', items: [{ value: 'A', caption: '' }] }),
    ).rejects.toThrow(/caption/);
  });

  it('rejects duplicate values within the batch', async () => {
    const { tool } = await findCreateEnum();
    await expect(
      tool.execute({
        name: 'X',
        items: [
          { value: 'A', caption: '甲' },
          { value: 'A', caption: '另一个甲' },
        ],
      }),
    ).rejects.toThrow(/重复.*A/);
  });

  it('surfaces server-side rejection as ok=false', async () => {
    mockedSaveEnum.mockResolvedValue({
      ok: false,
      enumTypeId: 'fake',
      responseBody: 'response_error: 名称已被使用',
    });
    const { tool } = await findCreateEnum();
    const out = JSON.parse(
      await tool.execute({ name: 'X', items: [{ value: 'A', caption: '甲' }] }),
    );
    expect(out.ok).toBe(false);
    expect(out.messageDetail).toContain('名称已被使用');
  });
});

describe('kingdee_delete_enum_type', () => {
  const findDeleteEnum = async (session = makeSessionMgr()) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'kingdee_delete_enum_type')!;
    if (!tool) throw new Error('kingdee_delete_enum_type not in tool list');
    return { tool };
  };

  beforeEach(() => {
    mockedRecycle.mockResolvedValue(true);
    mockedUpdateCache.mockResolvedValue(undefined);
  });

  it('calls AddEnumObjectToRecycle and reports ok on success', async () => {
    const { tool } = await findDeleteEnum();
    const out = JSON.parse(
      await tool.execute({ enumTypeId: '11111111-1111-1111-1111-111111111111' }),
    );
    expect(out.ok).toBe(true);
    expect(mockedRecycle).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-1111-1111-111111111111',
    );
    expect(mockedUpdateCache).toHaveBeenCalled();
  });

  it('reports ok=false when server refuses (preset enum etc.)', async () => {
    mockedRecycle.mockResolvedValue(false);
    const { tool } = await findDeleteEnum();
    const out = JSON.parse(
      await tool.execute({ enumTypeId: '22222222-2222-2222-2222-222222222222' }),
    );
    expect(out.ok).toBe(false);
    expect(out.messageDetail).toContain('服务端拒绝');
  });

  it('rejects missing enumTypeId', async () => {
    const { tool } = await findDeleteEnum();
    await expect(tool.execute({})).rejects.toThrow(/enumTypeId/);
  });
});
