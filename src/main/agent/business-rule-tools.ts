import { randomUUID } from 'node:crypto';
import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';
import {
  SERVICE_META_SCHEMAS,
  UNSUPPORTED_ACTION_ID_MESSAGE
} from '../erp/k3cloud/business-rule-schemas';
import { validateFieldExistence } from './validators/field-existence';
import { validateCalculateRule } from './validators/calculate-rule';

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

/**
 * Plan 5.12.3b Task 3.3 — add an entity-level GetInvStock (ActionId 67)
 * business rule onto a BOS extension.
 *
 * Why a dedicated tool instead of a generic "add entity service rule":
 *   - Each ActionId has its own property schema (`SERVICE_META_SCHEMAS`),
 *     and BOS rejects rules whose properties don't match the class's
 *     reflection. A typed tool surface lets the LLM see the right knobs in
 *     its system prompt rather than blindly populating a free-form bag.
 *   - GetInvStock + Calculate are the two ActionIds covered in v0.1
 *     (recon at `docs/recon/business-rule-wire-format.md`); other classes
 *     stay deferred to v0.2.
 *
 * Pre-flight checks:
 *   1. `description` / `preCondition` non-empty (BOS Designer enforces this).
 *   2. Every string-valued property the agent passed must reference a real
 *      field — we merge the extension's delta-fields with the parent form's
 *      original fields and run `validateFieldExistence`. Unknown fields come
 *      back with Levenshtein-ranked "did you mean" suggestions.
 *   3. Properties whose value equals the schema default are dropped from the
 *      wire payload — the server fills them in itself, sending the default
 *      bloats the overlay XML for no benefit.
 *
 * GUID conventions match Task 3.1's spike: rule id stays dashed, service id
 * is 32-hex without dashes.
 */
