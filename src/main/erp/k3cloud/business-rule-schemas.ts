/**
 * Static parameter schemas for the BOS service classes referenced by
 * EntityServiceRule / field UpdateAction entries. Single source of truth
 * for: (a) the `k3cloud_describe_service_meta` agent tool, (b) the future
 * `k3cloud_add_get_inv_stock_rule` tool's `properties` validation +
 * "省略 if equals default" wire serialization (Plan 5.12.3b Task 3.3).
 *
 * v0.1 covers two ActionIds:
 *   - 2  → FormBusinessService (Calculate, IronPython 赋值)
 *   - 67 → GetInvStockBusinessServiceMeta (查可用库存)
 *
 * Static rather than fetched-via-reflection for two reasons:
 *   1. The wire shape exposes 6 properties (`extAuxQtyField`,
 *      `returnQtyField`, `pluginClassName`, `stockStatusField`,
 *      `projectNoField`, `secUnitIdField`, `extAuxUnitIdField`) that BOS
 *      reflection on `SimpleProperty` doesn't surface.
 *   2. Round-tripping through the bridge per tool call is wasteful when
 *      the schema doesn't change between BOS minor versions.
 *
 * Property keys are **agent-facing camelCase**; the bridge / overlay layer
 * maps to the **PascalCase wire elements** (`<StockQtyField>` etc). The
 * agent never sees PascalCase — it works in camelCase end-to-end.
 *
 * The agent reads these prose descriptions to construct service
 * `parameters` payloads; this is not a strict JSON Schema, so e.g.
 * `'string[]'` lives as a free-form type string. Other ActionIds
 * (3 / 23 / 42 / 70 …) are scope-cut to v0.2.
 */

export interface ServicePropertySchema {
  type: string;
  default?: string;
  description: string;
}

export interface ServiceMetaSchema {
  className: string;
  description: string;
  properties: Record<string, ServicePropertySchema>;
}

export const SERVICE_META_SCHEMAS: Record<number, ServiceMetaSchema> = {
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
      // wire 实证补充字段（reflection-via-SimpleProperty 不会发现，但服务端接受）
      extAuxQtyField: { type: 'string', description: '辅助数量字段' },
      returnQtyField: { type: 'number', description: '是否返回数量（1=返回）' },
      pluginClassName: { type: 'string', description: '自定义插件类名' },
      stockStatusField: { type: 'string', description: '库存状态字段' },
      projectNoField: { type: 'string', description: '项目编号字段' },
      secUnitIdField: { type: 'string', description: '辅助单位字段' },
      extAuxUnitIdField: { type: 'string', description: '辅助单位 ID 字段' }
    }
  }
};

export const UNSUPPORTED_ACTION_ID_MESSAGE =
  'v0.1 仅支持 ActionId 2 (Calculate) 和 67 (GetInvStock)。其他 ActionId (3/23/42/70 等) 留 v0.2，可用 k3cloud_register_plugin 写 Python 插件作为替代。';
