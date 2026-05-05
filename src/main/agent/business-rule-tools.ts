import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';

/**
 * Static parameter schemas for the BOS service classes referenced by
 * EntityServiceRule / field UpdateAction entries. v0.1 covers the two
 * ActionIds we actively support in add-tools (Task 3.3 / 3.5):
 *
 *   - 2  → FormBusinessService (Calculate, IronPython 赋值)
 *   - 67 → GetInvStockBusinessServiceMeta (查可用库存)
 *
 * The agent reads these prose descriptions to construct correct service
 * `parameters` payloads; this is not a strict JSON Schema, so e.g.
 * `'string[]'` lives as a free-form type string. Other ActionIds
 * (3 / 23 / 42 / 70 …) are scope-cut to v0.2.
 */
const SERVICE_META_SCHEMAS: Record<
  number,
  {
    className: string;
    description: string;
    properties: Record<string, { type: string; default?: string; description: string }>;
  }
> = {
  2: {
    className: 'FormBusinessService',
    description: 'Calculate — IronPython 赋值表达式',
    properties: {
      parameters: {
        type: 'string[]',
        description: 'IronPython 赋值数组，如 [" F金额 = F数量 * F单价 "]'
      }
    }
  },
  67: {
    className: 'GetInvStockBusinessServiceMeta',
    description: 'GetInvStock — 查可用库存',
    properties: {
      stockQtyField: { type: 'string', default: 'FInvQty', description: '库存数量目标字段' },
      awaitQtyField: { type: 'string', default: 'FAwaitQty', description: '在途数量目标字段' },
      availableQtyField: { type: 'string', default: 'FAvbQty', description: '可用数量目标字段' },
      deliQtyFrom: {
        type: 'string',
        default: 'SAL_DELIVERYNOTICE',
        description: '在途来源单据'
      },
      deliQtyBillStatus: { type: 'string', default: 'SAVE', description: '在途单据状态' },
      stockOrgField: { type: 'string', default: 'FSTOCKORGID', description: '库存组织字段' },
      keeperTypeField: { type: 'string', default: 'FKEEPERTYPEID', description: '保管者类型字段' },
      keeperField: { type: 'string', default: 'FKEEPERID', description: '保管者字段' },
      ownerTypeField: { type: 'string', default: 'FOWNERTYPEID', description: '货主类型字段' },
      ownerField: { type: 'string', default: 'FOWNERID', description: '货主字段' },
      stockField: { type: 'string', default: 'FSTOCKID', description: '仓库字段' },
      stockPlaceField: { type: 'string', default: 'FSTOCKLOCID', description: '仓位字段' },
      materialField: { type: 'string', default: 'FMATERIALID', description: '物料字段' },
      // wire 实证补充字段
      extAuxQtyField: { type: 'string', description: '辅助数量字段' },
      returnQtyField: { type: 'integer', description: '是否返回数量（1=返回）' },
      pluginClassName: { type: 'string', description: '自定义插件类名' },
      stockStatusField: { type: 'string', description: '库存状态字段' },
      projectNoField: { type: 'string', description: '项目编号字段' },
      secUnitIdField: { type: 'string', description: '辅助单位字段' },
      extAuxUnitIdField: { type: 'string', description: '辅助单位 ID 字段' }
    }
  }
};

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`${key} 必填，且不能为空字符串`);
  }
  return v.trim();
}

export function listBusinessRulesTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_business_rules',
      description:
        '列出指定 BOS 扩展上的所有业务规则 — 实体级 EntityServiceRule（含 services 列表）+ 字段级 UpdateActions。读路径，不改 DB。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展对象的 FID（GUID）。'
          }
        },
        required: ['extensionFid']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const result = await c.listBusinessRules(extensionFid);
      return JSON.stringify(result, null, 2);
    }
  };
}

export function deleteBusinessRuleTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_delete_business_rule',
      description:
        '按 ruleId 删除扩展上的业务规则。自动判断是 EntityServiceRule 还是字段 UpdateAction。写路径，触发 SaveForIDEV9。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展对象的 FID（GUID）。'
          },
          ruleId: {
            type: 'string',
            description: '规则 GUID — EntityServiceRule.ruleId 或字段 UpdateAction.serviceId。'
          }
        },
        required: ['extensionFid', 'ruleId']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const ruleId = requireString(args, 'ruleId');
      const result = await c.removeBusinessRule(extensionFid, ruleId);
      return JSON.stringify(result, null, 2);
    }
  };
}

export function describeServiceMetaTool(): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_describe_service_meta',
      description:
        '查询某 ActionId 对应 BOS service 类的参数 schema（字段映射默认值 / 类型 / 描述）。v0.1 支持 2 (Calculate) 和 67 (GetInvStock)。',
      parameters: {
        type: 'object',
        properties: {
          actionId: {
            type: 'integer',
            description: 'BOS service ActionId — 见 EntityServiceRule.services[].actionId 或字段 UpdateAction.actionId。'
          }
        },
        required: ['actionId']
      }
    },
    async execute(args) {
      const actionId = args.actionId;
      if (typeof actionId !== 'number' || !Number.isFinite(actionId)) {
        throw new Error('actionId 必填，且必须是数字');
      }
      const schema = SERVICE_META_SCHEMAS[actionId];
      if (!schema) {
        return JSON.stringify(
          {
            error:
              'v0.1 仅支持 ActionId 2 (Calculate) 和 67 (GetInvStock)。其他 ActionId (3/23/42/70 等) 留 v0.2，可用 k3cloud_register_plugin 写 Python 插件作为替代。'
          },
          null,
          2
        );
      }
      return JSON.stringify({ actionId, ...schema }, null, 2);
    }
  };
}
