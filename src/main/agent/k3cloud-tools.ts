import { getActiveConnector, getConnectionState } from '../erp/active';
import { UnsupportedConvertRuleError } from '../erp/k3cloud/rpc/convert-rule-baselines';
import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';
import {
  listBusinessRulesTool,
  deleteBusinessRuleTool,
  describeServiceMetaTool
} from './business-rule-tools';

/**
 * Build the K/3 Cloud tool set for the current active project. Returns an
 * empty array when no project is connected — the agent then sees no k3cloud_*
 * tools in its system prompt, which is correct: we don't want it promising
 * metadata queries that can't succeed.
 *
 * `connector` can be injected for tests; production call-sites pass nothing
 * and read from the active-project singleton.
 */
export function buildK3CloudTools(connector?: K3CloudConnector): ToolHandler[] {
  const c = connector ?? getActiveConnector();
  if (!c) return [];
  return [
    listObjectsTool(c),
    getObjectTool(c),
    getFieldsTool(c),
    listSubsystemsTool(c),
    searchMetadataTool(c),
    describeBasedataTool(c),
    listEnumTypesTool(c),
    listExtensionsTool(c),
    getExtensionFieldsTool(c),
    listFormPluginsTool(c),
    getFormLayoutTool(c),
    listConvertRulesTool(c),
    describeConvertRuleTool(c),
    createConvertRuleExtensionTool(c),
    deleteConvertRuleExtensionTool(c),
    addConvertFieldMappingTool(c),
    setConvertGroupByTool(c),
    setConvertFilterTool(c),
    addConvertPluginTool(c),
    removeConvertPluginTool(c),
    addConvertBillTypeMapTool(c),
    listBusinessRulesTool(c),
    deleteBusinessRuleTool(c),
    describeServiceMetaTool()
  ];
}

/**
 * Short tag describing the active project so the base system prompt can
 * tell the agent which K/3 Cloud database the tools hit. Empty when no
 * project is active.
 *
 * Template text (with `{{placeholder}}` markers) is passed in rather than
 * imported here so this module stays free of Vite's `?raw` syntax —
 * the production call-site in `ipc-llm.ts` imports the md via `?raw`,
 * while debug scripts read it via `fs`. Markers are replaced at call time.
 */
/**
 * ERP provider → user-facing product full name. The agent needs the full
 * edition-level name so it doesn't confuse K/3 Cloud 企业版/标准版 (BOS +
 * IronPython, what we target) with 旗舰版 (runs on 苍穹 V2, different stack).
 */
const PRODUCT_DISPLAY_NAMES: Record<string, string> = {
  k3cloud: '金蝶云星空 企业版/标准版'
};

