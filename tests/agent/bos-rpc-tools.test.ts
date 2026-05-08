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
import type { ObjectMeta, ExtensionMeta } from '../../src/shared/erp-types';
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
    listExtensions: (parentFormId: string) => Promise<ExtensionMeta[]>;
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
    listExtensions: overrides.listExtensions ?? (async () => []),
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
  it('all tools have k3cloud_ prefix', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    const bad = tools.filter((t) => !t.definition.name.startsWith('k3cloud_'));
    expect(bad.map((t) => t.definition.name)).toEqual([]);
  });

  it('returns all write tools when project has bos creds', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    expect(tools.map((t) => t.definition.name).sort()).toEqual([
      'k3cloud_add_fields',
      'k3cloud_create_entry',
      'k3cloud_create_enum_type',
      'k3cloud_create_extension',
      'k3cloud_create_tab_control',
      'k3cloud_create_tab_page',
      'k3cloud_delete_entry',
      'k3cloud_delete_enum_type',
      'k3cloud_delete_extension',
      'k3cloud_delete_tab_control',
      'k3cloud_delete_tab_page',
      'k3cloud_register_python_plugins',
      'k3cloud_rename_entry',
      'k3cloud_rename_tab_control',
      'k3cloud_rename_tab_page',
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

describe('k3cloud_delete_extension', () => {
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
    const tool = tools.find((t) => t.definition.name === 'k3cloud_delete_extension')!;

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
    const tool = tools.find((t) => t.definition.name === 'k3cloud_delete_extension')!;

    const result = JSON.parse(await tool.execute({ extId: 'ghost' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('扩展不存在');
  });

  it('throws clear error when extId is missing or empty', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'k3cloud_delete_extension')!;

    await expect(tool.execute({})).rejects.toThrow(/extId/);
    await expect(tool.execute({ extId: '   ' })).rejects.toThrow(/extId/);
  });

  it('throws when project loses creds between build and execute', async () => {
    // Build phase sees creds...
    mockedGetProject.mockResolvedValueOnce(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'k3cloud_delete_extension')!;
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
    const tool = tools.find((t) => t.definition.name === 'k3cloud_delete_extension')!;

    await tool.execute({ extId: 'abc123' });

    expect(mockedDelete).toHaveBeenCalledWith(
      expect.anything(),
      'abc123',
      { devCode: 'CUSTOM_ISV' },
    );
  });
});

describe('k3cloud_create_extension', () => {
  const findCreate = async (connector = makeFakeConnector(), session = makeSessionMgr()) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(connector, 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_extension');
    if (!tool) throw new Error('k3cloud_create_extension not in tool list');
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

  // ── Single-layer-tree guard ─────────────────────────────────────────
  // Each parent (form / basedata / convert rule / ...) gets at most ONE
  // OpenDeploy-project extension. Creating a sibling is refused.

  it('refuses to create when parent has an existing extension with matching devCode', async () => {
    const existing: ExtensionMeta = {
      extId: 'aaaa1111aaaa1111aaaa1111aaaa1111',
      parentFormId: 'SAL_SaleOrder',
      name: '已有的销售订单扩展',
      developerCode: 'PAIJ', // === project devCode → reusable
      modifyDate: '2026-04-30T10:00:00Z',
    };
    const { tool } = await findCreate(
      makeFakeConnector({ listExtensions: async () => [existing] }),
    );

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '新扩展' }),
    );

    expect(out.ok).toBe(false);
    expect(out.reason).toBe('duplicate_extension');
    expect(out.existingExtId).toBe(existing.extId);
    expect(out.existingExtName).toBe(existing.name);
    expect(out.message).toMatch(/单层树/);
    expect(out.message).toMatch(/k3cloud_add_fields/);
    // Critical: NO RPC fired — guard short-circuits before saveExtension.
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('refuses to create when parent has an existing extension with developerCode=null (treated as ours)', async () => {
    // Memory `fuserid_not_required.md`: OpenDeploy-built extensions land
    // with FSUPPLIERNAME=null. The guard treats null === ours.
    const existing: ExtensionMeta = {
      extId: 'bbbb2222bbbb2222bbbb2222bbbb2222',
      parentFormId: 'SAL_SaleOrder',
      name: 'OpenDeploy 早期扩展',
      developerCode: null,
      modifyDate: '2026-04-25T08:00:00Z',
    };
    const { tool } = await findCreate(
      makeFakeConnector({ listExtensions: async () => [existing] }),
    );

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '新扩展' }),
    );

    expect(out.ok).toBe(false);
    expect(out.reason).toBe('duplicate_extension');
    expect(out.existingExtId).toBe(existing.extId);
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('allows creation when parent only has other-ISV extensions (developerCode mismatch)', async () => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
    const otherIsv: ExtensionMeta = {
      extId: 'cccc3333cccc3333cccc3333cccc3333',
      parentFormId: 'SAL_SaleOrder',
      name: '某第三方 ISV 的扩展',
      developerCode: 'OTHER_VENDOR',
      modifyDate: '2026-03-15T00:00:00Z',
    };
    const { tool } = await findCreate(
      makeFakeConnector({ listExtensions: async () => [otherIsv] }),
    );

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '我们的扩展' }),
    );

    expect(out.ok).toBe(true);
    expect(out.extId).toMatch(/^[a-f0-9]{32}$/);
    expect(mockedSave).toHaveBeenCalledTimes(1);
  });

  it('reports allReusableExtensions when parent has multiple — historical leftover', async () => {
    const a: ExtensionMeta = {
      extId: 'aaaa1111aaaa1111aaaa1111aaaa1111',
      parentFormId: 'SAL_SaleOrder',
      name: '扩展 A',
      developerCode: 'PAIJ',
      modifyDate: null,
    };
    const b: ExtensionMeta = {
      extId: 'bbbb2222bbbb2222bbbb2222bbbb2222',
      parentFormId: 'SAL_SaleOrder',
      name: '扩展 B',
      developerCode: null,
      modifyDate: null,
    };
    const { tool } = await findCreate(
      makeFakeConnector({ listExtensions: async () => [a, b] }),
    );

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_SaleOrder', extName: '又一个' }),
    );

    expect(out.ok).toBe(false);
    expect(out.allReusableExtensions).toHaveLength(2);
    expect(out.message).toMatch(/历史遗留|整理合并|2 个扩展/);
    expect(mockedSave).not.toHaveBeenCalled();
  });
});

