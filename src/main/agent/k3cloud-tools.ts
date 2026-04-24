import { getActiveConnector, getConnectionState } from '../erp/active';
import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';

/**
 * Build the K/3 Cloud tool set for the current active project. Returns an
 * empty array when no project is connected — the agent then sees no kingdee_*
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
    searchMetadataTool(c)
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
    database: c.config.database,
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
      name: 'kingdee_list_objects',
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
            description: '限定到某个子系统（模块）。通过 kingdee_list_subsystems 获取。'
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
      name: 'kingdee_get_object',
      description:
        '按精确 FormID 获取 K/3 Cloud 业务对象的头部信息（modelType / 子系统 / 最后修改时间）。FormID 不确定时先调 kingdee_list_objects 或 kingdee_search_metadata。',
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
        throw new Error('kingdee_get_object requires a non-empty `id` string.');
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
      name: 'kingdee_get_fields',
      description:
        '获取 K/3 Cloud 业务对象的字段清单 —— **只查父对象的原厂字段, 不包括扩展字段**。默认只返 key 列表(轻量);用 keyword 过滤到具体字段、或 includeDetail:true 获取全部字段的 ElementType / entryKey 详情。验证扩展上新加的字段请用 kingdee_get_extension_fields。',
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
        throw new Error('kingdee_get_fields requires a non-empty `formId` string.');
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
              'object not found. Run kingdee_search_metadata first if you are unsure of the id.'
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
      name: 'kingdee_list_subsystems',
      description:
        '列出 K/3 Cloud 子系统（销售 / 采购 / 库存 / 财务 等模块）。用于给 kingdee_list_objects 的 subsystemId 参数取值。',
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
      name: 'kingdee_search_metadata',
      description:
        '按关键字模糊搜索 K/3 Cloud 元数据（跨 FormID + 显示名）。与 kingdee_list_objects 类似但限制更小、返回更少；适合"我想找这个单据是什么 ID"这类场景。',
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
        throw new Error('kingdee_search_metadata requires a non-empty `keyword` string.');
      }
      const rows = await c.searchMetadata(keyword);
      return JSON.stringify({ count: rows.length, matches: rows }, null, 2);
    }
  };
}