export function addGetInvStockRuleTool(c: K3CloudConnector): ToolHandler {
  const schema = SERVICE_META_SCHEMAS[67];
  const propsSchema = schema.properties;

  // Build the agent-facing `parameters` schema declaratively from the static
  // service-meta schema. Each property becomes a string/number param with the
  // recon-sourced description; `default` shows in the description so the LLM
  // can decide whether overriding is needed without a separate
  // describe_service_meta call.
  const dynamicProps: Record<string, { type: string; description: string }> = {};
  for (const [key, def] of Object.entries(propsSchema)) {
    const baseType = def.type === 'number' ? 'number' : 'string';
    const desc = def.default
      ? `${def.description}（默认 "${def.default}"，仅在与默认不同时传）`
      : def.description;
    dynamicProps[key] = { type: baseType, description: desc };
  }

  return {
    definition: {
      name: 'k3cloud_add_get_inv_stock_rule',
      description:
        '在 BOS 扩展的实体级（HeadEntity）上加一条 GetInvStock（查可用库存，ActionId 67）业务规则。' +
        '\n\n用途：当用户保存单据或在编辑时触发，按"物料 + 仓库 + 库存组织 ..."等键查询当前可用库存，把可用 / 在途 / 总量回填到指定字段。' +
        '\n\n**规则前提**：BOS Designer 强制实体服务规则必须有非空 preCondition（IronPython 布尔表达式，决定何时触发）。' +
        '\n\n**字段映射**：默认值与原厂表字段一致（FInvQty / FAwaitQty / FAvbQty / FSTOCKID / FMATERIALID 等）。仅在用户用了非默认字段名（多见于扩展自建库存字段）时显式传新值——参数描述里有默认值标注。' +
        '\n\n**字段存在校验**：工具会反查扩展自身的 delta 字段 + 父对象原厂字段，agent 传的所有字符串字段必须真实存在；不存在则返回 `{found: false, errors: [{field, suggestions}]}`，suggestions 是 Levenshtein 最近匹配。' +
        '\n\n**写路径**：通过 SaveForIDEV9 落库，扩展会被服务端校验。**保存成功后**：请让用户关闭客户端整个重登才能看到新规则触发（BOS 客户端有缓存）。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展对象的 FID（GUID，32 位 hex 或带连字符）。'
          },
          description: {
            type: 'string',
            description: '规则中文名 / 用途描述，会显示在 BOS Designer 业务规则列表里。必填非空。'
          },
          preCondition: {
            type: 'string',
            description:
              'IronPython 布尔表达式，BOS 会在保存 / 编辑触发点 evaluate 它，true 才执行规则。必填非空。' +
              "示例：`FBillTypeID.FNumber == '01.01'` / `FCustId.FNumber != \"\"` / `True`（永远触发）。"
          },
          preConditionDesc: {
            type: 'string',
            description: '（可选）前置条件中文描述，给客户在 BOS Designer 里能看懂何时触发。'
          },
          ...dynamicProps
        },
        required: ['extensionFid', 'description', 'preCondition']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const description = requireString(args, 'description');
      const preCondition = requireString(args, 'preCondition');
      const preConditionDesc =
        typeof args.preConditionDesc === 'string' && args.preConditionDesc.trim() !== ''
          ? args.preConditionDesc.trim()
          : undefined;

      // Resolve parent form from extension to load its field schema.
      const ext = await c.getObject(extensionFid);
      if (!ext) {
        return JSON.stringify(
          {
            found: false,
            extensionFid,
            message: `扩展 ${extensionFid} 不存在 — 检查 FID 拼写，或先用 k3cloud_list_extensions 找一下。`
          },
          null,
          2
        );
      }
      if (!ext.baseObjectId) {
        return JSON.stringify(
          {
            found: false,
            extensionFid,
            message: `扩展 ${extensionFid} 缺少 BaseObjectId — 不是有效的 BOS 扩展。`
          },
          null,
          2
        );
      }

      // Load both extension delta-fields and parent original-fields.
      // Business rule properties may reference either source.
      const [extFields, parentFields] = await Promise.all([
        c.getFields(extensionFid),
        c.getFields(ext.baseObjectId)
      ]);
      const knownFieldKeys = Array.from(
        new Set([
          ...extFields.map((f) => f.key),
          ...parentFields.map((f) => f.key)
        ])
      );

      // Collect string-typed property values the agent supplied that exist
      // in the schema. Skip non-string values (number / undefined) — only
      // string properties carry field references. Properties NOT in the
      // schema are silently dropped (typo-tolerant); fields the LLM might
      // mis-type are caught one layer up by the existence check.
      const referenced: string[] = [];
      const userProperties: Record<string, unknown> = {};
      for (const [k, def] of Object.entries(propsSchema)) {
        const v = (args as Record<string, unknown>)[k];
        if (v === undefined || v === null) continue;
        if (def.type === 'string') {
          if (typeof v !== 'string') continue;
          const trimmed = v.trim();
          if (trimmed === '') continue;
          referenced.push(trimmed);
          userProperties[k] = trimmed;
        } else if (def.type === 'number') {
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          userProperties[k] = v;
        } else {
          // Unknown schema type (shouldn't happen for ActionId 67) — pass through.
          userProperties[k] = v;
        }
      }

      // Field existence check.
      const validation = validateFieldExistence(referenced, { fields: knownFieldKeys });
      if (!validation.ok) {
        return JSON.stringify(
          {
            found: false,
            extensionFid,
            message: '业务规则引用了不存在的字段 — 服务端会拒绝，不发送。',
            errors: validation.errors!.map((e) => ({
              field: e.field,
              suggestions: e.suggestions,
              hint: `字段 ${e.field} 不在父对象 ${ext.baseObjectId} 或扩展 ${extensionFid} 上。最近匹配：${e.suggestions.join(' / ')}`
            }))
          },
          null,
          2
        );
      }

      // Strip schema defaults — server fills them in, sending equals-default
      // bloats overlay XML and noises up BOS Designer diff.
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(userProperties)) {
        const def = propsSchema[k];
        if (def && def.default !== undefined && v === def.default) continue;
        properties[k] = v;
      }

      const ruleId = randomUUID(); // dashed form (rule conventions allow both)
      const serviceId = randomUUID().replace(/-/g, ''); // 32-hex without dashes
      const result = await c.addEntityServiceRule({
        extensionFid,
        ruleId,
        description,
        preCondition,
        preConditionDesc,
        services: [
          {
            className: 'GetInvStockBusinessServiceMeta',
            actionId: 67,
            id: serviceId,
            properties
          }
        ]
      });

      return JSON.stringify(
        {
          found: true,
          extensionFid,
          ruleId: result.ruleId,
          serviceId,
          message:
            `GetInvStock 规则已添加（ruleId=${result.ruleId}）。` +
            '请让用户关闭客户端整个重登以确认（BOS 客户端有缓存）。'
        },
        null,
        2
      );
    }
  };
}