describe('k3cloud_add_fields', () => {
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
    const tool = tools.find((t) => t.definition.name === 'k3cloud_add_fields');
    if (!tool) throw new Error('k3cloud_add_fields not in tool list');
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

  it('forwards existing entries / tabPages / tabControls / entryAppearances on add_fields (baseline-diff regression)', async () => {
    // Regression guard: SaveForIDE is a baseline diff; if add_fields builds
    // a SaveExtensionRequest that omits the existing entry/tab buckets, those
    // entities silently disappear on the next save (data loss).
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>${EXT_ID}</Id></Form>
      <EntryEntity><Key>F_OLD_ENTRY</Key><Seq>13</Seq><TableName>T</TableName></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <EntryEntityAppearance><Key>F_OLD_ENTRY</Key><Container>FTab1_OLD</Container></EntryEntityAppearance>
        <TabPageAppearance><Key>FTab1_OLD</Key><Container>FTab1</Container></TabPageAppearance>
        <TabControlAppearance><Key>F_OLD_TC</Key><Container>FSPLITECONTAINER~Panel2</Container></TabControlAppearance>
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
    expect(req.existingEntriesRaw?.[0]).toContain('F_OLD_ENTRY');
    expect(req.existingEntryAppearancesRaw?.[0]).toContain('F_OLD_ENTRY');
    expect(req.existingTabPagesRaw?.[0]).toContain('FTab1_OLD');
    expect(req.existingTabControlsRaw?.[0]).toContain('F_OLD_TC');
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

  // ─── Plan 5.14 — entry-field recognition ────────────────────────────────

  /** Parent XML with one entry (FSaleOrderEntry) — typical SAL_SaleOrder shape. */
  const PARENT_WITH_ENTRY_XML = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    <EntryEntity ElementType="35"><Name>明细信息</Name><TableName>T_SAL_ORDERENTRY</TableName><Key>FSaleOrderEntry</Key></EntryEntity>
  </Elements></BusinessInfo></BusinessInfo>
  <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;

  it('recognizes parent entry container → emits EntityKey + skips Container/Top/Left', async () => {
    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? EMPTY_EXT_XML : PARENT_WITH_ENTRY_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_PAIJ_EntryNote', caption: '明细备注', container: 'FSaleOrderEntry' },
      ],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0]).toMatchObject({
      type: 'TextField',
      key: 'F_PAIJ_EntryNote',
      entityKey: 'FSaleOrderEntry',
    });
    const ap = req.addAppearances![0];
    expect(ap.entityKey).toBe('FSaleOrderEntry');
    expect(ap.tabindex).toBe(1); // first entry-field, no existing fields
    // Critical: head-field-only properties must NOT be set on entry-field appearance.
    expect(ap.container).toBeUndefined();
    expect(ap.top).toBeUndefined();
    expect(ap.left).toBeUndefined();
    expect(ap.zOrderIndex).toBeUndefined();
  });

  it('recognizes extension-built entry container too (not just parent)', async () => {
    // Extension already created its own entry F_PAIJ_Entity_xyz; new field
    // should attach to it as an entry-field.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity ElementType="35"><Name>测试体</Name><TableName>PAIJ_t_Cust_Entry100050</TableName><Key>F_PAIJ_Entity_xyz</Key></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;

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
      fields: [
        { type: 'text', key: 'F_PAIJ_Note', caption: '备注', container: 'F_PAIJ_Entity_xyz' },
      ],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].entityKey).toBe('F_PAIJ_Entity_xyz');
    expect(req.addAppearances![0].entityKey).toBe('F_PAIJ_Entity_xyz');
  });

  it('continues Tabindex from existing entry-field max+1 within the same entry', async () => {
    // Extension already has 3 fields in FSaleOrderEntry with Tabindex 1/2/3.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TextFieldAppearance><Key>F_OLD1</Key><EntityKey>FSaleOrderEntry</EntityKey><Tabindex>1</Tabindex><Caption>旧1</Caption></TextFieldAppearance>
        <TextFieldAppearance><Key>F_OLD2</Key><EntityKey>FSaleOrderEntry</EntityKey><Tabindex>2</Tabindex><Caption>旧2</Caption></TextFieldAppearance>
        <TextFieldAppearance><Key>F_OLD3</Key><EntityKey>FSaleOrderEntry</EntityKey><Tabindex>3</Tabindex><Caption>旧3</Caption></TextFieldAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? populatedExtXml : PARENT_WITH_ENTRY_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_NEW_A', caption: '新A', container: 'FSaleOrderEntry' },
        { type: 'text', key: 'F_NEW_B', caption: '新B', container: 'FSaleOrderEntry' },
      ],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addAppearances![0].tabindex).toBe(4);
    expect(req.addAppearances![1].tabindex).toBe(5);
  });

  it('explicit user-supplied tabindex does not consume a counter slot (no auto-assign collision)', async () => {
    // Counter bug regression: when the agent passes an explicit tabindex for
    // one field, the auto-counter must not bump for it — otherwise the next
    // auto-assigned field skips a slot and possibly collides with the
    // user's explicit value seeded into the counter.
    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? EMPTY_EXT_XML : PARENT_WITH_ENTRY_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_AUTO1', caption: 'auto', container: 'FSaleOrderEntry' },
        { type: 'text', key: 'F_EXP', caption: 'explicit', container: 'FSaleOrderEntry', tabindex: 5 },
        { type: 'text', key: 'F_AUTO2', caption: 'auto', container: 'FSaleOrderEntry' },
      ],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    // Counter seeds at max(existingMax=0, explicitMax=5) + 1 = 6.
    // F_AUTO1 → 6, F_EXP keeps 5, F_AUTO2 → 7. No collisions.
    expect(req.addAppearances![0].tabindex).toBe(6);
    expect(req.addAppearances![1].tabindex).toBe(5);
    expect(req.addAppearances![2].tabindex).toBe(7);
  });

  it('Tabindex counters are independent per entry (each entry starts at 1)', async () => {
    // Two entries: FSaleOrderEntry already has Tabindex up to 5; new entry
    // F_PAIJ_Entity_xyz has none. Adding fields to both should respect each
    // counter independently.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity ElementType="35"><Name>测试体</Name><TableName>X</TableName><Key>F_PAIJ_Entity_xyz</Key></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TextFieldAppearance><Key>F_OLD1</Key><EntityKey>FSaleOrderEntry</EntityKey><Tabindex>5</Tabindex><Caption>旧</Caption></TextFieldAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? populatedExtXml : PARENT_WITH_ENTRY_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_A', caption: 'A', container: 'FSaleOrderEntry' },
        { type: 'text', key: 'F_B', caption: 'B', container: 'F_PAIJ_Entity_xyz' },
        { type: 'text', key: 'F_C', caption: 'C', container: 'FSaleOrderEntry' },
        { type: 'text', key: 'F_D', caption: 'D', container: 'F_PAIJ_Entity_xyz' },
      ],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addAppearances![0]).toMatchObject({ entityKey: 'FSaleOrderEntry', tabindex: 6 });
    expect(req.addAppearances![1]).toMatchObject({ entityKey: 'F_PAIJ_Entity_xyz', tabindex: 1 });
    expect(req.addAppearances![2]).toMatchObject({ entityKey: 'FSaleOrderEntry', tabindex: 7 });
    expect(req.addAppearances![3]).toMatchObject({ entityKey: 'F_PAIJ_Entity_xyz', tabindex: 2 });
  });

  it('head-field path unaffected when no entry container is touched', async () => {
    // Mixed batch — only entry-targeted field gets entity-field treatment;
    // head field uses placement engine + container as before.
    const { tool } = await findAddFields(
      makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? EMPTY_EXT_XML : PARENT_WITH_ENTRY_XML,
      }),
    );

    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'text', key: 'F_HEAD', caption: '头字段' }, // no container → defaults to FTAB_P0 (head)
        { type: 'text', key: 'F_ENTRY', caption: '体字段', container: 'FSaleOrderEntry' },
      ],
    });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    // Head field has container, no entityKey, full geometry.
    expect(req.addFields![0].entityKey).toBeUndefined();
    expect(req.addAppearances![0]).toMatchObject({ container: 'FTAB_P0' });
    expect(req.addAppearances![0].left).toBeGreaterThan(0);
    // Entry field has entityKey, no container/top/left.
    expect(req.addFields![1].entityKey).toBe('FSaleOrderEntry');
    expect(req.addAppearances![1].container).toBeUndefined();
    expect(req.addAppearances![1].left).toBeUndefined();
  });

  // ─── Plan 5.12.7 — property grid additions ─────────────────────────────

  it('forwards mustInput=true through to the BosFieldElement', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'text', key: 'F_PAIJ_Required', caption: '必录', mustInput: true }],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].mustInput).toBe(true);
  });

  it('omits mustInput from BosFieldElement when not passed (BOS default = 0)', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'text', key: 'F_PAIJ_Optional', caption: '可空' }],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].mustInput).toBeUndefined();
  });

  it('forwards orgFieldKey on a base_data field for multi-org enterprise edition', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        {
          type: 'base_data',
          key: 'F_PAIJ_OrgCust',
          caption: '组织客户',
          refBaseDataObjectKey: 'BD_Customer',
          orgFieldKey: 'FSaleOrgId',
        },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    const base = req.addFields![0] as Extract<typeof req.addFields[number], { type: 'BaseDataField' }>;
    expect(base.type).toBe('BaseDataField');
    expect(base.orgFieldKey).toBe('FSaleOrgId');
  });

  it('rejects orgFieldKey on non-base_data field types', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [
          { type: 'text', key: 'F_PAIJ_Bad', caption: 'X', orgFieldKey: 'FSaleOrgId' },
        ],
      }),
    ).rejects.toThrow(/orgFieldKey/);
  });

  it('translates string defaultValue into literal DefValue for TextField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [{ type: 'text', key: 'F_PAIJ_Memo', caption: '备注', defaultValue: 'TEST' }],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].defValue).toEqual({ kind: 'literal', value: 'TEST' });
  });

  it('translates string defaultValue into literal DefValue for ComboField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        {
          type: 'combo',
          key: 'F_PAIJ_Status',
          caption: '状态',
          enumTypeName: '审核状态',
          defaultValue: 'A',
        },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].defValue).toEqual({ kind: 'literal', value: 'A' });
  });

  it('translates boolean defaultValue into capitalized True/False literal for CheckBoxField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'checkbox', key: 'F_PAIJ_FlagOn', caption: '启用', defaultValue: true },
        { type: 'checkbox', key: 'F_PAIJ_FlagOff', caption: '禁用', defaultValue: false },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].defValue).toEqual({ kind: 'literal', value: 'True' });
    expect(req.addFields![1].defValue).toEqual({ kind: 'literal', value: 'False' });
  });

  it('translates numeric defaultValue into GetNumeric function for DecimalField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'decimal', key: 'F_PAIJ_Limit', caption: '上限', defaultValue: 66.66 },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].defValue).toEqual({
      kind: 'function',
      functionId: 14,
      functionName: 'GetNumeric',
      value: '66.66',
    });
  });

  it('translates "today" defaultValue into GetDate with @CurrentDate Parameter for DateField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'date', key: 'F_PAIJ_When', caption: '日期', defaultValue: 'today' },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].defValue).toEqual({
      kind: 'function',
      functionId: 1,
      functionName: 'GetDate',
      parameter: 'yyyy-MM-dd,@CurrentDate',
    });
  });

  it('translates fixed-date defaultValue into GetDate with literal Parameter for DateField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        { type: 'date', key: 'F_PAIJ_When', caption: '日期', defaultValue: '2026-01-01' },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].defValue).toEqual({
      kind: 'function',
      functionId: 1,
      functionName: 'GetDate',
      parameter: 'yyyy-MM-dd,2026-01-01',
    });
  });

  it('translates FNumber defaultValue into GetBaseData function for BaseDataField', async () => {
    const { tool } = await findAddFields();
    await tool.execute({
      extId: EXT_ID,
      fields: [
        {
          type: 'base_data',
          key: 'F_PAIJ_DefCust',
          caption: '默认客户',
          refBaseDataObjectKey: 'BD_Customer',
          defaultValue: '01',
        },
      ],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addFields![0].defValue).toEqual({
      kind: 'function',
      functionId: 15,
      functionName: 'GetBaseData',
      value: '01',
    });
  });

  it('rejects defaultValue on a base_property field type', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [
          {
            type: 'base_property',
            key: 'F_PAIJ_PropX',
            caption: 'X',
            sourceField: 'FCustId',
            defaultValue: 'whatever',
          },
        ],
      }),
    ).rejects.toThrow(/defaultValue/);
  });

  it('rejects non-numeric defaultValue on a numeric field', async () => {
    const { tool } = await findAddFields();
    await expect(
      tool.execute({
        extId: EXT_ID,
        fields: [
          { type: 'decimal', key: 'F_PAIJ_Bad', caption: 'X', defaultValue: 'not-a-number' },
        ],
      }),
    ).rejects.toThrow(/defaultValue/);
  });

  // ── warnings[] channel — surface dropped inputs ────────────────────
  // Memory followup_tool_feedback_warnings_on_dropped_inputs.

  it('happy path emits NO warnings field when input is clean', async () => {
    const { tool } = await findAddFields();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        fields: [{ type: 'text', key: 'F_PAIJ_Note', caption: '备注' }],
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.warnings).toBeUndefined();
  });

  it('warnings: surfaces unknown top-level key + unknown field key', async () => {
    const { tool } = await findAddFields();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        fields: [
          {
            type: 'text',
            key: 'F_PAIJ_Note',
            caption: '备注',
            // Unknown — not in field schema. LLM hallucinated.
            mystery: 'value',
          },
        ],
        // Unknown top-level — not extId / fields / layoutInfoOid.
        bogusTop: 1,
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.warnings).toBeDefined();
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/未知顶层参数 bogusTop/),
        expect.stringMatching(/fields\[0\]\.mystery/),
      ]),
    );
  });

  it('warnings: surfaces type mismatch on numeric prop (string passed)', async () => {
    const { tool } = await findAddFields();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        fields: [
          {
            type: 'decimal',
            key: 'F_PAIJ_X',
            caption: 'X',
            // schema says number; LLM passed a numeric string — coerced
            // (since Number("4") === 4) but warns about the mismatch.
            fieldScale: '4' as unknown as number,
          },
        ],
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fields\[0\]\.fieldScale.*强转为 4/),
      ]),
    );
  });

  it('warnings: numeric prop with non-numeric string is dropped (NaN)', async () => {
    const { tool } = await findAddFields();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        fields: [
          {
            type: 'text',
            key: 'F_PAIJ_Note',
            caption: '备注',
            top: 'left-side' as unknown as number,
          },
        ],
      }),
    );
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fields\[0\]\.top.*期望 number.*"left-side"/),
      ]),
    );
  });

  it('warnings: mustInput non-boolean dropped', async () => {
    const { tool } = await findAddFields();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        fields: [
          {
            type: 'text',
            key: 'F_PAIJ_Note',
            caption: '备注',
            mustInput: 'true' as unknown as boolean,
          },
        ],
      }),
    );
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fields\[0\]\.mustInput.*期望 boolean.*"true"/),
      ]),
    );
  });
});

