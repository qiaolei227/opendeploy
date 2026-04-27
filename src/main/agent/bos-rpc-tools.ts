/**
 * Agent tools that drive K/3 Cloud BOS write operations through the same
 * HTTP RPC path BOS Designer uses (`*.common.kdsvc`). Replaces the SQL-direct
 * `bos-write-tools.ts` that was deleted in commit 029bacf — that route hit a
 * wall reverse-engineering BOS's internal SaveV9 XML generation
 * (BasePropertyField + base-data fields kept producing subtle bugs no matter
 * how many times we tried).
 *
 * Architecture:
 *   Tool input → BosSessionManager.getOrLogin(projectId)  // cached session
 *              → rpc/{save-for-ide,delete-extension}.ts   // typed RPC call
 *              → server returns IDEOperateResult / void   // typed result
 *              → tool formats user-friendly JSON
 *
 * No SQL writes — everything that used to be a transactional INSERT batch is
 * now a single `SaveForIDEV9` call. The server handles all the
 * T_META_* table mutations internally; our job is only to build the right
 * DCXML delta + paras envelope (rpc/dcxml.ts + rpc/save-for-ide.ts).
 */

import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';
import { getActiveConnector, getConnectionState } from '../erp/active';
import { bosSessionManager } from '../erp/k3cloud/rpc/session-manager';
import { deleteExtension as deleteExtensionRpc } from '../erp/k3cloud/rpc/delete-extension';
import { getProject } from '../projects/store';

/**
 * Build the BOS RPC tool set for the current active project. Empty when:
 *   - No project is connected — agent doesn't see write tools, so it won't
 *     promise writes that can't execute.
 *   - The active project has no `bos` field — same reason; user has to set
 *     up creds before agent can write. (We could surface a stub tool that
 *     errors at call time, but hiding is cleaner: the agent doesn't get
 *     to think writes are available when they're not.)
 *
 * `connector`, `projectId`, and `sessionMgr` injectable for tests.
 */
export async function buildBosRpcTools(
  connector?: K3CloudConnector,
  projectId?: string,
  sessionMgr = bosSessionManager,
): Promise<ToolHandler[]> {
  const c = connector ?? getActiveConnector();
  if (!c) return [];
  const pid = projectId ?? getConnectionState().projectId;
  if (!pid) return [];
  // Only expose write tools when the active project has BOS creds — keeps
  // the agent's tool list honest about what's actually available.
  const project = await getProject(pid).catch(() => null);
  if (!project?.bos) return [];

  return [deleteExtensionTool(pid, sessionMgr)];
}

// ─── Individual tools ─────────────────────────────────────────────────

interface SessionMgrLike {
  getOrLogin(projectId: string): Promise<import('../erp/k3cloud/rpc/http-client').KdSession>;
  invalidate(projectId: string): void;
}

function deleteExtensionTool(projectId: string, sessionMgr: SessionMgrLike): ToolHandler {
  return {
    definition: {
      name: 'kingdee_delete_extension',
      description:
        '彻底删除一个 BOS 扩展 — 调用 K/3 Cloud 服务端的 Delete RPC,服务端会清掉 ' +
        'T_META_OBJECTTYPE + 名称扩展 + 引用克隆 + 跟踪表等所有相关行,以及该扩展上的字段 / 插件。\n' +
        '\n**用户想删扩展时永远走这个工具,不要让用户去 BOS Designer 手工删** — Designer ' +
        '里删会触发 SVN 同步检查,撞 "local modifications" 卡死(详见 memory ' +
        '`bos_designer_svn_kills_delete`)。本工具走原厂 RPC,绕开 SVN 路径。',
      parameters: {
        type: 'object',
        properties: {
          extId: {
            type: 'string',
            description: '要删除的扩展 FID(32 位 hex GUID,无连字符)。',
          },
        },
        required: ['extId'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      if (!extId) {
        throw new Error('kingdee_delete_extension 需要 extId 参数。');
      }
      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }
      const session = await sessionMgr.getOrLogin(projectId);
      const result = await deleteExtensionRpc(session, extId, { devCode: project.bos.devCode });

      if (!result.ok) {
        // Server-side failure — surface message verbatim so the user / agent
        // can see what went wrong (e.g. extension already deleted, FID
        // doesn't exist, permission denied).
        return JSON.stringify(
          {
            ok: false,
            extId,
            message: result.message,
            responseBody: result.responseBody,
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          ok: true,
          extId,
          reminder:
            '扩展已从服务端删除。客户端 BOS Designer 中的扩展列表需点工具栏刷新按钮才能更新;' +
            '已打开的客户端表单缓存可能需关闭客户端重登才能消失。',
        },
        null,
        2,
      );
    },
  };
}
