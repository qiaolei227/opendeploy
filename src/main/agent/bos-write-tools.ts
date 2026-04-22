/**
 * Agent tools that let the LLM drive K/3 Cloud BOS customization end-to-end:
 * probe environment → list / create extension → register / unregister
 * Python plugins → delete extensions. Thin wrappers over
 * `src/main/erp/k3cloud/bos-writer.ts` — every write goes through a backup
 * snapshot and a transaction, so agent misbehavior can be hand-rolled back
 * via the returned backup file.
 *
 * The env check runs inside every write tool so the agent doesn't need to
 * remember to probe first. When the env is unusable the tool returns a
 * structured `not_initialized` message the agent is system-prompted to
 * pass through to the user verbatim.
 */

import { getActiveConnector, getConnectionState } from '../erp/active';
import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';
import {
  createExtensionWithPythonPlugin,
  deleteExtension,
  listExtensions,
  listFormPlugins,
  probeBosEnvironment,
  registerPythonPluginOnExtension,
  unregisterPlugin
} from '../erp/k3cloud/bos-writer';
import type { PluginMeta } from '@shared/erp-types';

/**
 * Build the BOS write tool set for the current active project. Empty when
 * no project is connected — parallel to `buildK3CloudTools`. The agent
 * sees no `kingdee_*` BOS tools in its system prompt when the project
 * isn't ready, so it won't promise writes it can't execute.
 *
 * `connector` and `projectId` overrides exist for tests; production
 * callers pass neither and read from the active-project singleton.
 */
export function buildBosWriteTools(
  connector?: K3CloudConnector,
  projectId?: string
): ToolHandler[] {
  const c = connector ?? getActiveConnector();
  if (!c) return [];
  const pid = projectId ?? getConnectionState().projectId;
  if (!pid) return [];
  return [
    listExtensionsTool(c),
    listFormPluginsTool(c),
    probeBosEnvironmentTool(c),
    createExtensionTool(c, pid),
    registerPluginTool(c, pid),
    unregisterPluginTool(c, pid),
    deleteExtensionTool(c, pid)
  ];
}

function requireUserId(args: Record<string, unknown>): number {
  const raw = args.userId;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      'userId is required — ask the user for their K/3 Cloud BOS user number ' +
        '(visible in BOS Designer bottom-right after login, e.g. 100002)'
    );
  }
  return raw;
}

// ─── List / read tools ────────────────────────────────────────────────

function probeBosEnvironmentTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'kingdee_probe_bos_environment',
      description:
        '检查当前 K/3 Cloud 账套是否已就绪做 BOS 二开。返回 ready 就能往下走创建扩展 / 注册插件;返回 not-initialized 表示用户还没登录过 K/3 Cloud 协同开发平台,本工具会给出该提示给用户。所有写类 BOS 工具都会在内部先调这个,单独调用是为了排障或在对话开始时预检。',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'number',
            description:
              'K/3 Cloud BOS 用户号(不是登录用户名),通常 100000+ 的整数。BOS Designer 登录后右下角可见。'
          }
        },
        required: ['userId']
      }
    },
    async execute(args) {
      const userId = requireUserId(args);
      const pool = await c.getPool();
      const r = await probeBosEnvironment(pool, userId);
      return JSON.stringify(r, null, 2);
    }
  };
}

function listExtensionsTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'kingdee_list_extensions',
      description:
        '列出指定原单据(父对象)已有的所有扩展。BOS 要求改单据必须先扩展,所以注册插件 / 改字段前先用这个看有没有可复用的扩展——有就走 kingdee_register_python_plugin 挂到上面,没有才走 kingdee_create_extension_with_python_plugin 新建。',
      parameters: {
        type: 'object',
        properties: {
          parentFormId: {
            type: 'string',
            description: '原单据 FormID,例如 "SAL_SaleOrder"、"BD_MATERIAL"。'
          }
        },
        required: ['parentFormId']
      }
    },
    async execute(args) {
      const parentFormId = String(args.parentFormId);
      const pool = await c.getPool();
      const exts = await listExtensions(pool, parentFormId);
      return JSON.stringify({ count: exts.length, extensions: exts }, null, 2);
    }
  };
}

function listFormPluginsTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'kingdee_list_form_plugins',
      description:
        '列出某单据或扩展上已注册的所有插件(DLL + Python 混合)。用于:1)重复注册前查重;2)排障看标准插件执行顺序;3)unregister 前确认脚本名。',
      parameters: {
        type: 'object',
        properties: {
          formOrExtId: {
            type: 'string',
            description: '原单据 FormID(如 SAL_SaleOrder)或扩展 GUID。'
          }
        },
        required: ['formOrExtId']
      }
    },
    async execute(args) {
      const formOrExtId = String(args.formOrExtId);
      const pool = await c.getPool();
      const plugins = await listFormPlugins(pool, formOrExtId);
      return JSON.stringify({ count: plugins.length, plugins }, null, 2);
    }
  };
}

// ─── Write tools ──────────────────────────────────────────────────────

async function ensureReady(
  c: K3CloudConnector,
  userId: number
): Promise<string> {
  const pool = await c.getPool();
  const env = await probeBosEnvironment(pool, userId);
  if (env.status !== 'ready' || !env.developerCode) {
    throw new Error(
      env.reason ??
        '当前 K/3 Cloud 账套尚未就绪做 BOS 二开,请先在协同开发平台登录一次。'
    );
  }
  return env.developerCode;
}