describe('k3cloud_register_python_plugins', () => {
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
    const tool = tools.find((t) => t.definition.name === 'k3cloud_register_python_plugins');
    if (!tool) throw new Error('k3cloud_register_python_plugins not in tool list');
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

  it('forwards existing entries / tabPages / tabControls (baseline-diff regression)', async () => {
    // Same data-loss bug guard as the add_fields test — register_python_plugins
    // must also re-include all existing entry/tab buckets or they vanish.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>${EXT_ID}</Id></Form>
      <EntryEntity><Key>F_OLD_ENTRY</Key><Seq>13</Seq><TableName>T</TableName></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <EntryEntityAppearance><Key>F_OLD_ENTRY</Key><Container>FTab1_OLD</Container></EntryEntityAppearance>
        <TabPageAppearance><Key>FTab1_OLD</Key><Container>FTab1</Container></TabPageAppearance>
        <TabControlAppearance><Key>F_OLD_TC</Key><Container>FSPLITECONTAINER~Panel2</Container></TabControlAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
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
      plugins: [{ className: 'p', pyBody: '#x' }],
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingEntriesRaw?.[0]).toContain('F_OLD_ENTRY');
    expect(req.existingEntryAppearancesRaw?.[0]).toContain('F_OLD_ENTRY');
    expect(req.existingTabPagesRaw?.[0]).toContain('FTab1_OLD');
    expect(req.existingTabControlsRaw?.[0]).toContain('F_OLD_TC');
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

describe('k3cloud_create_enum_type', () => {
  const findCreateEnum = async (session = makeSessionMgr()) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_enum_type')!;
    if (!tool) throw new Error('k3cloud_create_enum_type not in tool list');
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

describe('k3cloud_delete_enum_type', () => {
  const findDeleteEnum = async (session = makeSessionMgr()) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'k3cloud_delete_enum_type')!;
    if (!tool) throw new Error('k3cloud_delete_enum_type not in tool list');
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

// ─── Plan 5.14 — entry / tab toolchain ─────────────────────────────────

describe('k3cloud_create_tab_control', () => {
  const EXT_ID = 'ee0011223344556677889900aabbccdd';
  const EXTENSION_OBJECT: ObjectMeta = {
    id: EXT_ID,
    name: '测试扩展',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: 'SAL_SaleOrder',
    isTemplate: false,
    modifyDate: null,
  };
  const PARENT_LAYOUT_XML = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;
  const EMPTY_EXT_XML = `<FormMetadata><BusinessInfo><BusinessInfo><Elements><Form><Id>${EXT_ID}</Id></Form></Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

  const findTool = async (name: string) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c = makeFakeConnector({
      getObject: async (id: string) =>
        id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
      getKernelXml: async (id: string) =>
        id === EXT_ID ? EMPTY_EXT_XML : PARENT_LAYOUT_XML,
    });
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === name);
    if (!tool) throw new Error(`${name} not in tool list`);
    return tool;
  };

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it('creates 1 TabControl + 3 default TabPages with templated keys', async () => {
    const tool = await findTool('k3cloud_create_tab_control');
    const out = JSON.parse(await tool.execute({ extId: EXT_ID }));
    expect(out.ok).toBe(true);
    expect(out.tabControlKey).toMatch(/^F_PAIJ_Tab_[a-z0-9]{3}$/);
    expect(out.tabPageKeys).toHaveLength(3);

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addTabControls).toHaveLength(1);
    expect(req.addTabControls![0]).toMatchObject({
      key: out.tabControlKey,
      caption: '页签控件',
      container: 'FSPLITECONTAINER~Panel2',
    });
    expect(req.addTabPages).toHaveLength(3);
    // Each TabPage attached to the new TabControl with index suffix.
    for (let i = 0; i < 3; i++) {
      expect(req.addTabPages![i]).toMatchObject({
        container: out.tabControlKey,
        caption: '页签',
      });
      expect(req.addTabPages![i].key).toMatch(
        new RegExp(`^${out.tabControlKey}_P${i}_[a-z0-9]{3}$`),
      );
    }
  });

  it('honors custom caption + tabPageCount', async () => {
    const tool = await findTool('k3cloud_create_tab_control');
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, caption: '质检页签组', tabPageCount: 5 }),
    );
    expect(out.tabPageKeys).toHaveLength(5);
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addTabControls![0].caption).toBe('质检页签组');
    expect(req.addTabPages).toHaveLength(5);
  });

  it('rejects tabPageCount out of range', async () => {
    const tool = await findTool('k3cloud_create_tab_control');
    await expect(
      tool.execute({ extId: EXT_ID, tabPageCount: 0 }),
    ).rejects.toThrow(/tabPageCount/);
    await expect(
      tool.execute({ extId: EXT_ID, tabPageCount: 11 }),
    ).rejects.toThrow(/tabPageCount/);
  });

  it('rejects missing extId', async () => {
    const tool = await findTool('k3cloud_create_tab_control');
    await expect(tool.execute({})).rejects.toThrow(/extId/);
  });
});

describe('k3cloud_create_tab_page', () => {
  const EXT_ID = 'ee0011223344556677889900aabbccdd';
  const EXTENSION_OBJECT: ObjectMeta = {
    id: EXT_ID,
    name: '测试扩展',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: 'SAL_SaleOrder',
    isTemplate: false,
    modifyDate: null,
  };
  const PARENT_LAYOUT_XML = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;
  const EMPTY_EXT_XML = `<FormMetadata><BusinessInfo><BusinessInfo><Elements><Form><Id>${EXT_ID}</Id></Form></Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

  const findTool = async (extXmlOverride?: string) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c = makeFakeConnector({
      getObject: async (id: string) =>
        id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
      getKernelXml: async (id: string) =>
        id === EXT_ID ? extXmlOverride ?? EMPTY_EXT_XML : PARENT_LAYOUT_XML,
    });
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_tab_page');
    if (!tool) throw new Error('k3cloud_create_tab_page not in tool list');
    return tool;
  };

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it('defaults parent=FTab1 (entry-side) with FTab1_<DevCode>_P_<3char> key', async () => {
    const tool = await findTool();
    const out = JSON.parse(await tool.execute({ extId: EXT_ID }));
    expect(out.ok).toBe(true);
    expect(out.tabPageKey).toMatch(/^FTab1_PAIJ_P_[a-z0-9]{3}$/);

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addTabPages).toHaveLength(1);
    expect(req.addTabPages![0]).toMatchObject({
      key: out.tabPageKey,
      container: 'FTab1',
      caption: '页签',
    });
  });

  it('honors custom caption', async () => {
    const tool = await findTool();
    await tool.execute({ extId: EXT_ID, caption: '质检明细页' });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addTabPages![0].caption).toBe('质检明细页');
  });

  it('attaches to a self-built TabControl with <TC>_P<idx>_<3char> key', async () => {
    // Extension already has a self-built TabControl F_PAIJ_Tab_aaa with 0 pages —
    // new page should be P0.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>${EXT_ID}</Id></Form>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabControlAppearance><Key>F_PAIJ_Tab_aaa</Key><Container>FSPLITECONTAINER~Panel2</Container><Caption>页签控件</Caption></TabControlAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findTool(populatedExtXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, parentTabControlKey: 'F_PAIJ_Tab_aaa' }),
    );
    expect(out.tabPageKey).toMatch(/^F_PAIJ_Tab_aaa_P0_[a-z0-9]{3}$/);
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addTabPages![0].container).toBe('F_PAIJ_Tab_aaa');
  });

  it('appends to the right end via PageIndex + ZOrderIndex independently', async () => {
    // Parent SAL_SaleOrder has 8 native tabs under FTab1 — pageIndex 0..10
    // (with gaps from historical deletes) but zOrderIndex only 0..7. New tab
    // must land beyond *both* maxes to be visually last AND z-sort last.
    const parentXml = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabPageAppearance><Container>FTab1</Container><PageIndex>0</PageIndex><ZOrderIndex>0</ZOrderIndex><Key>FTab1_P0</Key></TabPageAppearance>
        <TabPageAppearance><Container>FTab1</Container><PageIndex>3</PageIndex><ZOrderIndex>3</ZOrderIndex><Key>FTab1_P3</Key></TabPageAppearance>
        <TabPageAppearance><Container>FTab1</Container><PageIndex>10</PageIndex><ZOrderIndex>7</ZOrderIndex><Key>FTab1_P</Key></TabPageAppearance>
        <TabPageAppearance><Container>FTab</Container><PageIndex>99</PageIndex><ZOrderIndex>99</ZOrderIndex><Key>FTab_P99</Key></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c = makeFakeConnector({
      getObject: async (id: string) =>
        id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
      getKernelXml: async (id: string) =>
        id === EXT_ID ? EMPTY_EXT_XML : parentXml,
    });
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_tab_page')!;
    const out = JSON.parse(await tool.execute({ extId: EXT_ID }));
    expect(out.pageIndex).toBe(11); // max parent FTab1.pageIndex (10) + 1
    expect(out.zOrderIndex).toBe(8); // max parent FTab1.zOrderIndex (7) + 1
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addTabPages![0].pageIndex).toBe(11);
    expect(req.addTabPages![0].zOrderIndex).toBe(8);
  });

  it('honors explicit zOrderIndex from caller (insert in front)', async () => {
    const parentXml = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabPageAppearance><Container>FTab1</Container><ZOrderIndex>5</ZOrderIndex><Key>FTab1_P5</Key></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c = makeFakeConnector({
      getObject: async (id: string) =>
        id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
      getKernelXml: async (id: string) =>
        id === EXT_ID ? EMPTY_EXT_XML : parentXml,
    });
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_tab_page')!;
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, zOrderIndex: 0 }),
    );
    expect(out.zOrderIndex).toBe(0);
  });

  it('counts both parent siblings and extension-built siblings', async () => {
    // Parent has FTab1 with ZOrderIndex 7; extension already added one at 8.
    const parentXml = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabPageAppearance><Container>FTab1</Container><ZOrderIndex>7</ZOrderIndex><Key>FTab1_P7</Key></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>${EXT_ID}</Id></Form>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabPageAppearance><Container>FTab1</Container><ZOrderIndex>8</ZOrderIndex><Key>FTab1_PAIJ_P_xnn</Key></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c = makeFakeConnector({
      getObject: async (id: string) =>
        id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
      getKernelXml: async (id: string) =>
        id === EXT_ID ? extXml : parentXml,
    });
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_tab_page')!;
    const out = JSON.parse(await tool.execute({ extId: EXT_ID }));
    expect(out.zOrderIndex).toBe(9);
  });

  it('next-index counter respects existing TabPages under same TabControl', async () => {
    // Existing 2 pages under F_PAIJ_Tab_aaa (P0 + P1) — new page should be P2.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>${EXT_ID}</Id></Form>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabControlAppearance><Key>F_PAIJ_Tab_aaa</Key><Container>FSPLITECONTAINER~Panel2</Container></TabControlAppearance>
        <TabPageAppearance><Key>F_PAIJ_Tab_aaa_P0_aaa</Key><Container>F_PAIJ_Tab_aaa</Container></TabPageAppearance>
        <TabPageAppearance><Key>F_PAIJ_Tab_aaa_P1_aaa</Key><Container>F_PAIJ_Tab_aaa</Container></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findTool(populatedExtXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, parentTabControlKey: 'F_PAIJ_Tab_aaa' }),
    );
    expect(out.tabPageKey).toMatch(/^F_PAIJ_Tab_aaa_P2_[a-z0-9]{3}$/);
  });
});