/**
 * Plan 5.12.3b Task 3.5 — add a Calculate (ActionId 2) business rule onto a
 * BOS extension. Dispatches to either field-level UpdateAction or
 * entity-level EntityServiceRule based on `mountPoint.kind`.
 *
 * Design notes:
 *   - **Validate-and-retry (route C)**: every IronPython source string runs
 *     through `validateCalculateRule` (Task 3.4) BEFORE the wire write.
 *     SQL-style functions (ROUND / IIF / DATEADD), Python 3 patterns
 *     (print(), f-string), unknown field references all surface as
 *     structured `{found:false, errors:[{line, message, suggestions}],
 *     retryHint}` so the agent loop can self-correct without a server
 *     round-trip.
 *   - **GUID conventions**: field-level uses **dashed UUID** (matches recon
 *     `<Id>afc25ea1-5732-4803-9f54-516a22fb0b09</Id>`). Entity-level uses
 *     dashed UUID for ruleId + 32-hex-no-dash for the service id (matches
 *     Task 3.3 `addGetInvStockRuleTool` convention; `addEntityServiceRule`
 *     accepts both).
 *   - **mountPoint schema is intentionally relaxed** (no `oneOf`) — most
 *     LLMs handle `oneOf` poorly across providers. We validate the
 *     `kind`-specific fields at runtime and return clear errors.
 *   - **Whitespace preserved** in `actions` strings — recon req-120 shows
 *     BOS keeps spacing literally (`" F_X = F_Y * 2 "`), and the agent's
 *     own formatting is the source of truth.
 *   - Both branches end with the BOS-client cache-relogin hint.
 */
