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

import { getProject } from '../../src/main/projects/store';
import { deleteExtension } from '../../src/main/erp/k3cloud/rpc/delete-extension';

const mockedGetProject = getProject as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = deleteExtension as unknown as ReturnType<typeof vi.fn>;

const makeFakeConnector = (): K3CloudConnector =>
  ({
    config: {
      server: 'localhost',
      database: 'AIS001',
      user: 'sa',
      password: 'x',
    },
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
});

describe('buildBosRpcTools', () => {
  it('returns delete tool when project has bos creds', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const tools = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    expect(tools.map((t) => t.definition.name)).toEqual(['kingdee_delete_extension']);
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
    const [tool] = await buildBosRpcTools(makeFakeConnector(), 'p1', sessionMgr);

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
    const [tool] = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());

    const result = JSON.parse(await tool.execute({ extId: 'ghost' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('扩展不存在');
  });

  it('throws clear error when extId is missing or empty', async () => {
    mockedGetProject.mockResolvedValue(makeProject(true));
    const [tool] = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());

    await expect(tool.execute({})).rejects.toThrow(/extId/);
    await expect(tool.execute({ extId: '   ' })).rejects.toThrow(/extId/);
  });

  it('throws when project loses creds between build and execute', async () => {
    // Build phase sees creds...
    mockedGetProject.mockResolvedValueOnce(makeProject(true));
    const [tool] = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());
    // ...but execute phase finds them gone.
    mockedGetProject.mockResolvedValueOnce(makeProject(false));

    await expect(tool.execute({ extId: 'abc123' })).rejects.toThrow(/未配置 BOS 写入凭据/);
  });

  it('uses devCode from project on the RPC call', async () => {
    const project = makeProject(true);
    project.bos!.devCode = 'CUSTOM_ISV';
    mockedGetProject.mockResolvedValue(project);
    mockedDelete.mockResolvedValue({ ok: true, responseBody: '' });
    const [tool] = await buildBosRpcTools(makeFakeConnector(), 'p1', makeSessionMgr());

    await tool.execute({ extId: 'abc123' });

    expect(mockedDelete).toHaveBeenCalledWith(
      expect.anything(),
      'abc123',
      { devCode: 'CUSTOM_ISV' },
    );
  });
});
