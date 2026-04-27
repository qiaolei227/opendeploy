import { describe, expect, it, vi } from 'vitest';
import {
  BosLoginFailedError,
  BosSessionManager,
  MissingBosCredentialsError,
} from '../../../src/main/erp/k3cloud/rpc/session-manager';
import type { KdSession } from '../../../src/main/erp/k3cloud/rpc/http-client';
import type { LoginResult, LoginCredentials } from '../../../src/main/erp/k3cloud/rpc/login';
import type { Project } from '../../../src/shared/erp-types';

const makeProject = (id: string, withBos = true): Project => ({
  id,
  name: `proj-${id}`,
  erpProvider: 'k3cloud',
  connection: {
    server: 'localhost',
    database: 'AIS_test',
    user: 'sa',
    password: 'sa',
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

const makeSuccessLogin = (): LoginResult => ({
  session: {
    baseUrl: 'http://localhost/k3cloud',
    aspNetSessionId: 'asp-1',
    kdServiceSessionId: 'kds-1',
  } as KdSession,
  isSuccess: true,
  userId: 100,
  userName: 'demo',
});

describe('BosSessionManager', () => {
  it('logs in once per project, caches session for subsequent calls', async () => {
    const loginFn = vi
      .fn<(c: LoginCredentials) => Promise<LoginResult>>()
      .mockResolvedValue(makeSuccessLogin());
    const getProjectFn = vi.fn().mockResolvedValue(makeProject('p1'));
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    const s1 = await mgr.getOrLogin('p1');
    const s2 = await mgr.getOrLogin('p1');

    expect(s1).toBe(s2);
    expect(loginFn).toHaveBeenCalledTimes(1);
  });

  it('passes BOS creds from project.bos into login()', async () => {
    const loginFn = vi
      .fn<(c: LoginCredentials) => Promise<LoginResult>>()
      .mockResolvedValue(makeSuccessLogin());
    const getProjectFn = vi.fn().mockResolvedValue(makeProject('p1'));
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    await mgr.getOrLogin('p1');

    expect(loginFn).toHaveBeenCalledWith({
      baseUrl: 'http://localhost/k3cloud',
      acctId: 'acct1',
      username: 'demo',
      password: '1qaz',
    });
  });

  it('throws MissingBosCredentialsError when project.bos is undefined', async () => {
    const loginFn = vi.fn<(c: LoginCredentials) => Promise<LoginResult>>();
    const getProjectFn = vi.fn().mockResolvedValue(makeProject('p1', false));
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    await expect(mgr.getOrLogin('p1')).rejects.toThrow(MissingBosCredentialsError);
    expect(loginFn).not.toHaveBeenCalled();
  });

  it('throws when project does not exist', async () => {
    const loginFn = vi.fn<(c: LoginCredentials) => Promise<LoginResult>>();
    const getProjectFn = vi.fn().mockResolvedValue(null);
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    await expect(mgr.getOrLogin('ghost')).rejects.toThrow(/project not found/);
  });

  it('throws BosLoginFailedError on login failure', async () => {
    const loginFn = vi.fn<(c: LoginCredentials) => Promise<LoginResult>>().mockResolvedValue({
      session: { baseUrl: 'http://localhost/k3cloud' } as KdSession,
      isSuccess: false,
      message: '用户名或密码错误!',
      messageCode: '002005030013100',
    });
    const getProjectFn = vi.fn().mockResolvedValue(makeProject('p1'));
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    await expect(mgr.getOrLogin('p1')).rejects.toThrow(BosLoginFailedError);
  });

  it('failed login does not cache — next call retries', async () => {
    const loginFn = vi
      .fn<(c: LoginCredentials) => Promise<LoginResult>>()
      .mockResolvedValueOnce({
        session: { baseUrl: 'http://localhost/k3cloud' } as KdSession,
        isSuccess: false,
        message: 'transient',
      })
      .mockResolvedValueOnce(makeSuccessLogin());
    const getProjectFn = vi.fn().mockResolvedValue(makeProject('p1'));
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    await expect(mgr.getOrLogin('p1')).rejects.toThrow(BosLoginFailedError);
    const session = await mgr.getOrLogin('p1');
    expect(session).toBeDefined();
    expect(loginFn).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces a re-login on next call', async () => {
    const loginFn = vi
      .fn<(c: LoginCredentials) => Promise<LoginResult>>()
      .mockResolvedValue(makeSuccessLogin());
    const getProjectFn = vi.fn().mockResolvedValue(makeProject('p1'));
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    await mgr.getOrLogin('p1');
    expect(mgr.has('p1')).toBe(true);

    mgr.invalidate('p1');
    expect(mgr.has('p1')).toBe(false);

    await mgr.getOrLogin('p1');
    expect(loginFn).toHaveBeenCalledTimes(2);
  });

  it('isolates sessions between projects', async () => {
    const loginFn = vi
      .fn<(c: LoginCredentials) => Promise<LoginResult>>()
      .mockImplementation(async (creds) => ({
        ...makeSuccessLogin(),
        session: { baseUrl: creds.baseUrl, aspNetSessionId: `asp-${creds.acctId}` } as KdSession,
      }));
    const getProjectFn = vi.fn().mockImplementation(async (id: string) => {
      const p = makeProject(id);
      if (p.bos) p.bos.acctId = `acct-${id}`;
      return p;
    });
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    const a = await mgr.getOrLogin('alpha');
    const b = await mgr.getOrLogin('beta');

    expect(a.aspNetSessionId).toBe('asp-acct-alpha');
    expect(b.aspNetSessionId).toBe('asp-acct-beta');
    expect(loginFn).toHaveBeenCalledTimes(2);
  });

  it('clear() drops all cached sessions', async () => {
    const loginFn = vi
      .fn<(c: LoginCredentials) => Promise<LoginResult>>()
      .mockResolvedValue(makeSuccessLogin());
    const getProjectFn = vi.fn().mockResolvedValue(makeProject('p1'));
    const mgr = new BosSessionManager(loginFn, getProjectFn);

    await mgr.getOrLogin('p1');
    expect(mgr.has('p1')).toBe(true);

    mgr.clear();
    expect(mgr.has('p1')).toBe(false);
  });
});