function createExtensionTool(c: K3CloudConnector, projectId: string): ToolHandler {
  return {
    definition: {
      name: 'kingdee_create_extension_with_python_plugin',
      description:
        '一步到位:给原单据新建扩展并把 Python 插件注册到这个扩展上。最常用的写入入口——顾问说"帮我加个 BeforeSave 校验"就是这条路径,不需要另外调 create + register 两步。' +
        '调用前推荐先 kingdee_list_extensions 看有没有现成扩展可复用;如果有,改用 kingdee_register_python_plugin。' +
        '成功后提示用户在 BOS Designer 里按 F5 刷新、并在必要时重登客户端让缓存失效;如果团队用 SVN,还需点一次"同步"。',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'number',
            description: 'BOS 用户号,见 kingdee_probe_bos_environment 描述。'
          },
          parentFormId: {
            type: 'string',
            description: '原单据 FormID,例如 "SAL_SaleOrder"。'
          },
          extName: {
            type: 'string',
            description:
              '扩展的中文名,建议描述业务意图,例如"销售订单·信用额度预警"。'
          },
          pluginName: {
            type: 'string',
            description:
              'Python 插件名称,只用下划线和字母数字,例如 credit_limit_guard。'
          },
          pyBody: {
            type: 'string',
            description:
              '完整 IronPython 2.7 源码,含 import、继承 AbstractBillPlugIn、事件 override 等。不要加 shebang。'
          }
        },
        required: ['userId', 'parentFormId', 'extName', 'pluginName', 'pyBody']
      }
    },
    async execute(args) {
      const userId = requireUserId(args);
      const developerCode = await ensureReady(c, userId);
      const plugin: PluginMeta = {
        className: String(args.pluginName),
        type: 'python',
        pyScript: String(args.pyBody)
      };
      const pool = await c.getPool();
      const r = await createExtensionWithPythonPlugin(pool, {
        projectId,
        userId,
        parentFormId: String(args.parentFormId),
        extName: String(args.extName),
        developerCode,
        plugin
      });
      return JSON.stringify(
        {
          ok: true,
          extId: r.extId,
          backupFile: r.backupFile,
          reminder:
            '请在 BOS Designer 按 F5 刷新扩展列表;新建销售订单时客户端可能需重登一次才能加载新插件。如需共享给团队,去 BOS Designer 点一次"同步"(SVN)。'
        },
        null,
        2
      );
    }
  };
}

function registerPluginTool(c: K3CloudConnector, projectId: string): ToolHandler {
  return {
    definition: {
      name: 'kingdee_register_python_plugin',
      description:
        '把 Python 插件注册到一个已有扩展上。用在:1)同一个扩展上挂多个插件;2)顾问已经用 BOS Designer 建了扩展,我们只补插件。不知道扩展 ID 先调 kingdee_list_extensions。',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'BOS 用户号。' },
          extId: { type: 'string', description: '扩展 GUID。' },
          pluginName: {
            type: 'string',
            description: '插件脚本名(下划线 + 字母数字)。'
          },
          pyBody: { type: 'string', description: 'IronPython 2.7 源码。' }
        },
        required: ['userId', 'extId', 'pluginName', 'pyBody']
      }
    },
    async execute(args) {
      const userId = requireUserId(args);
      await ensureReady(c, userId);
      const pool = await c.getPool();
      const r = await registerPythonPluginOnExtension(pool, projectId, userId, String(args.extId), {
        className: String(args.pluginName),
        type: 'python',
        pyScript: String(args.pyBody)
      });
      return JSON.stringify(
        {
          ok: true,
          backupFile: r.backupFile,
          reminder:
            '请在 BOS Designer 按 F5 刷新,客户端可能需重登一次。团队协作用 SVN 的话去 BOS 点一次"同步"。'
        },
        null,
        2
      );
    }
  };
}

function unregisterPluginTool(c: K3CloudConnector, projectId: string): ToolHandler {
  return {
    definition: {
      name: 'kingdee_unregister_plugin',
      description:
        '从扩展上移除一个已注册的插件(按 ClassName 匹配)。DLL 和 Python 都能移。不存在时是静默 no-op(依然返回 backup 文件路径)。',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'BOS 用户号。' },
          extId: { type: 'string', description: '扩展 GUID。' },
          className: {
            type: 'string',
            description: '要移除的插件 ClassName(Python 是脚本名,DLL 是全限定 .NET 类型)。'
          }
        },
        required: ['userId', 'extId', 'className']
      }
    },
    async execute(args) {
      const userId = requireUserId(args);
      await ensureReady(c, userId);
      const pool = await c.getPool();
      const r = await unregisterPlugin(pool, projectId, userId, String(args.extId), String(args.className));
      return JSON.stringify({ ok: true, backupFile: r.backupFile }, null, 2);
    }
  };
}

function deleteExtensionTool(c: K3CloudConnector, projectId: string): ToolHandler {
  return {
    definition: {
      name: 'kingdee_delete_extension',
      description:
        '彻底删除一个扩展 —— 连带它名下所有插件 / 字段扩展 / 引用克隆。8 张 BOS 表的行全部清掉。' +
        '这是 nuclear 操作。调用前一定要双重确认:只想移除某一个插件用 kingdee_unregister_plugin。backup JSON 文件会写到项目目录,用户可手工恢复。',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'BOS 用户号(用于环境自检,写 DB 不盖章)。' },
          extId: { type: 'string', description: '要删的扩展 GUID。' }
        },
        required: ['userId', 'extId']
      }
    },
    async execute(args) {
      const userId = requireUserId(args);
      await ensureReady(c, userId);
      const pool = await c.getPool();
      const r = await deleteExtension(pool, projectId, String(args.extId));
      return JSON.stringify({ ok: true, backupFile: r.backupFile }, null, 2);
    }
  };
}
