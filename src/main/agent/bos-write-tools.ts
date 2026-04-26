/**
 * Agent tools that let the LLM drive K/3 Cloud BOS customization end-to-end:
 * probe environment → list / create extension → register / unregister
 * Python plugins → delete extensions. Thin wrappers over
 * `src/main/erp/k3cloud/bos-writer.ts` — every write goes through a backup
 * snapshot and a transaction, so agent misbehavior can be hand-rolled back
 * via the returned backup file.
 *
 * `FMODIFIERID=0` + `FSUPPLIERNAME=NULL` on every write — no BOS user ID
 * needed from the consultant (2026-04-23 UAT 实证 — see memory
 * `fuserid_not_required`).
 */

import { getActiveConnector, getConnectionState } from '../erp/active';
import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';
import {
  addFieldToExtension,
  createExtensionWithPythonPlugin,
  deleteExtension,
  listExtensionFields,
  listExtensions,
  listFormPlugins,
  probeBosEnvironment,
  registerPythonPluginOnExtension,
  unregisterPlugin
} from '../erp/k3cloud/bos-writer';
import { FIELD_TYPES, type FieldSpec, type FieldType as BosFieldType } from '../erp/k3cloud/bos-xml';
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
    listExtensionFieldsTool(c),
    probeBosEnvironmentTool(c),
    createExtensionTool(c, pid),
    registerPluginTool(c, pid),
    unregisterPluginTool(c, pid),
    deleteExtensionTool(c, pid),
    addFieldTool(c, pid)
  ];
}

// ─── List / read tools ────────────────────────────────────────────────

function probeBosEnvironmentTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'kingdee_probe_bos_environment',
      description:
        '探活:检查我们能否读 BOS 元数据表。ready = 能往下创建扩展 / 注册插件;not-initialized = 连接或权限问题。写类工具内部会先跑这个,单独调用是为了排障。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    async execute() {
      const pool = await c.getPool();
      const r = await probeBosEnvironment(pool);
      return JSON.stringify(r, null, 2);
    }
  };
}

function listExtensionsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
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
    parallelSafe: true,
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

function listExtensionFieldsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'kingdee_get_extension_fields',
      description:
        '列出某扩展上已有的扩展字段 (parse FKERNELXML 中的 TextField 节点)。注意:这只看扩展字段,不看父对象的原厂字段——查原厂字段用 kingdee_get_fields。新加扩展字段后必用这个反查,不要用 kingdee_get_fields 验证扩展字段(那是查原厂的)。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 GUID。' }
        },
        required: ['extId']
      }
    },
    async execute(args) {
      const extId = String(args.extId);
      const pool = await c.getPool();
      const fields = await listExtensionFields(pool, extId);
      return JSON.stringify({ count: fields.length, fields }, null, 2);
    }
  };
}

// ─── Write tools ──────────────────────────────────────────────────────

async function ensureReady(c: K3CloudConnector): Promise<void> {
  const pool = await c.getPool();
  const env = await probeBosEnvironment(pool);
  if (env.status !== 'ready') {
    throw new Error(
      env.reason ?? '当前 K/3 Cloud 账套 BOS 元数据表不可访问,请检查连接权限。'
    );
  }
}