export function addCalculateRuleTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_add_calculate_rule',
      description:
        '在 BOS 扩展上加一条 Calculate（IronPython 赋值，ActionId 2）业务规则。' +
        '\n\n**挂载点**:' +
        '\n- `mountPoint.kind: "field"` — 字段级 UpdateAction，绑定到某字段（fieldKey），值变化时触发。最常见用法。' +
        '\n- `mountPoint.kind: "entity"` — 实体级 EntityServiceRule，挂在 HeadEntity 上，按 preCondition 触发。**preCondition 必填非空**。' +
        '\n\n**actions**: IronPython 赋值数组，每条形如 `"F金额 = F数量 * F单价"`。工具会跑 IronPython AST 校验（`validateCalculateRule`）和字段存在校验。校验失败返回 `{found: false, errors: [...], retryHint}`，agent 应根据 errors 修正后重试。' +
        '\n\n**写路径**: SaveForIDEV9。成功后请让用户关闭客户端整个重登才能看到规则触发。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展 FID。'
          },
          mountPoint: {
            type: 'object',
            description:
              "kind=field 字段级 / kind=entity 实体级。两种 schema 不同，看 fieldKey vs preCondition。",
            properties: {
              kind: {
                type: 'string',
                description: "'field' 或 'entity'"
              },
              fieldKey: {
                type: 'string',
                description: 'kind=field 时必填，目标字段 key (FieldMeta.key)。'
              },
              disabledEvents: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'kind=field 时可选，禁用的 Raise 事件名（不带 Raise 前缀），如 ["ValueChanged"]。可选项: Initialized / ItemAdded / ItemRemoved / SelectRowChanged / SelectRowExtChanged / ValueChanged / ItemReset / Reset。'
              },
              entityKey: {
                type: 'string',
                description: 'kind=entity 时（v0.1 总是 HeadEntity，可省）。'
              },
              preCondition: {
                type: 'string',
                description: 'kind=entity 时必填非空，IronPython 布尔表达式。'
              },
              preConditionDesc: {
                type: 'string',
                description: 'kind=entity 时可选，前置条件中文描述。'
              },
              description: {
                type: 'string',
                description: 'kind=entity 时必填，规则中文名。'
              }
            },
            required: ['kind']
          },
          actions: {
            type: 'array',
            items: { type: 'string' },
            description: 'IronPython 赋值数组（每条单行 `<Field> = <Expression>`），至少 1 条。'
          }
        },
        required: ['extensionFid', 'mountPoint', 'actions']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');

      // mountPoint shape validation — we do this manually instead of via
      // JSON Schema oneOf since LLMs handle oneOf poorly across providers.
      const mountPoint = args.mountPoint;
      if (!mountPoint || typeof mountPoint !== 'object') {
        throw new Error('mountPoint 必填，且必须是对象');
      }
      const mp = mountPoint as Record<string, unknown>;
      const kind = mp.kind;
      if (kind !== 'field' && kind !== 'entity') {
        throw new Error("mountPoint.kind 必填，且必须是 'field' 或 'entity'");
      }

      // actions validation
      if (!Array.isArray(args.actions) || args.actions.length === 0) {
        throw new Error('actions 必填，且必须是非空字符串数组');
      }
      const actions: string[] = [];
      for (const [i, a] of (args.actions as unknown[]).entries()) {
        if (typeof a !== 'string' || a.trim() === '') {
          throw new Error(`actions[${i}] 必须是非空字符串`);
        }
        // Preserve whitespace (BOS does — see recon req-120).
        actions.push(a);
      }

      // Resolve parent — needed for both branches (field validation + bridge).
      const ext = await c.getObject(extensionFid);
      if (!ext) {
        return JSON.stringify(
          {
            found: false,
            extensionFid,
            message: `扩展 ${extensionFid} 不存在 — 检查 FID 拼写，或先用 k3cloud_list_extensions 找一下。`
          },
          null,
          2
        );
      }
      if (!ext.baseObjectId) {
        return JSON.stringify(
          {
            found: false,
            extensionFid,
            message: `扩展 ${extensionFid} 缺少 BaseObjectId — 不是有效的 BOS 扩展。`
          },
          null,
          2
        );
      }

      // Field schema for IronPython AST validation: merge ext delta + parent
      // original (Calculate references can resolve against either source).
      const [extFields, parentFields] = await Promise.all([
        c.getFields(extensionFid),
        c.getFields(ext.baseObjectId)
      ]);
      const knownFieldKeys = Array.from(
        new Set([...extFields.map((f) => f.key), ...parentFields.map((f) => f.key)])
      );

      // Run AST validator (Task 3.4) — catches SQL-style functions, Python 3
      // syntax, unknown fields. Failures return structured errors with
      // retryHint so the agent can self-correct.
      const validation = validateCalculateRule(actions, { fields: knownFieldKeys });
      if (!validation.ok) {
        return JSON.stringify(
          {
            found: false,
            extensionFid,
            errors: validation.errors,
            retryHint:
              '修正以上错误后重试。可调 k3cloud_describe_service_meta(actionId=2) 查 IronPython 规则。'
          },
          null,
          2
        );
      }

      // Branch on mount point.
      if (kind === 'field') {
        const fieldKey =
          typeof mp.fieldKey === 'string' && mp.fieldKey.trim() !== ''
            ? mp.fieldKey.trim()
            : null;
        if (!fieldKey) {
          throw new Error("mountPoint.kind='field' 时 mountPoint.fieldKey 必填非空");
        }
        const disabledEvents =
          Array.isArray(mp.disabledEvents) && mp.disabledEvents.length > 0
            ? (mp.disabledEvents as unknown[]).filter(
                (v): v is string => typeof v === 'string' && v.trim() !== ''
              )
            : undefined;

        const serviceId = randomUUID(); // dashed form (matches recon req-120)
        const result = await c.addFieldUpdateAction({
          extensionFid,
          fieldKey,
          services: [
            {
              actionId: 2,
              id: serviceId,
              parameters: actions,
              disabledEvents
            }
          ]
        });
        return JSON.stringify(
          {
            found: true,
            extensionFid,
            fieldKey,
            serviceId: result.serviceId,
            message:
              `字段级 Calculate 规则已添加到字段 ${fieldKey}（serviceId=${result.serviceId}）。` +
              '请让用户关闭客户端整个重登以确认（BOS 客户端有缓存）。'
          },
          null,
          2
        );
      }

      // kind === 'entity'
      const preConditionRaw = mp.preCondition;
      if (typeof preConditionRaw !== 'string' || preConditionRaw.trim() === '') {
        throw new Error(
          "mountPoint.kind='entity' 时 preCondition 必填非空（BOS Designer 强制要求实体服务规则有前置条件）"
        );
      }
      const preCondition = preConditionRaw.trim();
      const descriptionRaw = mp.description;
      if (typeof descriptionRaw !== 'string' || descriptionRaw.trim() === '') {
        throw new Error("mountPoint.kind='entity' 时 description 必填非空");
      }
      const description = descriptionRaw.trim();
      const preConditionDesc =
        typeof mp.preConditionDesc === 'string' && mp.preConditionDesc.trim() !== ''
          ? mp.preConditionDesc.trim()
          : undefined;

      const ruleId = randomUUID(); // dashed form
      const serviceId = randomUUID().replace(/-/g, ''); // 32-hex no dashes
      const result = await c.addEntityServiceRule({
        extensionFid,
        ruleId,
        description,
        preCondition,
        preConditionDesc,
        services: [
          {
            className: 'FormBusinessService',
            actionId: 2,
            id: serviceId,
            properties: { Parameters: JSON.stringify(actions) }
          }
        ]
      });
      return JSON.stringify(
        {
          found: true,
          extensionFid,
          ruleId: result.ruleId,
          serviceId,
          message:
            `实体级 Calculate 规则已添加（ruleId=${result.ruleId}）。` +
            '请让用户关闭客户端整个重登以确认（BOS 客户端有缓存）。'
        },
        null,
        2
      );
    }
  };
}
