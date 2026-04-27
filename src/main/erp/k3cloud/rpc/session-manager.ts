/**
 * Per-project BOS RPC session cache.
 *
 * Tools never call `login()` directly — they go through `getOrLogin(projectId)`
 * here so a single Login round-trip serves a whole burst of writes (creating an
 * extension + adding 5 fields + registering a plugin = 7 RPCs sharing one
 * session). On session expiry the tool can call `invalidate(projectId)` and
 * retry; we don't auto-detect expiry yet because the server's expiry response
 * shape isn't documented and I don't want to guess wrong patterns.
 *
 * Credentials are read from the project's `bos` field (added in the previous
 * commit). Missing creds → `MissingBosCredentialsError`, which write tools
 * surface to the user as a clear "go set up BOS creds" message rather than a
 * cryptic 401.
 */

import { login } from './login';
import type { KdSession } from './http-client';
import type { LoginResult } from './login';
import { getProject } from '../../../projects/store';

export class MissingBosCredentialsError extends Error {
  constructor(projectId: string) {
    super(
      `项目 ${projectId} 未配置 BOS 写入凭据。请到"项目设置"补上 BOS 服务地址 / 账套 ID / 用户名 / 密码 / 开发商编码。`,
    );
    this.name = 'MissingBosCredentialsError';
  }
}

export class BosLoginFailedError extends Error {
  constructor(public readonly result: LoginResult) {
    super(
      `BOS 登录失败: ${result.message ?? '(无错误信息)'}` +
        (result.messageCode ? ` (code=${result.messageCode})` : ''),
    );
    this.name = 'BosLoginFailedError';
  }
}

interface CachedSession {
  session: KdSession;
  /** ms since epoch when the session was created; used by tests to verify caching. */
  loggedInAt: number;
}

/**
 * Project-scoped session cache. One in-memory map for the whole main process;
 * IPC layer hands out sessions via this singleton. Tests can construct fresh
 * instances to avoid bleed.
 */
export class BosSessionManager {
  private cache = new Map<string, CachedSession>();

  /**
   * Return a cached session or perform Login + cache + return. `getProject`
   * lookup is async, so we can't memoize at construction.
   *
   * Hooks (tests): `loginFn` lets callers inject a mock.
   */
  constructor(
    private loginFn: typeof login = login,
    private getProjectFn: typeof getProject = getProject,
  ) {}

  async getOrLogin(projectId: string): Promise<KdSession> {
    const cached = this.cache.get(projectId);
    if (cached) return cached.session;

    const project = await this.getProjectFn(projectId);
    if (!project) {
      throw new Error(`project not found: ${projectId}`);
    }
    if (!project.bos) {
      throw new MissingBosCredentialsError(projectId);
    }

    const result = await this.loginFn({
      baseUrl: project.bos.baseUrl,
      acctId: project.bos.acctId,
      username: project.bos.username,
      password: project.bos.password,
    });

    if (!result.isSuccess) {
      throw new BosLoginFailedError(result);
    }

    this.cache.set(projectId, { session: result.session, loggedInAt: Date.now() });
    return result.session;
  }

  /**
   * Drop the cached session for a project. Next `getOrLogin` re-logs-in.
   * Called by tools when they detect session expiry from server response.
   */
  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }

  /** Drop all sessions — used on app shutdown / test teardown. */
  clear(): void {
    this.cache.clear();
  }

  /** Test-only inspection. */
  has(projectId: string): boolean {
    return this.cache.has(projectId);
  }
}

/**
 * Process-wide singleton. IPC + agent tool builder use this. Tests
 * construct fresh `BosSessionManager` instances directly.
 */
export const bosSessionManager = new BosSessionManager();
