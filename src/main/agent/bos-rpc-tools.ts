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
import { saveExtension as saveExtensionRpc } from '../erp/k3cloud/rpc/save-for-ide';
import { extractLayoutInfoOid } from '../erp/k3cloud/rpc/layout-discovery';
import { newCompactGuid } from '../erp/k3cloud/rpc/dcxml';
import type { SaveExtensionRequest } from '../erp/k3cloud/rpc/types';
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

  return [
    createExtensionTool(c, pid, sessionMgr),
    deleteExtensionTool(pid, sessionMgr),
  ];
}

// ─── Individual tools ─────────────────────────────────────────────────

interface SessionMgrLike {
  getOrLogin(projectId: string): Promise<import('../erp/k3cloud/rpc/http-client').KdSession>;
  invalidate(projectId: string): void;
}

function createExtensionTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'kingdee_create_extension',
      description:
        '在 K/3 Cloud 上为指定父单据(原厂表单)新建一个 BOS 扩展。扩展是在父对象上挂字段 / 插件 / 业务规则等定制内容的容器,本身不带任何字段或插件。\n' +
        '\n创建后调用方拿到的 `extId` 用于后续:\n' +
        '- `kingdee_add_field` 添加扩展字段\n' +
        '- `kingdee_register_python_plugin` 挂 Python 表单插件\n' +
        '- `kingdee_delete_extension` 不要时整个删掉\n' +
        '\n创建前**先调 `kingdee_list_extensions <parentFormId>`** 看是否已有可复用的扩展(同一父单据上多个扩展会变 BOS Designer 的负担)。' +
        '`layoutInfoOid` 通常会自动从父单据的元数据里查出来,只在自动发现失败时才手动传。',
      parameters: {
        type: 'object',
        properties: {
          parentFormId: {
            type: 'string',
            description: '原厂父单据 FormID,如 "SAL_SaleOrder"(销售订单)、"BD_MATERIAL"(物料)。',
          },
          extName: {
            type: 'string',
            description: '扩展中文名,描述业务意图,例如 "信用额度预警"。客户在 BOS Designer 中能看到。',
          },
          layoutInfoOid: {
            type: 'string',
            description:
              '(可选)父单据的主布局视图 OID(8-4-4-4-12 格式 GUID)。一般从父对象 FKERNELXML 自动发现,只在自动发现失败时才传。',
          },
        },
        required: ['parentFormId', 'extName'],
      },
    },
    async execute(args) {
      const parentFormId = String(args.parentFormId ?? '').trim();
      const extName = String(args.extName ?? '').trim();
      if (!parentFormId) throw new Error('kingdee_create_extension 需要 parentFormId 参数。');
      if (!extName) throw new Error('kingdee_create_extension 需要 extName 参数。');

      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }

      // Look up parent's modelTypeId / subsystemId — both required by
      // SaveForIDEV9 paras. Returns null when the form doesn't exist.
      const parent = await connector.getObject(parentFormId);
      if (!parent) {
        throw new Error(`父单据 ${parentFormId} 不存在。请先用 kingdee_search_metadata 确认 FormID 拼写。`);
      }
      if (parent.modelTypeId == null || parent.subsystemId == null) {
        throw new Error(
          `父单据 ${parentFormId} 元数据不完整(modelTypeId=${parent.modelTypeId}, subsystemId=${parent.subsystemId}),无法创建扩展。`,
        );
      }

      // Discover layoutInfoOid from parent FKERNELXML unless agent overrode.
      let layoutInfoOid = typeof args.layoutInfoOid === 'string' ? args.layoutInfoOid.trim() : '';
      if (!layoutInfoOid) {
        const xml = await connector.getKernelXml(parentFormId);
        if (!xml) {
          throw new Error(`父单据 ${parentFormId} 无 FKERNELXML,无法自动发现 layoutInfoOid。`);
        }
        const oid = extractLayoutInfoOid(xml);
        if (!oid) {
          throw new Error(
            `父单据 ${parentFormId} FKERNELXML 中未找到 <LayoutInfo oid="...">,请手动指定 layoutInfoOid 参数。`,
          );
        }
        layoutInfoOid = oid;
      }

      const formId = newCompactGuid();
      const req: SaveExtensionRequest = {
        extension: {
          formId,
          baseObjectId: parentFormId,
          modelTypeId: parent.modelTypeId,
          subSystemId: parent.subsystemId,
          name: [{ localeId: 2052, value: extName }],
          isv: { devCode: project.bos.devCode },
        },
        isNew: true,
        layoutInfoOid,
      };

      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            parentFormId,
            extName,
            messageTitle: result.messageTitle,
            messageDetail: result.messageDetail,
            hint: '服务端拒绝了创建。看 messageDetail 里的具体原因。',
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          ok: true,
          extId: formId,
          parentFormId,
          extName,
          layoutInfoOid,
          reminder:
            '扩展已创建。后续添加字段 / 插件请把上面的 extId 传给 kingdee_add_field / kingdee_register_python_plugin。' +
            'BOS Designer 中需点工具栏刷新按钮才能在扩展列表里看到新建的扩展。',
        },
        null,
        2,
      );
    },
  };
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
