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

import { getProject } from '../../src/main/projects/store';
import { deleteExtension } from '../../src/main/erp/k3cloud/rpc/delete-extension';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import type { ObjectMeta } from '../../src/shared/erp-types';
import type { SaveExtensionRequest } from '../../src/main/erp/k3cloud/rpc/types';

const mockedGetProject = getProject as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = deleteExtension as unknown as ReturnType<typeof vi.fn>;
const mockedSave = saveExtension as unknown as ReturnType<typeof vi.fn>;

const SAL_LAYOUT_OID = 'bc952920-057d-4790-9c27-1134091eb298';

const SAL_PARENT_OBJECT: ObjectMeta = {
  id: 'SAL_SaleOrder',
  name: '销售订单',
  modelTypeId: 100,
  subsystemId: '23',
  isTemplate: false,
  modifyDate: null,
};

const makeFakeConnector = (
  overrides: Partial<{
    getObject: (id: string) => Promise<ObjectMeta | null>;
    getKernelXml: (id: string) => Promise<string | null>;
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
});

describe('buildBosRpcTools', () => {
  it('returns create + delete tools when project has bos creds', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    expect(tools.map((t) => t.definition.name).sort()).toEqual([
      'kingdee_create_extension',
      'kingdee_delete_extension',
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