describe('k3cloud_create_entry', () => {
  const EXT_ID = 'ee0011223344556677889900aabbccdd';
  const EXTENSION_OBJECT: ObjectMeta = {
    id: EXT_ID,
    name: '测试扩展',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: 'SAL_SaleOrder',
    isTemplate: false,
    modifyDate: null,
  };
  /** Parent with 12 entries (Seq 1..12) — typical SAL_SaleOrder. */
  const PARENT_WITH_12_ENTRIES = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    <EntryEntity><Key>FE1</Key><Seq>1</Seq><TableName>T1</TableName></EntryEntity>
    <EntryEntity><Key>FE2</Key><Seq>2</Seq><TableName>T2</TableName></EntryEntity>
    <EntryEntity><Key>FE3</Key><Seq>3</Seq><TableName>T3</TableName></EntryEntity>
    <EntryEntity><Key>FE4</Key><Seq>4</Seq><TableName>T4</TableName></EntryEntity>
    <EntryEntity><Key>FE5</Key><Seq>5</Seq><TableName>T5</TableName></EntryEntity>
    <EntryEntity><Key>FE6</Key><Seq>6</Seq><TableName>T6</TableName></EntryEntity>
    <EntryEntity><Key>FE7</Key><Seq>7</Seq><TableName>T7</TableName></EntryEntity>
    <EntryEntity><Key>FE8</Key><Seq>8</Seq><TableName>T8</TableName></EntryEntity>
    <EntryEntity><Key>FE9</Key><Seq>9</Seq><TableName>T9</TableName></EntryEntity>
    <EntryEntity><Key>FE10</Key><Seq>10</Seq><TableName>T10</TableName></EntryEntity>
    <EntryEntity><Key>FE11</Key><Seq>11</Seq><TableName>T11</TableName></EntryEntity>
    <EntryEntity><Key>FE12</Key><Seq>12</Seq><TableName>T12</TableName></EntryEntity>
  </Elements></BusinessInfo></BusinessInfo>
  <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;
  const EMPTY_EXT_XML = `<FormMetadata><BusinessInfo><BusinessInfo><Elements><Form><Id>${EXT_ID}</Id></Form></Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

  const findCreateEntry = async (
    overrides: { extXml?: string; getNextSeq?: ReturnType<typeof vi.fn> } = {},
  ) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const getNextSeq =
      overrides.getNextSeq ?? vi.fn().mockResolvedValue(100050);
    const c = {
      ...makeFakeConnector({
        getObject: async (id: string) =>
          id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
        getKernelXml: async (id: string) =>
          id === EXT_ID ? overrides.extXml ?? EMPTY_EXT_XML : PARENT_WITH_12_ENTRIES,
      }),
      getNextSequenceInt32: getNextSeq,
    } as unknown as K3CloudConnector;
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_entry');
    if (!tool) throw new Error('k3cloud_create_entry not in tool list');
    return { tool, getNextSeq };
  };

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it('allocates int via GetSequenceInt32 + builds EntryEntity with conventional names', async () => {
    const { tool, getNextSeq } = await findCreateEntry();
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        name: '质检明细',
        parentTabPageKey: 'FTab1_PAIJ_P_xyz',
      }),
    );
    expect(getNextSeq).toHaveBeenCalledWith('t_BOS_CustEntry', 1);
    expect(out.ok).toBe(true);
    expect(out.entryName).toBe('PAIJ_Cust_Entry100050');
    expect(out.tableName).toBe('PAIJ_t_Cust_Entry100050');
    expect(out.entryKey).toMatch(/^F_PAIJ_Entity_[a-z0-9]{3}$/);
    expect(out.seq).toBe(13); // 12 parent + 0 ext + 1
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addEntries).toHaveLength(1);
    expect(req.addEntries![0]).toMatchObject({
      entryName: 'PAIJ_Cust_Entry100050',
      tableName: 'PAIJ_t_Cust_Entry100050',
      seq: 13,
      name: '质检明细',
    });
    expect(req.addEntryAppearances).toHaveLength(1);
    expect(req.addEntryAppearances![0]).toMatchObject({
      key: out.entryKey,
      caption: '质检明细',
      container: 'FTab1_PAIJ_P_xyz',
    });
  });

  it('Seq increments by 1 per existing extension entry', async () => {
    // Extension already has 2 entries (Seq 13, 14) → new entry Seq=15.
    const populatedExtXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity><Key>F_PAIJ_Entity_aaa</Key><Seq>13</Seq><TableName>X1</TableName></EntryEntity>
      <EntryEntity><Key>F_PAIJ_Entity_bbb</Key><Seq>14</Seq><TableName>X2</TableName></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;
    const { tool } = await findCreateEntry({ extXml: populatedExtXml });
    const out = JSON.parse(
      await tool.execute({
        extId: EXT_ID,
        name: 'X',
        parentTabPageKey: 'FTab1_PAIJ_P_xyz',
      }),
    );
    expect(out.seq).toBe(15); // 12 + 2 + 1
  });

  it('rejects missing name / parentTabPageKey', async () => {
    const { tool } = await findCreateEntry();
    await expect(
      tool.execute({ extId: EXT_ID, parentTabPageKey: 'X' }),
    ).rejects.toThrow(/name/);
    await expect(
      tool.execute({ extId: EXT_ID, name: 'X' }),
    ).rejects.toThrow(/parentTabPageKey/);
  });

  // ─── Plan 5.12.7 — property grid additions ─────────────────────────────

  it('defaults isShowSeq=true on the appearance when not specified', async () => {
    const { tool } = await findCreateEntry();
    await tool.execute({
      extId: EXT_ID,
      name: 'X',
      parentTabPageKey: 'FTab1_PAIJ_P_xyz',
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addEntryAppearances![0].isShowSeq).toBe(true);
  });

  it('honors explicit isShowSeq=false', async () => {
    const { tool } = await findCreateEntry();
    await tool.execute({
      extId: EXT_ID,
      name: 'X',
      parentTabPageKey: 'FTab1_PAIJ_P_xyz',
      isShowSeq: false,
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addEntryAppearances![0].isShowSeq).toBe(false);
  });

  it('forwards mustInput=true onto the EntryEntity element', async () => {
    const { tool } = await findCreateEntry();
    await tool.execute({
      extId: EXT_ID,
      name: 'X',
      parentTabPageKey: 'FTab1_PAIJ_P_xyz',
      mustInput: true,
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addEntries![0].mustInput).toBe(true);
  });

  it('omits mustInput on EntryEntity when not specified', async () => {
    const { tool } = await findCreateEntry();
    await tool.execute({
      extId: EXT_ID,
      name: 'X',
      parentTabPageKey: 'FTab1_PAIJ_P_xyz',
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.addEntries![0].mustInput).toBeUndefined();
  });
});

describe('k3cloud_delete_entry / k3cloud_delete_tab_page / k3cloud_delete_tab_control', () => {
  const EXT_ID = 'ee0011223344556677889900aabbccdd';
  const EXTENSION_OBJECT: ObjectMeta = {
    id: EXT_ID,
    name: '测试扩展',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: 'SAL_SaleOrder',
    isTemplate: false,
    modifyDate: null,
  };
  const PARENT_LAYOUT_XML = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;

  const findDeleteTool = async (name: string, extXml: string) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c = makeFakeConnector({
      getObject: async (id: string) =>
        id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
      getKernelXml: async (id: string) =>
        id === EXT_ID ? extXml : PARENT_LAYOUT_XML,
    });
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === name);
    if (!tool) throw new Error(`${name} not in tool list`);
    return tool;
  };

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it('delete_entry removes EntryEntity + EntryEntityAppearance + cascading entry-fields', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity><Key>F_PAIJ_Entity_xxx</Key><Seq>13</Seq><TableName>T</TableName><Name>测试</Name></EntryEntity>
      <TextField ElementType="1"><Key>F_FIELD_IN_ENTRY</Key><EntityKey>F_PAIJ_Entity_xxx</EntityKey><PropertyName>F_FIELD_IN_ENTRY</PropertyName><Name>X</Name><Id>i1</Id></TextField>
      <TextField ElementType="1"><Key>F_HEAD_FIELD</Key><PropertyName>F_HEAD_FIELD</PropertyName><Name>Y</Name><Id>i2</Id></TextField>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <EntryEntityAppearance><Key>F_PAIJ_Entity_xxx</Key><Container>FTab1_PAIJ_P_xyz</Container><Caption>测试</Caption></EntryEntityAppearance>
        <TextFieldAppearance><Key>F_FIELD_IN_ENTRY</Key><EntityKey>F_PAIJ_Entity_xxx</EntityKey><Tabindex>1</Tabindex></TextFieldAppearance>
        <TextFieldAppearance><Key>F_HEAD_FIELD</Key><Container>FTAB_P0</Container><Tabindex>9000</Tabindex></TextFieldAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const tool = await findDeleteTool('k3cloud_delete_entry', extXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, entryKey: 'F_PAIJ_Entity_xxx' }),
    );
    expect(out.ok).toBe(true);

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    // Entry + entry-field gone from re-emitted baseline; head field stays.
    expect(req.existingEntriesRaw ?? []).toHaveLength(0);
    expect(req.existingEntryAppearancesRaw ?? []).toHaveLength(0);
    expect(req.existingFieldsRaw?.some((s) => s.includes('F_HEAD_FIELD'))).toBe(true);
    expect(req.existingFieldsRaw?.some((s) => s.includes('F_FIELD_IN_ENTRY'))).toBe(false);
    expect(req.existingAppearancesRaw?.some((s) => s.includes('F_HEAD_FIELD'))).toBe(true);
    expect(req.existingAppearancesRaw?.some((s) => s.includes('F_FIELD_IN_ENTRY'))).toBe(false);
  });

  it('delete_tab_page refuses when an entry is still attached', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity><Key>F_PAIJ_Entity_aaa</Key><Seq>13</Seq><TableName>T</TableName></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabPageAppearance><Key>FTab1_PAIJ_P_xyz</Key><Container>FTab1</Container><Caption>p</Caption></TabPageAppearance>
        <EntryEntityAppearance><Key>F_PAIJ_Entity_aaa</Key><Container>FTab1_PAIJ_P_xyz</Container></EntryEntityAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findDeleteTool('k3cloud_delete_tab_page', extXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, tabPageKey: 'FTab1_PAIJ_P_xyz' }),
    );
    expect(out.ok).toBe(false);
    expect(out.attachedEntries).toContain('F_PAIJ_Entity_aaa');
    // Should NOT have called saveExtension when refusing.
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('delete_tab_page succeeds when no entry is attached', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabPageAppearance><Key>FTab1_PAIJ_P_xyz</Key><Container>FTab1</Container><Caption>p</Caption></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findDeleteTool('k3cloud_delete_tab_page', extXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, tabPageKey: 'FTab1_PAIJ_P_xyz' }),
    );
    expect(out.ok).toBe(true);
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingTabPagesRaw ?? []).toHaveLength(0);
  });

  it('delete_tab_control cascades child TabPages, refuses when any page has entry', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity><Key>F_PAIJ_Entity_a</Key></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabControlAppearance><Key>F_PAIJ_Tab_aaa</Key><Container>FSPLITECONTAINER~Panel2</Container></TabControlAppearance>
        <TabPageAppearance><Key>F_PAIJ_Tab_aaa_P0_aaa</Key><Container>F_PAIJ_Tab_aaa</Container></TabPageAppearance>
        <EntryEntityAppearance><Key>F_PAIJ_Entity_a</Key><Container>F_PAIJ_Tab_aaa_P0_aaa</Container></EntryEntityAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findDeleteTool('k3cloud_delete_tab_control', extXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, tabControlKey: 'F_PAIJ_Tab_aaa' }),
    );
    expect(out.ok).toBe(false);
    expect(out.attachedEntries).toContain('F_PAIJ_Entity_a');
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('delete_tab_control succeeds and removes child TabPages too', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabControlAppearance><Key>F_PAIJ_Tab_aaa</Key><Container>FSPLITECONTAINER~Panel2</Container></TabControlAppearance>
        <TabPageAppearance><Key>F_PAIJ_Tab_aaa_P0_aaa</Key><Container>F_PAIJ_Tab_aaa</Container></TabPageAppearance>
        <TabPageAppearance><Key>F_PAIJ_Tab_aaa_P1_aaa</Key><Container>F_PAIJ_Tab_aaa</Container></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findDeleteTool('k3cloud_delete_tab_control', extXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, tabControlKey: 'F_PAIJ_Tab_aaa' }),
    );
    expect(out.ok).toBe(true);
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingTabControlsRaw ?? []).toHaveLength(0);
    expect(req.existingTabPagesRaw ?? []).toHaveLength(0);
  });
});

describe('k3cloud_rename_entry / k3cloud_rename_tab_page / k3cloud_rename_tab_control', () => {
  const EXT_ID = 'ee0011223344556677889900aabbccdd';
  const EXTENSION_OBJECT: ObjectMeta = {
    id: EXT_ID,
    name: '测试扩展',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: 'SAL_SaleOrder',
    isTemplate: false,
    modifyDate: null,
  };
  const PARENT_LAYOUT_XML = `<FormMetadata><LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`;

  const findTool = async (name: string, extXml: string) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const c = makeFakeConnector({
      getObject: async (id: string) =>
        id === EXT_ID ? EXTENSION_OBJECT : SAL_PARENT_OBJECT,
      getKernelXml: async (id: string) =>
        id === EXT_ID ? extXml : PARENT_LAYOUT_XML,
    });
    const tools = await buildBosRpcTools(c, 'p1', makeSessionMgr());
    const tool = tools.find((t) => t.definition.name === name);
    if (!tool) throw new Error(`${name} not in tool list`);
    return tool;
  };

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it('rename_entry replaces both EntryEntity.Name and EntryEntityAppearance.Caption', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity><Key>F_PAIJ_Entity_x</Key><Seq>13</Seq><TableName>T</TableName><Name>旧名</Name></EntryEntity>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <EntryEntityAppearance><Key>F_PAIJ_Entity_x</Key><Container>FTab1_PAIJ_P_xyz</Container><Caption>旧名</Caption></EntryEntityAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findTool('k3cloud_rename_entry', extXml);
    const out = JSON.parse(
      await tool.execute({ extId: EXT_ID, entryKey: 'F_PAIJ_Entity_x', newName: '新名' }),
    );
    expect(out.ok).toBe(true);
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingEntriesRaw![0]).toContain('<Name>新名</Name>');
    expect(req.existingEntriesRaw![0]).not.toContain('<Name>旧名</Name>');
    expect(req.existingEntryAppearancesRaw![0]).toContain('<Caption>新名</Caption>');
    expect(req.existingEntryAppearancesRaw![0]).not.toContain('<Caption>旧名</Caption>');
  });

  it('rename_tab_page replaces only the matched TabPageAppearance.Caption', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabPageAppearance><Key>FTab1_PAIJ_P_a</Key><Container>FTab1</Container><Caption>旧A</Caption></TabPageAppearance>
        <TabPageAppearance><Key>FTab1_PAIJ_P_b</Key><Container>FTab1</Container><Caption>旧B</Caption></TabPageAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findTool('k3cloud_rename_tab_page', extXml);
    await tool.execute({ extId: EXT_ID, tabPageKey: 'FTab1_PAIJ_P_a', newCaption: '新A' });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    const aChunk = req.existingTabPagesRaw!.find((s) => s.includes('FTab1_PAIJ_P_a'))!;
    const bChunk = req.existingTabPagesRaw!.find((s) => s.includes('FTab1_PAIJ_P_b'))!;
    expect(aChunk).toContain('<Caption>新A</Caption>');
    expect(bChunk).toContain('<Caption>旧B</Caption>'); // unchanged
  });

  it('rename_tab_control replaces matched TabControlAppearance.Caption', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabControlAppearance><Key>F_PAIJ_Tab_aaa</Key><Container>FSPLITECONTAINER~Panel2</Container><Caption>旧</Caption></TabControlAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findTool('k3cloud_rename_tab_control', extXml);
    await tool.execute({ extId: EXT_ID, tabControlKey: 'F_PAIJ_Tab_aaa', newCaption: '新页签组' });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingTabControlsRaw![0]).toContain('<Caption>新页签组</Caption>');
  });

  it('XML-escapes special characters in the new caption', async () => {
    const extXml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo oid="${SAL_LAYOUT_OID}">
      <Appearances>
        <TabControlAppearance><Key>F_PAIJ_Tab_aaa</Key><Container>FSPLITECONTAINER~Panel2</Container><Caption>old</Caption></TabControlAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;
    const tool = await findTool('k3cloud_rename_tab_control', extXml);
    await tool.execute({
      extId: EXT_ID,
      tabControlKey: 'F_PAIJ_Tab_aaa',
      newCaption: 'A&B<C>',
    });
    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.existingTabControlsRaw![0]).toContain('<Caption>A&amp;B&lt;C&gt;</Caption>');
  });
});

describe('k3cloud_create_extension — parent FormId case normalization', () => {
  // K/3 父对象 FID 拼写不统一(SAL_SaleOrder 混合 / SAL_OUTSTOCK 全大写)。RPC 服务端 case-insensitive
  // 找父对象,但 BOS Designer 列扩展时严格按字符串匹配 FBASEOBJECTID,所以工具落库必须用
  // connector.getObject() 返回的 parent.id 作为 baseObjectId,而非 agent 输入的 raw 拼写。
  // 实证:2026-04-30 销售出库单扩展因 raw='SAL_OutStock' / canonical='SAL_OUTSTOCK' 在 Designer 不可见。
  const OUTSTOCK_LAYOUT_OID = 'fa50ddec-b1cf-43cb-a9be-dee3ce2bdb12';
  const OUTSTOCK_PARENT_OBJECT: ObjectMeta = {
    id: 'SAL_OUTSTOCK', // canonical 拼写,服务端真实 FID
    name: '销售出库单',
    modelTypeId: 100,
    subsystemId: '23',
    baseObjectId: null,
    isTemplate: false,
    modifyDate: null,
  };

  const findCreate = async (connector: K3CloudConnector, session = makeSessionMgr()) => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(connector, 'p1', session);
    const tool = tools.find((t) => t.definition.name === 'k3cloud_create_extension');
    if (!tool) throw new Error('k3cloud_create_extension not in tool list');
    return tool;
  };

  /**
   * Stable mock factory: 服务端 case-insensitive,任何拼写都返回 canonical 版本的 ObjectMeta。
   * 模拟真实 K/3 RPC 行为(getBusinessObjectMetaData 拿到的 FID 列就是规范拼写)。
   */
  const mixedCaseConnector = (): K3CloudConnector =>
    makeFakeConnector({
      getObject: async (_id: string) => OUTSTOCK_PARENT_OBJECT,
      getKernelXml: async (_id: string) =>
        `<FormMetadata><LayoutInfos><LayoutInfo oid="${OUTSTOCK_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`,
    });

  beforeEach(() => {
    mockedSave.mockResolvedValue({
      isSuccess: true,
      funcResult: true,
      messageTitle: null,
      messageDetail: null,
    });
  });

  it.each([
    ['SAL_OutStock'],   // PascalCase guess (LLM 历史训练数据常见)
    ['sal_outstock'],   // 全小写
    ['SAL_outstock'],
    ['SAL_OUTSTOCK '],  // 带尾部空格,trim 后是 canonical
  ])('writes canonical FBASEOBJECTID even when agent passes %s', async (raw) => {
    const tool = await findCreate(mixedCaseConnector());

    await tool.execute({ parentFormId: raw, extName: '测试' });

    const req = mockedSave.mock.calls[0][1] as SaveExtensionRequest;
    expect(req.extension.baseObjectId).toBe('SAL_OUTSTOCK');
  });

  it('returns canonical parentFormId in success response (not raw input)', async () => {
    const tool = await findCreate(mixedCaseConnector());

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_OutStock', extName: '测试' }),
    );

    expect(out.ok).toBe(true);
    expect(out.parentFormId).toBe('SAL_OUTSTOCK');
  });

  it('reminder explicitly tells agent the canonical spelling when input differs', async () => {
    const tool = await findCreate(mixedCaseConnector());

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_OutStock', extName: '测试' }),
    );

    expect(out.reminder).toContain('SAL_OutStock');     // 输入拼写
    expect(out.reminder).toContain('SAL_OUTSTOCK');     // 规范拼写
    expect(out.reminder).toMatch(/规范拼写/);
  });

  it('omits the case-hint noise when input already matches canonical', async () => {
    const tool = await findCreate(mixedCaseConnector());

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_OUTSTOCK', extName: '测试' }),
    );

    expect(out.reminder).not.toMatch(/规范拼写/);
    expect(out.reminder).not.toMatch(/你输入的父单据/);
  });

  it('uses canonical FormId when fetching FKERNELXML for layoutInfoOid auto-discovery', async () => {
    const getKernelXml = vi.fn(
      async (_id: string) =>
        `<FormMetadata><LayoutInfos><LayoutInfo oid="${OUTSTOCK_LAYOUT_OID}"></LayoutInfo></LayoutInfos></FormMetadata>`,
    );
    const tool = await findCreate(
      makeFakeConnector({
        getObject: async () => OUTSTOCK_PARENT_OBJECT,
        getKernelXml,
      }),
    );

    await tool.execute({ parentFormId: 'sal_outstock', extName: '测试' });

    expect(getKernelXml).toHaveBeenCalledTimes(1);
    expect(getKernelXml).toHaveBeenCalledWith('SAL_OUTSTOCK');
  });

  it('error path keeps raw input visible to surface user typo (no normalization on rejection)', async () => {
    mockedSave.mockResolvedValue({
      isSuccess: false,
      funcResult: false,
      messageTitle: '保存失败',
      messageDetail: 'something else',
    });
    const tool = await findCreate(mixedCaseConnector());

    const out = JSON.parse(
      await tool.execute({ parentFormId: 'SAL_OutStock', extName: '测试' }),
    );

    expect(out.ok).toBe(false);
    // 错误响应保留 raw 让用户看到自己输入的是什么(便于诊断 typo)
    expect(out.parentFormId).toBe('SAL_OutStock');
  });
});
