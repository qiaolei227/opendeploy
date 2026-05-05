import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';
import {
  SERVICE_META_SCHEMAS,
  UNSUPPORTED_ACTION_ID_MESSAGE
} from '../erp/k3cloud/business-rule-schemas';

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
        '按 ruleId 删除扩展上的业务规则。自动判断是 EntityServiceRule 还是字段 UpdateAction。注意：v0.1 字段级 UpdateAction 删除会抛 deferred-to-Task-3.5 错误。写路径，触发 SaveForIDEV9。',
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
            type: 'number',
            description:
              'BOS service ActionId — 见 EntityServiceRule.services[].actionId 或字段 UpdateAction.actionId。'
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
          { found: false, actionId, message: UNSUPPORTED_ACTION_ID_MESSAGE },
          null,
          2
        );
      }
      return JSON.stringify({ found: true, actionId, ...schema }, null, 2);
    }
  };
}