function createExtensionTool(c: K3CloudConnector, projectId: string): ToolHandler {
  return {
    definition: {
      name: 'kingdee_create_extension_with_python_plugin',
      description:
        '给原单据新建扩展 + 挂 Python 表单插件(一步到位)。前置 / 后置规则见 `k3cloud/bos-features-index` skill。',
      parameters: {
        type: 'object',
        properties: {
          parentFormId: { type: 'string', description: '原单据 FormID,如 "SAL_SaleOrder"。' },
          extName: { type: 'string', description: '扩展中文名,描述业务意图。' },
          pluginName: { type: 'string', description: '插件名,只用 [a-z0-9_]。' },
          pyBody: { type: 'string', description: '完整 IronPython 2.7 源码,含 import + 继承 AbstractBillPlugIn。' }
        },
        required: ['parentFormId', 'extName', 'pluginName', 'pyBody']
      }
    },
    async execute(args) {
      await ensureReady(c);
      const plugin: PluginMeta = {
        className: String(args.pluginName),
        type: 'python',
        pyScript: String(args.pyBody)
      };
      const pool = await c.getPool();
      const r = await createExtensionWithPythonPlugin(pool, {
        projectId,
        parentFormId: String(args.parentFormId),
        extName: String(args.extName),
        plugin
      });
      return JSON.stringify(
        {
          ok: true,
          extId: r.extId,
          backupFile: r.backupFile,
          reminder:
            '请在 BOS Designer 中刷新扩展列表(工具栏刷新按钮);新建销售订单时客户端可能需重登一次才能加载新插件。如需共享给团队,去 BOS Designer 点一次"同步"(SVN)。**以后想删这个扩展请回来调 kingdee_delete_extension,不要在 BOS Designer 里点删 —— Designer 删会触发 SVN 同步报"local modifications"卡死。**'
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
          extId: { type: 'string', description: '扩展 GUID。' },
          pluginName: {
            type: 'string',
            description: '插件脚本名(下划线 + 字母数字)。'
          },
          pyBody: { type: 'string', description: 'IronPython 2.7 源码。' }
        },
        required: ['extId', 'pluginName', 'pyBody']
      }
    },
    async execute(args) {
      await ensureReady(c);
      const pool = await c.getPool();
      const r = await registerPythonPluginOnExtension(pool, projectId, String(args.extId), {
        className: String(args.pluginName),
        type: 'python',
        pyScript: String(args.pyBody)
      });
      return JSON.stringify(
        {
          ok: true,
          backupFile: r.backupFile,
          reminder:
            '请在 BOS Designer 中刷新扩展(工具栏刷新按钮),客户端可能需重登一次。团队协作用 SVN 的话去 BOS 点一次"同步"。'
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
          extId: { type: 'string', description: '扩展 GUID。' },
          className: {
            type: 'string',
            description: '要移除的插件 ClassName(Python 是脚本名,DLL 是全限定 .NET 类型)。'
          }
        },
        required: ['extId', 'className']
      }
    },
    async execute(args) {
      await ensureReady(c);
      const pool = await c.getPool();
      const r = await unregisterPlugin(pool, projectId, String(args.extId), String(args.className));
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
        '这是 nuclear 操作。调用前一定要双重确认:只想移除某一个插件用 kingdee_unregister_plugin。backup JSON 文件会写到项目目录,用户可手工恢复。\n' +
        '\n**用户想删扩展时永远走这个工具,不要让用户去 BOS Designer 手工删** —— Designer 里删会触发 SVN 同步检查,撞"`local modifications` -- commit or revert them first"卡死。本工具直改 DB 绕过 SVN,运行时 BOS 只读 DB,SVN 工作区残留的 .dym 文件无害。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '要删的扩展 GUID。' }
        },
        required: ['extId']
      }
    },
    async execute(args) {
      await ensureReady(c);
      const pool = await c.getPool();
      const r = await deleteExtension(pool, projectId, String(args.extId));
      return JSON.stringify({ ok: true, backupFile: r.backupFile }, null, 2);
    }
  };
}