export function activeProjectTag(template: string): string {
  const state = getConnectionState();
  if (state.status !== 'connected' || !state.projectId) return '';
  const c = getActiveConnector();
  if (!c) return '';
  const productName =
    (state.erpProvider && PRODUCT_DISPLAY_NAMES[state.erpProvider]) ?? state.erpProvider ?? '';
  const values: Record<string, string> = {
    acctId: c.config.acctId,
    baseUrl: c.config.baseUrl,
    productName
  };
  return template
    .trim()
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`);
}

function listObjectsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_objects',
      description:
        '列出当前金蝶 K/3 Cloud 项目里的业务对象（单据 / 基础资料 / 报表）。用于按关键字发现目标对象——例如"销售订单"、"material"、"入库"。不知道确切 FormID 时优先用本工具。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description:
              '模糊匹配 FormID 和中文显示名。留空则返回最近修改的前 N 条。'
          },
          subsystemId: {
            type: 'string',
            description: '限定到某个子系统（模块）。通过 k3cloud_list_subsystems 获取。'
          },
          limit: {
            type: 'number',
            description: '最多返回条数，默认 50。上限 1000。'
          },
          includeTemplates: {
            type: 'boolean',
            description: '是否包含模板 / 基础对象，默认 false。'
          }
        }
      }
    },
    async execute(args) {
      const rows = await c.listObjects({
        keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
        subsystemId:
          typeof args.subsystemId === 'string' ? args.subsystemId : undefined,
        limit: typeof args.limit === 'number' ? args.limit : 50,
        includeTemplates: args.includeTemplates === true
      });
      return JSON.stringify(
        { count: rows.length, objects: rows },
        null,
        2
      );
    }
  };
}

function getObjectTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_get_object',
      description:
        '按精确 FormID 获取 K/3 Cloud 业务对象的头部信息（modelType / 子系统 / 最后修改时间）。FormID 不确定时先调 k3cloud_list_objects 或 k3cloud_search_metadata。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '精确 FormID，例如 "SAL_SaleOrder"、"BD_MATERIAL"。'
          }
        },
        required: ['id']
      }
    },
    async execute(args) {
      const id = args.id;
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('k3cloud_get_object requires a non-empty `id` string.');
      }
      const obj = await c.getObject(id);
      if (!obj) {
        return JSON.stringify({ found: false, id }, null, 2);
      }
      return JSON.stringify({ found: true, object: obj }, null, 2);
    }
  };
}

function getFieldsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_get_fields',
      description:
        '获取 K/3 Cloud 业务对象的字段清单 —— **只查父对象的原厂字段, 不包括扩展字段**。默认只返 key 列表(轻量);用 keyword 过滤到具体字段、或 includeDetail:true 获取全部字段的 ElementType / entryKey 详情。验证扩展上新加的字段请用 k3cloud_get_extension_fields。',
      parameters: {
        type: 'object',
        properties: {
          formId: {
            type: 'string',
            description: '精确 FormID,例如 "SAL_SaleOrder"。'
          },
          keyword: {
            type: 'string',
            description:
              '可选。按字段 key 或中文名做大小写不敏感的子串过滤,只返匹配项的详情(key + type + entryKey)。找具体字段时用。'
          },
          includeDetail: {
            type: 'boolean',
            description:
              '可选,默认 false。true 时返全部字段的详情(type / entryKey 等)——只在确实要一次拿全量时用,会很大。'
          }
        },
        required: ['formId']
      }
    },
    async execute(args) {
      const formId = args.formId;
      if (typeof formId !== 'string' || formId.trim() === '') {
        throw new Error('k3cloud_get_fields requires a non-empty `formId` string.');
      }
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
      const includeDetail = args.includeDetail === true;

      // Check existence first so a missing id doesn't return an empty list
      // that the agent might misinterpret as "this object has no fields".
      const obj = await c.getObject(formId);
      if (!obj) {
        return JSON.stringify(
          {
            found: false,
            formId,
            message:
              'object not found. Run k3cloud_search_metadata first if you are unsure of the id.'
          },
          null,
          2
        );
      }
      const fields = await c.getFields(formId);

      // Keyword path — return only matched fields with detail.
      if (keyword) {
        const match = (f: (typeof fields)[number]) =>
          f.key.toLowerCase().includes(keyword) || f.name.toLowerCase().includes(keyword);
        const matched = fields.filter(match);
        const mHead = matched.filter((f) => !f.isEntryField);
        const mEntries = new Map<string, typeof fields>();
        for (const f of matched) {
          if (f.isEntryField && f.entryKey) {
            const bucket = mEntries.get(f.entryKey) ?? [];
            bucket.push(f);
            mEntries.set(f.entryKey, bucket);
          }
        }
        return JSON.stringify(
          {
            formId,
            name: obj.name,
            total: fields.length,
            keyword,
            matched: matched.length,
            headFields: mHead,
            entryFields: Object.fromEntries(mEntries)
          },
          null,
          2
        );
      }

      // Detail path — full dump (rare, large).
      if (includeDetail) {
        const head = fields.filter((f) => !f.isEntryField);
        const entries = new Map<string, typeof fields>();
        for (const f of fields) {
          if (f.isEntryField && f.entryKey) {
            const bucket = entries.get(f.entryKey) ?? [];
            bucket.push(f);
            entries.set(f.entryKey, bucket);
          }
        }
        return JSON.stringify(
          {
            formId,
            name: obj.name,
            total: fields.length,
            headFields: head,
            entryFields: Object.fromEntries(entries)
          },
          null,
          2
        );
      }

      // Default — lean summary: just keys grouped by head / entry tables.
      // Saves 5-15K chars on objects like SAL_SaleOrder that have 100+ fields.
      const headKeys: string[] = [];
      const entryKeys = new Map<string, string[]>();
      for (const f of fields) {
        if (!f.isEntryField) {
          headKeys.push(f.key);
        } else if (f.entryKey) {
          const bucket = entryKeys.get(f.entryKey) ?? [];
          bucket.push(f.key);
          entryKeys.set(f.entryKey, bucket);
        }
      }
      return JSON.stringify(
        {
          formId,
          name: obj.name,
          total: fields.length,
          headKeys,
          entryTables: Object.fromEntries(entryKeys),
          hint:
            '只返了 key。拿字段类型 / entryKey 详情:加 keyword 过滤 (如 "信用") 或 includeDetail:true。'
        },
        null,
        2
      );
    }
  };
}

function listSubsystemsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_subsystems',
      description:
        '列出 K/3 Cloud 子系统（销售 / 采购 / 库存 / 财务 等模块）。用于给 k3cloud_list_objects 的 subsystemId 参数取值。',
      parameters: { type: 'object', properties: {} }
    },
    async execute() {
      const subs = await c.listSubsystems();
      return JSON.stringify({ count: subs.length, subsystems: subs }, null, 2);
    }
  };
}

function searchMetadataTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_search_metadata',
      description:
        '按关键字模糊搜索 K/3 Cloud 元数据（跨 FormID + 显示名）。与 k3cloud_list_objects 类似但限制更小、返回更少；适合"我想找这个单据是什么 ID"这类场景。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '关键字，例如 "信用额度"、"material code"。'
          }
        },
        required: ['keyword']
      }
    },
    async execute(args) {
      const keyword = args.keyword;
      if (typeof keyword !== 'string' || keyword.trim() === '') {
        throw new Error('k3cloud_search_metadata requires a non-empty `keyword` string.');
      }
      const rows = await c.searchMetadata(keyword);
      return JSON.stringify({ count: rows.length, matches: rows }, null, 2);
    }
  };
}

/**
 * Plan 5.12.1 Task 6 — describe a base-data object's fields so the agent can
 * pick a sensible `srcDisplayFieldName` for a base_property field.
 *
 * Confirmed via 2026-04-26 recon:
 * - BD_Customer.FID is literally the string "BD_Customer" (not a GUID), so
 *   `k3cloud_add_fields` accepts the same key directly as `refBaseDataObjectKey`
 *   for base_data fields. The XML emits `<LookUpObjectID>BD_Customer</LookUpObjectID>`
 *   and BOS resolves it (verified via real SAL_SaleOrder where some
 *   LookUpObjectIDs are FID-keys like "BOS_ItemClass" rather than GUIDs).
 * - BD_Customer.FKERNELXML carries 33 TextFields + 24 BaseDataFields + ... —
 *   its full schema is in its own row, no need to walk the BOS_OrgControlBDModel
 *   parent template.
 *
 * Tool returns ONLY the simple-text-typed fields (TextField / IntegerField /
 * DecimalField / DateTimeField / etc.) since those are the ones a
 * BasePropertyField can srcDisplay. BaseDataField references are excluded
 * (they're themselves lookups, not display values).
 */
function describeBasedataTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_describe_basedata',
      description:
        '反查某基础资料对象(如 BD_Customer 客户档案 / BD_MATERIAL 物料 / BD_Department 部门)的字段清单 —— 用于加 base_property 字段(基础资料属性带值)时,确定 srcDisplayFieldName 该填什么(例如客户名称=FName,客户简称=FShortName,客户地址=FAddress)。同时也确认基础资料 key 本身是否存在,以便用于 base_data 字段的 refBaseDataObjectKey。返回值只包含可"带值"的简单类型字段(文本/数字/日期等),不返回它本身的基础资料引用字段(那些不能直接 srcDisplay)。',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              '基础资料 FormID, 如 "BD_Customer"(客户)、"BD_MATERIAL"(物料,大写)、"BD_Department"(部门)。'
          },
          keyword: {
            type: 'string',
            description:
              '可选。按字段 key 或中文名做大小写不敏感子串过滤(如 "name" / "地址" / "电话"),只返匹配项。基础资料字段动辄几十个,加 keyword 能省 token。'
          }
        },
        required: ['key']
      }
    },
    async execute(args) {
      const key = args.key;
      if (typeof key !== 'string' || key.trim() === '') {
        throw new Error('k3cloud_describe_basedata requires a non-empty `key` string.');
      }
      const obj = await c.getObject(key);
      if (!obj) {
        return JSON.stringify(
          {
            found: false,
            key,
            message:
              '基础资料对象不存在。常见 key 命名: BD_Customer / BD_MATERIAL(大写) / BD_Supplier / BD_Department / BD_Empinfo / BD_Currency 等。先用 k3cloud_search_metadata 搜一下确认。'
          },
          null,
          2
        );
      }

      const allFields = await c.getFields(key);

      // Only fields whose value can be displayed as text — exclude
      // BaseDataField (it's a reference itself, not a display value).
      const DISPLAYABLE_TYPES = new Set([
        'TextField',
        'LargeRichTextField',
        'IntegerField',
        'DecimalField',
        'AmountField',
        'QtyField',
        'DateTimeField',
        'CheckBoxField',
        'ComboField',
        'MulComboField',
        'ColorField',
        'MobileField'
      ]);
      let displayable = allFields.filter((f) => DISPLAYABLE_TYPES.has(f.type));

      const keyword =
        typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
      if (keyword) {
        displayable = displayable.filter(
          (f) =>
            f.key.toLowerCase().includes(keyword) ||
            f.name.toLowerCase().includes(keyword)
        );
      }

      return JSON.stringify(
        {
          found: true,
          key,
          name: obj.name,
          totalFields: allFields.length,
          displayableCount: displayable.length,
          ...(keyword ? { keyword } : {}),
          // Compact list — agent picks one of these `key` values for srcDisplayFieldName.
          fields: displayable.map((f) => ({
            key: f.key,
            name: f.name,
            type: f.type,
            ...(f.entryKey ? { entryKey: f.entryKey } : {})
          })),
          hint:
            'base_data 字段:把上面的 key (如 BD_Customer) 作为 refBaseDataObjectKey 即可。base_property 字段:挑一个上面 fields[*].key (如 FName) 作为 srcDisplayFieldName。'
        },
        null,
        2
      );
    }
  };
}

function listEnumTypesTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_enum_types',
      description:
        '列出当前账套上所有已注册的下拉枚举类型(combo / 枚举字段引用源)。' +
        '\n\n何时用:' +
        '\n- **`k3cloud_add_fields` 加 combo 类型字段前**:必先调本工具看有没有现成的枚举可复用,再决定是引用现有还是 `k3cloud_create_enum_type` 新建。' +
        '\n- 想知道金蝶预置了哪些常用下拉(审核状态 / 单据状态 / 优先级 / 是否启用 / 性别 / ...)' +
        '\n\n参数 `keyword` 模糊匹配枚举名(zh-CN),留空返回全量(共 ~3500 条,会折叠分页给前 N 条)。' +
        '\n\n返回:`{ count, total, enums: [{ id, name, category, isSysPreset }] }`。`isSysPreset === "1"` 是金蝶预置的(改不了),其它都可用 `k3cloud_delete_enum_type` 删除/重命名。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '名称模糊匹配关键字。留空返回前 100 条(全量太多)。',
          },
          limit: {
            type: 'number',
            description: '返回最大条数,默认 100。'
          }
        },
        required: []
      }
    },
    async execute(args) {
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 100;
      const all = await c.listEnumObjects();
      let filtered = all;
      if (keyword) {
        const kw = keyword.toLowerCase();
        filtered = all.filter((e) => e.name.toLowerCase().includes(kw));
      }
      const slice = filtered.slice(0, limit);
      return JSON.stringify(
        {
          count: slice.length,
          total: filtered.length,
          truncated: filtered.length > slice.length,
          enums: slice.map((e) => ({
            id: e.id,
            name: e.name,
            category: e.category,
            isSysPreset: e.isSysPreset
          }))
        },
        null,
        2
      );
    }
  };
}

// ─── Extension reads ────────────────────────────────────────────────────
// These are SQL reads that surface BOS-extension state. Used by:
//  - k3cloud_create_extension's reuse decision (avoid building a duplicate)
//  - post-write closure for k3cloud_add_fields / k3cloud_register_python_plugins
//    (the agent needs to verify the write actually landed)

function listExtensionsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_extensions',
      description:
        '列出指定原厂父单据已有的所有 BOS 扩展。**创建新扩展前必先调** —— 看是否已有可复用的扩展, 避免在同一父单据上堆叠重复扩展(BOS Designer 会变难维护)。' +
        '\n\n返回每条扩展的 extId / 名称 / 开发商编码(FSUPPLIERNAME)/ 修改时间。' +
        '决策建议:**`developerCode` 是 null 或匹配本项目 devCode** 的扩展可考虑挂上去;**`developerCode` 是别家(如 SAP / 友商)的别碰** —— 升级时可能被覆盖,会丢业务。',
      parameters: {
        type: 'object',
        properties: {
          parentFormId: {
            type: 'string',
            description: '原厂父单据 FormID, 例如 "SAL_SaleOrder"、"BD_MATERIAL"。'
          }
        },
        required: ['parentFormId']
      }
    },
    async execute(args) {
      const parentFormId = args.parentFormId;
      if (typeof parentFormId !== 'string' || parentFormId.trim() === '') {
        throw new Error('k3cloud_list_extensions requires a non-empty `parentFormId` string.');
      }
      const exts = await c.listExtensions(parentFormId);
      return JSON.stringify({ count: exts.length, extensions: exts }, null, 2);
    }
  };
}

function getExtensionFieldsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_get_extension_fields',
      description:
        '反查指定 BOS 扩展上已有的扩展字段(parse 扩展自己的 FKERNELXML)。**`k3cloud_add_fields` 写入后用本工具验证字段确实落库** — 不要用 `k3cloud_get_fields` 验证扩展字段, 那个工具只看父对象原厂字段, 会返空, 容易误以为写入失败。' +
        '\n\n返回每个字段的 key / 中文名 / type(BosFieldType, 如 TextField/DecimalField/...)/ 是否 entry 字段。',
      parameters: {
        type: 'object',
        properties: {
          extId: {
            type: 'string',
            description: '扩展 FID(32 位 hex GUID 或带连字符 GUID)。'
          }
        },
        required: ['extId']
      }
    },
    async execute(args) {
      const extId = args.extId;
      if (typeof extId !== 'string' || extId.trim() === '') {
        throw new Error('k3cloud_get_extension_fields requires a non-empty `extId` string.');
      }
      // FKERNELXML on extension only contains its OWN delta — getFields
      // parses just the new fields, exactly what we want for verification.
      const ext = await c.getObject(extId);
      if (!ext) {
        return JSON.stringify(
          { found: false, extId, message: '扩展不存在 — 检查 FID 拼写' },
          null,
          2
        );
      }
      const fields = await c.getFields(extId);
      return JSON.stringify(
        {
          found: true,
          extId,
          extName: ext.name,
          parentFormId: ext.baseObjectId,
          count: fields.length,
          fields
        },
        null,
        2
      );
    }
  };
}

function listFormPluginsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_form_plugins',
      description:
        '列出指定单据(原厂表单或扩展)上已注册的所有插件。可用于:' +
        '\n1. **`k3cloud_register_python_plugins` 写入后**反查验证插件已落库(看 className 是否在返回列表中、type=python、pyScript 不为空)' +
        '\n2. **注册前查重**:同一扩展上不能挂同名插件,先调本工具看 className 是否已存在' +
        '\n3. **排障**:看父单据原厂带了哪些 DLL 插件 + 顺序(诊断"我的 Python 没生效"时常用)' +
        '\n\n返回每个插件的 className / type(python/dll)/ pyScript(仅 python)/ orderId(仅 DLL)。',
      parameters: {
        type: 'object',
        properties: {
          formOrExtId: {
            type: 'string',
            description: '原厂单据 FormID(如 "SAL_SaleOrder")或扩展 FID(GUID)。'
          }
        },
        required: ['formOrExtId']
      }
    },
    async execute(args) {
      const formOrExtId = args.formOrExtId;
      if (typeof formOrExtId !== 'string' || formOrExtId.trim() === '') {
        throw new Error(
          'k3cloud_list_form_plugins requires a non-empty `formOrExtId` string.'
        );
      }
      const plugins = await c.listFormPlugins(formOrExtId);
      return JSON.stringify({ count: plugins.length, plugins }, null, 2);
    }
  };
}

/**
 * Plan 5.13.x — surface the parent form's tab + entry catalog so the agent
 * can ask the user "which tab / which entry?" before defaulting to FTAB_P0.
 *
 * Returns:
 *   - tabs: every TabPage (head and entry-area) with key + caption + parentControl
 *   - entries: every EntryEntity / SubEntryEntity with key + name + tableName
 *
 * The agent flow before k3cloud_add_fields should be:
 *   1. k3cloud_get_form_layout(parentFormId)
 *   2. List tab captions (head: 基本信息 / 客户信息 / ...) and entry names
 *      (订单条款 / 明细信息 / ...) to the user
 *   3. User picks one — that container key goes into each field's `container` arg
 */
function getFormLayoutTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_get_form_layout',
      description:
        '反查父单据 + 可选地反查扩展自身的容器目录 —— 头有几个 tab(基本信息 / 客户信息 / 财务信息 ...)、几个单据体(订单条款 / 明细信息 / ...),以及扩展自建的 entries / tabs / tabControls。' +
        '\n\n**`k3cloud_add_fields` 之前必调**:头页签 / 单据体多于 1 个时,不能默认 FTAB_P0,要把所有选项列给用户(用 caption 让人看懂),问完再决定每个字段的 `container` 参数。' +
        '\n\n**新建 / 删除 / 改名 entry / tab 工具之后必调**:验证扩展自建的 entry / tab 已落库或已消失。' +
        '\n\n参数:`formId`(父单据 FormID,必传)+ `extId`(扩展 FID,可选)。传 `extId` 时返回里多出 `extension.entries` / `extension.tabs` / `extension.tabControls` 三个数组,内容来自扩展自身 FKERNELXML。' +
        '\n\n返回:`{ formId, formName, tabs, entries, extension?: { entries, tabs, tabControls } }`。`parentControl` 标识 tab 归属:`FTab` 通常是头部 TabControl,`FTab1` 通常是单据体附属 TabControl。`kind` 是 "entry"(单据体)或 "sub-entry"(子单据体)。',
      parameters: {
        type: 'object',
        properties: {
          formId: {
            type: 'string',
            description: '父单据 FormID,如 "SAL_SaleOrder"、"BD_MATERIAL"。'
          },
          extId: {
            type: 'string',
            description:
              '(可选)扩展 FID。传则在结果里附带扩展自建的 entries / tabs / tabControls(用于新建 / 删除 entry / tab 后验证)。'
          }
        },
        required: ['formId']
      }
    },
    async execute(args) {
      const formId = args.formId;
      if (typeof formId !== 'string' || formId.trim() === '') {
        throw new Error('k3cloud_get_form_layout requires a non-empty `formId` string.');
      }
      // Parent (object + layout) and ext layout are independent — fetch all
      // in parallel so the closure-loop reflection (post-create_entry etc.)
      // doesn't pay sequential round-trip latency.
      const extId = typeof args.extId === 'string' ? args.extId.trim() : '';
      const [obj, layout, extLayout] = await Promise.all([
        c.getObject(formId),
        c.getFormLayout(formId),
        extId ? c.getFormLayout(extId) : Promise.resolve(null),
      ]);
      if (!obj) {
        return JSON.stringify(
          { found: false, formId, message: '单据不存在,先用 k3cloud_search_metadata 确认拼写。' },
          null,
          2
        );
      }
      if (!layout) {
        return JSON.stringify(
          { found: false, formId, message: '取不到父单据 FKERNELXML,无法解析容器目录。' },
          null,
          2
        );
      }
      const result: Record<string, unknown> = {
        found: true,
        formId,
        formName: obj.name,
        tabs: layout.tabs,
        entries: layout.entries,
        hint:
          '用 tabs[*].caption / entries[*].name 给用户列选项,然后把对应的 key 传给 k3cloud_add_fields 每个 field 的 container 参数(头字段 → tab key,单据体字段 → entry key)。'
      };
      if (extId) {
        result.extension = extLayout
          ? {
              extId,
              entries: extLayout.entries,
              tabs: extLayout.tabs,
              tabControls: extLayout.tabControls
            }
          : {
              extId,
              message: '扩展不存在或无 FKERNELXML —— 用 k3cloud_list_extensions 确认 FID 拼写。'
            };
      }
      return JSON.stringify(result, null, 2);
    }
  };
}

// ─── Convert rules (Plan 5.12.4) ────────────────────────────────────────
// Read-only views over BOS bill-conversion rules. Driven by the JSON-emitting
// `ConvertService.GetAllPaths` / `GetConvertRule` endpoints (the sibling
// `GetRuleDatas` / `GetConvertRuleByRunTime` paths return .NET BinaryFormatter
// which Node can't read). See `docs/plans/2026-04-29-plan-5.12.4-...md`.

function listConvertRulesTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_convert_rules',
      description:
        '列出系统配置的所有「单据下推」路径(源单据 → 目标单据)。客户问"X 单可以推到什么"时第一调用。' +
        '\n\n传 `sourceFormId` 过滤(如 "SAL_SaleOrder" 仅列销售订单出发的路径);不传返全量(可能数百条,按需自己过滤)。' +
        '\n\n返回每条路径的 `{sourceFormId, targetFormId, sourceFormName, targetFormName}`。**注意:返回里没有 ruleId** —— BOS 的 ruleId 是业务命名约定(如 `SaleOrder-OutStock`),由 `<SourceShort>-<TargetShort>` 拼出。要看具体规则的字段映射 / 分组 / 公式,用 `k3cloud_describe_convert_rule(ruleId)`。',
      parameters: {
        type: 'object',
        properties: {
          sourceFormId: {
            type: 'string',
            description: '(可选)源单据 FormID。传则只列从该源单出发的路径;不传返全量。'
          }
        }
      }
    },
    async execute(args) {
      const src = typeof args.sourceFormId === 'string' ? args.sourceFormId.trim() : '';
      const paths = await c.listConvertRules(src || undefined);
      return JSON.stringify({ count: paths.length, paths }, null, 2);
    }
  };
}

function describeConvertRuleTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_describe_convert_rule',
      description:
        '读一条转换规则的完整定义并返回**摘要**(原始 240KB JSON 压到 ~5KB,丢弃 Auto 默认字段映射的 noise,保留 Formula 映射 / 聚合映射 / GroupBy / Filter / Plugins / BillTypeMaps)。' +
        '\n\n用法:客户问"销售订单到出库单是怎么映射的""为什么这个字段会被合并""下推前的过滤条件是什么"等具体规则细节时调用。' +
        '\n\n`ruleId` 命名约定 = `<源短名>-<目标短名>`(如 `SaleOrder-OutStock`)。不知道时先 `k3cloud_list_convert_rules` 看一遍 sourceFormId / targetFormId 然后按惯例拼,或者直接问用户在 BOS Designer 里看到的规则名。' +
        '\n\n返回字段:`isDefault` / `isActive` / `convertType`(0=标准/1=反向勾稽) / `defaultConvert.{sourceEntry, targetEntry, fieldMapCount, formulaMaps[], aggregateMaps[]}` / `groupBy.{mode, fields}` / `plugins[]` / `billTypeMaps[]` / `formBusinessServices[]`(表单服务策略,下推后触发的联动服务+前置条件) 等。FormulaMap 的 `formula` 是 IronPython 表达式,客户最关心的就是这个。' +
        '\n\n**扩展信息** `extension.{hasExtends, lineage, originId, isv, isInheritView}`:返回的是「运行时合并视图」,如果客户有 ISV 给这条规则做了扩展,扩展效果已经叠加在 isActive / formulaMaps / 等字段里。`hasExtends: true` 时一定要告诉用户:这条规则被 X 开发商(`isv.name`)定制过,扩展链路 `lineage`,效果已经合并在当前视图里——单独看每条扩展具体改了什么需要在 BOS Designer 里查。',
      parameters: {
        type: 'object',
        properties: {
          ruleId: {
            type: 'string',
            description: '规则业务 ID,如 "SaleOrder-OutStock"。命名规则 `<源短名>-<目标短名>`。'
          }
        },
        required: ['ruleId']
      }
    },
    async execute(args) {
      const ruleId = args.ruleId;
      if (typeof ruleId !== 'string' || ruleId.trim() === '') {
        throw new Error('k3cloud_describe_convert_rule requires a non-empty `ruleId` string.');
      }
      try {
        const summary = await c.describeConvertRule(ruleId.trim());
        return JSON.stringify(summary, null, 2);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // BOS returns response_error when ruleId doesn't exist — surface a
        // clear hint instead of a generic stack so the agent can suggest
        // calling list_convert_rules first.
        if (msg.includes('response_error') || msg.includes('不存在')) {
          return JSON.stringify(
            {
              found: false,
              ruleId,
              message: `规则 ${ruleId} 不存在 —— 用 k3cloud_list_convert_rules 确认源/目标单据,然后按 <源短名>-<目标短名> 命名约定拼 ruleId。`
            },
            null,
            2
          );
        }
        throw err;
      }
    }
  };
}

// ─── Convert rules — write ─────────────────────────────────────────
//
// v0.1 ships baselines for `SaleOrder-OutStock` only — see
// `convert-rule-baselines.ts`. Add more in
// `src/main/erp/k3cloud/rpc/bundled-convert-rule-baselines.ts`.

async function runWithUnsupportedAware<T>(
  fn: () => Promise<T>,
  shape: (result: T) => Record<string, unknown>,
  unsupportedExtras: Record<string, unknown>,
): Promise<string> {
  try {
    return JSON.stringify(shape(await fn()));
  } catch (err) {
    if (err instanceof UnsupportedConvertRuleError) {
      return JSON.stringify({ ok: false, ...unsupportedExtras, message: err.message });
    }
    throw err;
  }
}

function createConvertRuleExtensionTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_create_convert_rule_extension',
      description:
        '在原厂转换规则上**新建一条扩展**(顾问最常做的二开),让客户可以叠加 ISV 自己的字段映射 / 过滤条件 / 分组规则 / 表单插件。' +
        '\n\n调用前提:用户先用 `k3cloud_describe_convert_rule(originRuleId)` 看过当前规则状态(`extension.hasExtends` 可能已经是 true)。然后调本工具创建空扩展,再用后续工具(Plan 5.12.4 v2 Task 3-4)往里加字段映射 / 改策略。' +
        '\n\n**v0.1 重要限制:仅支持 `SaleOrder-OutStock`**(销售订单 → 销售出库单)一条规则。其他规则会报"未支持"错误,需要顾问到 BOS Designer 里手工建,等 v0.2 我们补上通用 XML 序列化器。' +
        '\n\n返回 `{ok, newExtensionId, ...}`,`newExtensionId` 是 32 位 hex GUID,后续 Task 3-4 工具操作扩展时会需要。' +
        '\n\n副作用:服务端建一条新的扩展行(`__rules__[1]` 的 paras.OldId=null + paras.Id=新 GUID,oldIds 不含新 GUID 即代表新建)。**用户在 BOS Designer 里要 F5 刷新或重开客户端才能看到**。',
      parameters: {
        type: 'object',
        properties: {
          originRuleId: {
            type: 'string',
            description: '要扩展的原厂规则 ID,v0.1 只支持 "SaleOrder-OutStock"。'
          },
          displayName: {
            type: 'string',
            description: '(可选)扩展的中文显示名。BOS Designer 默认是"转换规则",可以让 LLM 起一个更具体的名字(如"加客户分组的 SO 转 OUT")。'
          }
        },
        required: ['originRuleId']
      }
    },
    async execute(args) {
      const originRuleId = args.originRuleId;
      if (typeof originRuleId !== 'string' || originRuleId.trim() === '') {
        throw new Error('k3cloud_create_convert_rule_extension requires a non-empty `originRuleId` string.');
      }
      const displayName =
        typeof args.displayName === 'string' && args.displayName.trim() !== ''
          ? args.displayName.trim()
          : undefined;
      const trimmed = originRuleId.trim();
      return runWithUnsupportedAware(
        () => c.extendConvertRule(trimmed, displayName),
        (result) => ({
          ok: result.ok,
          newExtensionId: result.newExtensionId,
          originRuleId: trimmed,
          message: result.ok
            ? `扩展已创建,新扩展 ID = ${result.newExtensionId}。请用户在 BOS Designer 里 F5 刷新(或关闭客户端重登)以看到新扩展。`
            : `服务端返回非空响应,可能未成功:${result.raw.slice(0, 200)}`
        }),
        { originRuleId: trimmed }
      );
    }
  };
}

function deleteConvertRuleExtensionTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_delete_convert_rule_extension',
      description:
        '删除原厂转换规则上的一条**扩展**。删除是把扩展从 `__rules__` 数组移除但保留在 `__oldIds__` —— 服务端会按差集语义清掉对应行。' +
        '\n\n调用场景:顾问试错后想回滚某条扩展,或者扩展用错了 ISV 想重建。' +
        '\n\n**v0.1 重要限制:仅支持 `SaleOrder-OutStock`** 一条规则。' +
        '\n\n参数:`originRuleId` 是原厂规则 ID(目前只能是 "SaleOrder-OutStock"),`extId` 是要删的扩展 GUID(`k3cloud_describe_convert_rule.extension.lineage` 里能看到链路)。',
      parameters: {
        type: 'object',
        properties: {
          originRuleId: {
            type: 'string',
            description: '扩展所在的原厂规则 ID,v0.1 只支持 "SaleOrder-OutStock"。'
          },
          extId: {
            type: 'string',
            description: '要删除的扩展 GUID(从 `k3cloud_describe_convert_rule.extension.lineage` 里取)。'
          }
        },
        required: ['originRuleId', 'extId']
      }
    },
    async execute(args) {
      const originRuleId = args.originRuleId;
      const extId = args.extId;
      if (typeof originRuleId !== 'string' || originRuleId.trim() === '') {
        throw new Error('k3cloud_delete_convert_rule_extension requires a non-empty `originRuleId` string.');
      }
      if (typeof extId !== 'string' || extId.trim() === '') {
        throw new Error('k3cloud_delete_convert_rule_extension requires a non-empty `extId` string.');
      }
      const trimmedRule = originRuleId.trim();
      const trimmedExt = extId.trim();
      return runWithUnsupportedAware(
        () => c.deleteConvertRuleExtension(trimmedRule, trimmedExt),
        (result) => ({
          ok: result.ok,
          originRuleId: trimmedRule,
          extId: trimmedExt,
          message: result.ok
            ? `扩展 ${trimmedExt} 已删除。请用户在 BOS Designer 里 F5 刷新(或关闭客户端重登)以确认。`
            : `服务端返回非空响应,可能未成功:${result.raw.slice(0, 200)}`
        }),
        { originRuleId: trimmedRule, extId: trimmedExt }
      );
    }
  };
}

// ── Convert-rule write tools ──────────────────────────────────────────────────

function addConvertFieldMappingTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_add_convert_field_mapping',
      description:
        '在已建的转换规则扩展上**增加一条字段映射**。支持直接字段取值(`sourceFieldKey + mode=Auto/Sum/...`)和 IronPython 公式映射(`formula + mode=Formula`)两种形式。' +
        '\n\n**能力边界**:本工具只在父规则的 DefaultConvertPolicy 层(头→头 / 标准 sourceEntry→targetEntry)做映射,K/3 标准转换规则只支持 1 主关联实体。跨 entry 携带(自建 entry 之间 / 子单据体↔单据体)是 BOS 平台限制不在范围内 — **工具内部对 entry 一致性做了校验,不一致的调用返回 `entry_mismatch` 并 hint 转向 `k3cloud_add_convert_plugin`**(注册 PythonConvertPlugIn,在 `AfterConvert(e)` 事件里通过 `BusinessDataServiceHelper.LoadSingle` 取源单完整 DynamicObject 后写入目标单据体)。' +
        '\n\n前提:已通过 `k3cloud_create_convert_rule_extension` 建立了扩展(v0.1 仅支持 SaleOrder-OutStock)。工具会读取 OpenDeploy 本地保存的扩展 XML 状态,通过 .NET 桥修改后重新保存到服务端。' +
        '\n\n`targetEntryKey` 指定要操作的 DefaultConvertPolicy 层(SaleOrder-OutStock 典型值 `FEntity` = 行体层;不传则操作头体层)。' +
        '\n\n`mode` 枚举:Auto / Sum / Average / Count / Max / Min / Formula / Join / SumFormula。常用:Auto(直接取值) / Sum(合并求和) / Formula(IronPython 公式)。' +
        '\n\n**保存成功后**:请让用户关闭客户端整个重登才能看到新字段映射(BOS 客户端有缓存)。',
      parameters: {
        type: 'object',
        properties: {
          extId: {
            type: 'string',
            description: '扩展的 GUID(从 `k3cloud_create_convert_rule_extension` 的 `newExtensionId` 取)。'
          },
          targetFieldKey: {
            type: 'string',
            description: '目标单据(下推目标)的字段 Key,如 "FOutQty"。'
          },
          sourceFieldKey: {
            type: 'string',
            description: '来源单据的字段 Key,如 "FQty"。mode=Formula 时可传空字符串或省略,公式里自己引用字段。'
          },
          mode: {
            type: 'string',
            description: '取值模式:Auto(直取) / Sum(求和) / Average / Count / Max / Min / Formula(公式) / Join / SumFormula。默认 Auto。'
          },
          formula: {
            type: 'string',
            description: '(可选)当 mode=Formula 时的 IronPython 表达式。'
          },
          targetEntryKey: {
            type: 'string',
            description: '(可选)目标层 DefaultConvertPolicy 的 TargetEntryKey。SaleOrder-OutStock 行体层传 "FEntity";头体层不传。'
          }
        },
        required: ['extId', 'targetFieldKey', 'sourceFieldKey']
      }
    },
    async execute(args) {
      const extId = args.extId;
      const targetFieldKey = args.targetFieldKey;
      const sourceFieldKey = args.sourceFieldKey;
      if (typeof extId !== 'string' || extId.trim() === '') {
        throw new Error('k3cloud_add_convert_field_mapping requires a non-empty `extId` string.');
      }
      if (typeof targetFieldKey !== 'string' || targetFieldKey.trim() === '') {
        throw new Error('k3cloud_add_convert_field_mapping requires a non-empty `targetFieldKey` string.');
      }
      const mode = typeof args.mode === 'string' && args.mode.trim() !== '' ? args.mode.trim() : 'Auto';
      const formula = typeof args.formula === 'string' && args.formula.trim() !== '' ? args.formula.trim() : undefined;
      const targetEntryKey = typeof args.targetEntryKey === 'string' && args.targetEntryKey.trim() !== '' ? args.targetEntryKey.trim() : undefined;
      const sourceField = typeof sourceFieldKey === 'string' ? sourceFieldKey.trim() : '';

      // Entry-consistency validation. K/3 standard convert rules support only
      // 1 main link entity (header→header + 1 sourceEntry→1 targetEntry).
      // Mapping a field whose source/target entry doesn't match any of the
      // origin rule's DefaultConvertPolicy mount points will silently fail
      // at runtime (no data carried over) or throw at the bridge. Reject up
      // front and point the agent at the convert-plugin escape hatch.
      //
      // Skipped when source field is empty (formula-only mappings reference
      // fields by name inside IronPython, can't be statically resolved).
      if (sourceField !== '' && mode !== 'Formula') {
        const validation = await validateEntryConsistency(c, extId.trim(), sourceField, targetFieldKey.trim(), targetEntryKey);
        if (!validation.ok) {
          return JSON.stringify({
            ok: false,
            reason: 'entry_mismatch',
            message: validation.message,
            hint:
              '这是 BOS 平台限制(只允许主单据体做映射),不是产品 bug — 自定义/其他单据体的字段携带必须写转换插件。' +
              '\n\n步骤:' +
              '\n1. 用 `k3cloud_add_convert_plugin` 注册一个 PythonConvertPlugIn(pyScript 参数填 IronPython 源码,className 填短标识符如 "PAIJEntryCarrier")。' +
              '\n2. 插件实现 `def AfterConvert(e):` 函数(不是 OnAfterCreateLink),里面通过 `BusinessDataServiceHelper.LoadSingle(e.Context, sBillId, e.SourceBusinessInfo.GetDynamicObjectType())` 取源单完整 DynamicObject。' +
              '\n3. 源单 ID 来自目标主单据体行的 `FEntity_Link[0]["SBillId"]`(或目标单据 EntryName 对应的 link 列)。' +
              '\n4. 用 `Entity.EntryName`(不是 metadata Key)作为属性名访问 entry 的 DynamicObjectCollection,逐行写入。' +
              '\n\n**关键注意**:' +
              '\n- 必须 `clr.AddReference("Kingdee.BOS.DataEntity")` 和 `clr.AddReference("Kingdee.BOS.ServiceHelper")` —— 这两个类不在 Kingdee.BOS.dll 里。' +
              '\n- 不要用 SQL `DBServiceHelper.ExecuteDynamicObject` 查源表 —— 列名易猜错,走 LoadSingle 接口。' +
              '\n\n完整骨架(已客户环境实证)与基类反编译细节:`load_skill_file("k3cloud/bos-features-index", "references/multi-entry-convert-via-plugin")`。',
            detected: validation.detected,
          });
        }
      }

      const result = await c.addConvertFieldMapping(
        extId.trim(),
        targetFieldKey.trim(),
        sourceField,
        mode,
        formula,
        targetEntryKey,
      );
      return JSON.stringify({
        ok: result.ok,
        extId: extId.trim(),
        targetFieldKey: targetFieldKey.trim(),
        message: result.ok
          ? `字段映射 ${targetFieldKey.trim()} ← ${formula ?? sourceFieldKey} 已添加。请让用户关闭客户端重登以确认(BOS 客户端有缓存)。`
          : `服务端返回非空响应,可能未成功:${result.raw.slice(0, 200)}`
      });
    }
  };
}

/**
 * Pre-flight check for `k3cloud_add_convert_field_mapping`.
 *
 * Walks the origin rule's DefaultConvertPolicy list (head + each entry pair),
 * resolves source / target field's actual entry from form metadata, and
 * verifies an exact (sourceEntry, targetEntry) pair exists. Returns a
 * structured failure when no match — the caller turns this into an
 * `entry_mismatch` tool result with a hint pointing at add_convert_plugin.
 *
 * Header field convention: K/3's parseFieldsFromKernelXml sets
 * `isEntryField: false` and `entryKey: undefined` for header fields; we
 * normalize to `''` here to align with how header DCPs encode their
 * SourceEntryKey / TargetEntryKey ('' for header).
 */
async function validateEntryConsistency(
  c: K3CloudConnector,
  extId: string,
  sourceFieldKey: string,
  targetFieldKey: string,
  requestedTargetEntryKey: string | undefined,
): Promise<{
  ok: boolean;
  message?: string;
  detected: {
    sourceField: string;
    sourceEntry: string;
    targetField: string;
    targetEntry: string;
    requestedTargetEntryKey: string | undefined;
    rulePolicies: Array<{ sourceEntry: string; targetEntry: string }>;
  };
}> {
  const dcps = await c.describeOriginRuleDcps(extId);
  const [sourceFields, targetFields] = await Promise.all([
    c.getFields(dcps.sourceFormId),
    c.getFields(dcps.targetFormId),
  ]);

  const sourceFieldMeta = sourceFields.find((f) => f.key === sourceFieldKey);
  const targetFieldMeta = targetFields.find((f) => f.key === targetFieldKey);

  // Field unknown to source / target form: don't block — could be an
  // extension field not yet refreshed in metadata cache, or the agent typed
  // a field key we just created. Server-side will surface real errors.
  if (!sourceFieldMeta || !targetFieldMeta) {
    return {
      ok: true,
      detected: {
        sourceField: sourceFieldKey,
        sourceEntry: sourceFieldMeta?.entryKey ?? '',
        targetField: targetFieldKey,
        targetEntry: targetFieldMeta?.entryKey ?? '',
        requestedTargetEntryKey,
        rulePolicies: dcps.policies,
      },
    };
  }

  const sourceEntry = sourceFieldMeta.isEntryField ? sourceFieldMeta.entryKey ?? '' : '';
  const targetEntry = targetFieldMeta.isEntryField ? targetFieldMeta.entryKey ?? '' : '';

  const matched = dcps.policies.find((p) => p.sourceEntry === sourceEntry && p.targetEntry === targetEntry);
  if (matched) {
    return {
      ok: true,
      detected: {
        sourceField: sourceFieldKey,
        sourceEntry,
        targetField: targetFieldKey,
        targetEntry,
        requestedTargetEntryKey,
        rulePolicies: dcps.policies,
      },
    };
  }

  const formatEntry = (e: string) => (e === '' ? '(头层)' : e);
  const policiesDesc = dcps.policies
    .map((p) => `${formatEntry(p.sourceEntry)} → ${formatEntry(p.targetEntry)}`)
    .join(' / ');

  return {
    ok: false,
    message:
      `源字段 ${sourceFieldKey} 在 ${formatEntry(sourceEntry)},` +
      `目标字段 ${targetFieldKey} 在 ${formatEntry(targetEntry)}。` +
      `K/3 标准转换规则(${dcps.originRuleId})只在以下层做映射:${policiesDesc}。` +
      `当前组合不在标准 DefaultConvertPolicy 集合内,标准产品携带不到目标 entry。`,
    detected: {
      sourceField: sourceFieldKey,
      sourceEntry,
      targetField: targetFieldKey,
      targetEntry,
      requestedTargetEntryKey,
      rulePolicies: dcps.policies,
    },
  };
}

function setConvertGroupByTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_set_convert_groupby',
      description:
        '设置转换规则扩展的**合并方案(GroupBy)**。控制下推时多条来源单据行如何合并为目标单据行。' +
        '\n\n`mode` 枚举:None(一对一不合并) / OneToOne(一对一) / GroupByField(按字段分组) / GroupByFormula(按公式分组)。' +
        '\n\nGroupByField 时传 `field1..field3`;GroupByFormula 时传 `formula`。' +
        '\n\n**保存成功后**:请让用户关闭客户端整个重登以确认(BOS 客户端有缓存)。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展的 GUID。' },
          mode: {
            type: 'string',
            description: 'GroupBy 模式:None / OneToOne / GroupByField / GroupByFormula。'
          },
          field1: { type: 'string', description: '(GroupByField 时)第一个分组字段 Key。' },
          field2: { type: 'string', description: '(GroupByField 时)第二个分组字段 Key。' },
          field3: { type: 'string', description: '(GroupByField 时)第三个分组字段 Key。' },
          formula: { type: 'string', description: '(GroupByFormula 时)IronPython 公式。' }
        },
        required: ['extId', 'mode']
      }
    },
    async execute(args) {
      const extId = args.extId as string;
      const mode = args.mode as string;
      if (!extId?.trim()) throw new Error('extId is required');
      if (!mode?.trim()) throw new Error('mode is required');
      const result = await c.setConvertGroupBy(
        extId.trim(), mode.trim(),
        typeof args.field1 === 'string' ? args.field1 : undefined,
        typeof args.field2 === 'string' ? args.field2 : undefined,
        typeof args.field3 === 'string' ? args.field3 : undefined,
        typeof args.formula === 'string' ? args.formula : undefined,
      );
      return JSON.stringify({
        ok: result.ok,
        message: result.ok
          ? `GroupBy 已设为 ${mode}。请让用户关闭客户端重登以确认。`
          : `服务端返回非空响应:${result.raw.slice(0, 200)}`
      });
    }
  };
}

function setConvertFilterTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_set_convert_filter',
      description:
        '设置转换规则扩展的**过滤条件**——alert 提示文案 和/或 IronPython 过滤表达式。' +
        '\n\n`alertMessage`:用户尝试下推时若不满足条件显示的提示文字。' +
        '\n\n`custFilter`:IronPython 布尔表达式,返回 False 则阻止下推该行。' +
        '\n\n两个参数至少传一个。**保存成功后**:请让用户关闭客户端整个重登以确认。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展的 GUID。' },
          alertMessage: { type: 'string', description: '(可选)下推阻止时的提示文案。' },
          custFilter: { type: 'string', description: '(可选)IronPython 布尔过滤表达式。' }
        },
        required: ['extId']
      }
    },
    async execute(args) {
      const extId = args.extId as string;
      if (!extId?.trim()) throw new Error('extId is required');
      const alertMessage = typeof args.alertMessage === 'string' ? args.alertMessage : undefined;
      const custFilter = typeof args.custFilter === 'string' ? args.custFilter : undefined;
      if (!alertMessage && !custFilter) throw new Error('at least one of alertMessage or custFilter is required');
      const result = await c.setConvertFilter(extId.trim(), alertMessage, custFilter);
      return JSON.stringify({
        ok: result.ok,
        message: result.ok
          ? '过滤条件已设置。请让用户关闭客户端重登以确认。'
          : `服务端返回非空响应:${result.raw.slice(0, 200)}`
      });
    }
  };
}

function addConvertPluginTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_add_convert_plugin',
      description:
        '向转换规则扩展的**插件策略**注册一个转换插件(DLL 或 Python)。' +
        '\n\n**DLL 模式**:只填 `className`(完整类名 + 程序集,如 `Kingdee.K3.SCM.App.ConvertPlugIn.MyConvertSrv, Kingdee.K3.SCM.App`)。wire 不写 `<PlugInType>`,服务端走 DLL 路径加载已部署的程序集。' +
        '\n\n**Python 模式**:同时填 `className`(短标识符即可,用户能识别即可)和 `pyScript`(IronPython 源码,定义 `OnAfterCreateLink` / `OnAfterFieldMapping` / `OnAfterConvert` 等 22 个虚方法的子集)。wire 加 `<PlugInType>1</PlugInType>` + `<PyScript>...</PyScript>`,服务端 `PythonConvertPlugIn` 通过 IronPython 引擎执行,**能力跟 DLL 等价**。Python 脚本里可以 `clr.AddReference("Kingdee.BOS")` 后 import `BusinessDataServiceHelper` / `QueryServiceHelper` / `BusinessFlowServiceHelper` 等服务端 API,`self.Context` 等实例属性已绑入 scope。' +
        '\n\n**建议传 description**:它会显示在 BOS Designer 转换规则插件列表的"描述"列,让用户在 Designer 里能识别这条插件做什么(如"销售订单到出库单的多单据体携带 Python 插件")。不传的话列表那一列空白,用户难以维护。' +
        '\n\n幂等——className 已注册则跳过。**保存成功后**:请让用户关闭客户端整个重登以确认。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展的 GUID。' },
          className: { type: 'string', description: 'DLL 模式填 `命名空间.类名, 程序集名`;Python 模式填短标识符即可。' },
          pyScript: {
            type: 'string',
            description: '可选,IronPython 源码。给则注册为 Python 转换插件(PlugInType=1),不给则注册为 DLL 转换插件(PlugInType 缺省 0)。'
          },
          description: {
            type: 'string',
            description: '可选,插件用途描述,显示在 BOS Designer 转换规则插件列表的"描述"列。建议传中文说明(如"销售订单到出库单的多单据体携带 Python 插件"),让用户在 BOS Designer 里能识别这条插件做什么。'
          }
        },
        required: ['extId', 'className']
      }
    },
    async execute(args) {
      const extId = args.extId as string;
      const className = args.className as string;
      const rawPyScript = typeof args.pyScript === 'string' ? args.pyScript : undefined;
      const pyScript = rawPyScript && rawPyScript.length > 0 ? rawPyScript : undefined;
      const rawDescription = typeof args.description === 'string' ? args.description.trim() : '';
      const description = rawDescription.length > 0 ? rawDescription : undefined;
      if (!extId?.trim()) throw new Error('extId is required');
      if (!className?.trim()) throw new Error('className is required');
      const result = await c.addConvertPlugin(extId.trim(), className.trim(), pyScript, description);
      const mode = pyScript ? 'Python 转换插件' : 'DLL 转换插件';
      return JSON.stringify({
        ok: result.ok,
        message: result.ok
          ? `${mode} ${className} 已注册。请让用户关闭客户端重登以确认。`
          : `服务端返回非空响应:${result.raw.slice(0, 200)}`
      });
    }
  };
}

function removeConvertPluginTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_remove_convert_plugin',
      description:
        '从转换规则扩展的**插件策略**移除一个 DLL 服务插件类。幂等——不存在则跳过。' +
        '\n\n**保存成功后**:请让用户关闭客户端整个重登以确认。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展的 GUID。' },
          className: { type: 'string', description: '要移除的 DLL 插件完整类名。' }
        },
        required: ['extId', 'className']
      }
    },
    async execute(args) {
      const extId = args.extId as string;
      const className = args.className as string;
      if (!extId?.trim()) throw new Error('extId is required');
      if (!className?.trim()) throw new Error('className is required');
      const result = await c.removeConvertPlugin(extId.trim(), className.trim());
      return JSON.stringify({
        ok: result.ok,
        message: result.ok
          ? `插件 ${className} 已移除。请让用户关闭客户端重登以确认。`
          : `服务端返回非空响应:${result.raw.slice(0, 200)}`
      });
    }
  };
}

function addConvertBillTypeMapTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_add_convert_bill_type_map',
      description:
        '向转换规则扩展的**单据类型映射**添加一条来源→目标的单据类型配对。' +
        '\n\n用于控制只有特定单据类型的来源单才能下推为特定类型的目标单。空字符串表示"任意类型"(`(All)`)。' +
        '\n\n幂等——相同映射已存在则跳过。**保存成功后**:请让用户关闭客户端整个重登以确认。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展的 GUID。' },
          sourceBillTypeId: {
            type: 'string',
            description: '来源单据类型 ID(空字符串=任意)。'
          },
          targetBillTypeId: {
            type: 'string',
            description: '目标单据类型 ID(空字符串=任意)。'
          }
        },
        required: ['extId', 'sourceBillTypeId', 'targetBillTypeId']
      }
    },
    async execute(args) {
      const extId = args.extId as string;
      const src = typeof args.sourceBillTypeId === 'string' ? args.sourceBillTypeId : '';
      const tgt = typeof args.targetBillTypeId === 'string' ? args.targetBillTypeId : '';
      if (!extId?.trim()) throw new Error('extId is required');
      const result = await c.addConvertBillTypeMap(extId.trim(), src, tgt);
      return JSON.stringify({
        ok: result.ok,
        message: result.ok
          ? `单据类型映射 ${src || '(All)'} → ${tgt || '(All)'} 已添加。请让用户关闭客户端重登以确认。`
          : `服务端返回非空响应:${result.raw.slice(0, 200)}`
      });
    }
  };
}