function addFieldTool(c: K3CloudConnector, projectId: string): ToolHandler {
  return {
    definition: {
      name: 'kingdee_add_field',
      description:
        '给已有扩展加一个业务字段 (写 T_META_OBJECTTYPE.FKERNELXML;combo / base_data 还会写额外元数据表)。客户在 BOS Designer 中刷新扩展(工具栏刷新),且**关闭 BOS 客户端重登**后才能在单据上看到新字段。Plan 5.12.1 起支持 15 种字段类型 — 选择规则:\n' +
        '• text / large_text — 单行 / 多行文本(备注)\n' +
        '• int / decimal / amount / qty — 整数 / 小数 / 金额 / 数量\n' +
        '• date / datetime — 日期 / 日期时间\n' +
        '• checkbox — 是/否 复选框\n' +
        '• combo / mul_combo — 单选 / 多选下拉。必带 comboItems(下拉项列表),工具内部建 T_META_FORMENUM 元数据,FKERNELXML 用 <EnumType> 引用 — agent 不要直接写 enum GUID。\n' +
        '• base_data — 基础资料引用(客户 / 物料 / 部门 ...)。refBaseDataObjectKey 传 friendly key (BD_Customer / BD_MATERIAL / BD_Department),工具内部查 T_META_LOOKUPCLASS 翻 GUID — agent 不要传 GUID。key 拼写错会直接报错。\n' +
        '• base_property — 基础资料属性带值(必带 sourceField + srcDisplayFieldName)。**用前先调 kingdee_describe_basedata** 反查目标基础资料能 srcDisplay 哪些字段(如客户名 FName / 客户简称 FShortName / 客户地址 FAddress)。sourceField 必须是同单据上已有的 BaseDataField key (如销售订单上的 FCustId 客户字段)。\n' +
        '• color / mobile — 颜色 / 手机号\n' +
        '不知道扩展 ID 先调 kingdee_list_extensions。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID (GUID)。' },
          type: {
            type: 'string',
            enum: [...FIELD_TYPES],
            description: '字段类型。'
          },
          key: {
            type: 'string',
            description:
              '字段 Key, 例 "F_CUSTOM_TEXT"。BOS 约定 F_ 开头, 仅字母/数字/下划线。这是表单绑定和 BOS Designer 显示的唯一标识。'
          },
          caption: {
            type: 'string',
            description: '中文显示标签, 例 "客户备注"。用户在表单上看到的就是这个。'
          },
          name: { type: 'string', description: '(可选) 内部名称, 默认 = caption。' },
          propertyName: { type: 'string', description: '(可选) PropertyName, 默认 = key。代码里绑定用。' },
          fieldName: { type: 'string', description: '(可选) DB 列名, 默认 = key 的大写。' },
          containerKey: { type: 'string', description: '(可选) 放在哪个布局容器, 默认 "FTAB_P0" (主页签)。' },
          top: {
            type: 'number',
            description: '(可选) 字段 Top 像素, 默认 10 (左上角)。用户必须在 BOS Designer 中手动拖到合适位置;只有真知道目标坐标才指定。'
          },
          left: { type: 'number', description: '(可选) 字段 Left 像素, 默认 10 (左上角)。' },
          width: { type: 'number', description: '(可选) 控件宽度像素, 默认 300。' },
          labelWidth: { type: 'number', description: '(可选) 标签宽度像素, 默认 100。' },
          comboItems: {
            type: 'array',
            description: '(combo / mul_combo 必填) 下拉项列表。例 [{"value":"H","caption":"高"},...]。',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string', description: '存值' },
                caption: { type: 'string', description: '显示文字' }
              },
              required: ['value', 'caption']
            }
          },
          refBaseDataObjectKey: {
            type: 'string',
            description:
              '(base_data 必填) 关联基础资料对象的 FormID,如 "BD_Customer"(客户)/ "BD_MATERIAL"(物料,大写)/ "BD_Department"(部门)。**传 friendly key,不传 GUID** — 工具内部 SELECT T_META_LOOKUPCLASS 翻成 GUID 写进 XML。不确定 key 拼写先调 kingdee_describe_basedata 验证存在。'
          },
          sourceField: {
            type: 'string',
            description:
              '(base_property 必填) 同单据上的源 BaseDataField Key, 例 "FCustId"。值随源字段变化时自动带出。'
          },
          srcDisplayFieldName: {
            type: 'string',
            description:
              '(base_property 必填) 要从源基础资料带出的属性列名, 例 "FName" (客户名称) / "FAddress" (默认地址)。'
          }
        },
        required: ['extId', 'type', 'key', 'caption']
      }
    },
    async execute(args) {
      await ensureReady(c);
      const pool = await c.getPool();
      const type = String(args.type) as BosFieldType;
      if (!FIELD_TYPES.includes(type)) {
        throw new Error(
          `不支持的字段类型 "${type}"。可选: ${FIELD_TYPES.join(' / ')}。`
        );
      }
      const spec: FieldSpec = {
        key: String(args.key),
        caption: String(args.caption),
        name: args.name !== undefined ? String(args.name) : undefined,
        propertyName: args.propertyName !== undefined ? String(args.propertyName) : undefined,
        fieldName: args.fieldName !== undefined ? String(args.fieldName) : undefined,
        containerKey: args.containerKey !== undefined ? String(args.containerKey) : undefined,
        top: args.top !== undefined ? Number(args.top) : undefined,
        left: args.left !== undefined ? Number(args.left) : undefined,
        width: args.width !== undefined ? Number(args.width) : undefined,
        labelWidth: args.labelWidth !== undefined ? Number(args.labelWidth) : undefined,
        comboItems: Array.isArray(args.comboItems)
          ? (args.comboItems as Array<{ value: unknown; caption: unknown }>).map((it) => ({
              value: String(it.value),
              caption: String(it.caption)
            }))
          : undefined,
        refBaseDataObjectKey:
          args.refBaseDataObjectKey !== undefined ? String(args.refBaseDataObjectKey) : undefined,
        sourceField: args.sourceField !== undefined ? String(args.sourceField) : undefined,
        srcDisplayFieldName:
          args.srcDisplayFieldName !== undefined ? String(args.srcDisplayFieldName) : undefined
      };
      const r = await addFieldToExtension(pool, projectId, String(args.extId), type, spec);
      return JSON.stringify(
        {
          ok: true,
          extId: args.extId,
          fieldKey: args.key,
          fieldType: type,
          backupFile: r.backupFile,
          reminder:
            '字段已写入 DB。去 BOS Designer 中刷新扩展(工具栏刷新按钮)就能看到新字段。**字段默认落在容器左上角,会和原厂字段视觉重叠 —— 这是预期的,需在 BOS Designer 中手动拖到合适位置。**如用 SVN 同步共享给团队, 记得点一次"同步"。'
        },
        null,
        2
      );
    }
  };
}
