import { describe, expect, it, vi } from 'vitest';
import {
  listBusinessRulesTool,
  deleteBusinessRuleTool,
  describeServiceMetaTool,
  addGetInvStockRuleTool
} from '../../src/main/agent/business-rule-tools';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { FieldMeta, ObjectMeta } from '@shared/erp-types';

/**
 * Tiny stand-in shaped to whatever the business-rule tools call. Cast to
 * K3CloudConnector at use-site since we only need a handful of methods.
 */
function makeFakeConnector(
  overrides: Partial<
    Pick<
      K3CloudConnector,
      | 'listBusinessRules'
      | 'removeBusinessRule'
      | 'getObject'
      | 'getFields'
      | 'addEntityServiceRule'
    >
  > = {}
): K3CloudConnector {
  return {
    listBusinessRules: vi.fn(async () => ({ entityRules: [], fieldUpdateActions: [] })),
    removeBusinessRule: vi.fn(async () => ({ location: 'entity' as const })),
    getObject: vi.fn(async () => null as ObjectMeta | null),
    getFields: vi.fn(async () => [] as FieldMeta[]),
    addEntityServiceRule: vi.fn(async () => ({ ruleId: 'unset' })),
    ...overrides
  } as unknown as K3CloudConnector;
}

describe('listBusinessRulesTool', () => {
  it('registers as k3cloud_list_business_rules and is parallelSafe', () => {
    const tool = listBusinessRulesTool(makeFakeConnector());
    expect(tool.definition.name).toBe('k3cloud_list_business_rules');
    expect(tool.parallelSafe).toBe(true);
  });

  it('forwards extensionFid to connector and returns aggregated results', async () => {
    const fake = makeFakeConnector({
      listBusinessRules: vi.fn(async () => ({
        entityRules: [
          {
            ruleId: 'r1',
            entityKey: 'HeadEntity',
            preCondition: 'a > 0',
            description: 'test',
            services: [
              {
                branch: 'true',
                actionId: 67,
                className: 'GetInvStockBusinessServiceMeta',
                serviceId: 's1'
              }
            ]
          }
        ],
        fieldUpdateActions: []
      }))
    });
    const tool = listBusinessRulesTool(fake);
    const raw = await tool.execute({ extensionFid: 'fid-1' });
    expect(fake.listBusinessRules).toHaveBeenCalledWith('fid-1');
    const parsed = JSON.parse(raw);
    expect(parsed.entityRules).toHaveLength(1);
    expect(parsed.entityRules[0].ruleId).toBe('r1');
    expect(parsed.entityRules[0].services[0].serviceId).toBe('s1');
  });

  it('rejects when extensionFid is missing or empty', async () => {
    const tool = listBusinessRulesTool(makeFakeConnector());
    await expect(tool.execute({})).rejects.toThrow(/extensionFid/);
    await expect(tool.execute({ extensionFid: '   ' })).rejects.toThrow(/extensionFid/);
  });
});

describe('deleteBusinessRuleTool', () => {
  it('registers as k3cloud_delete_business_rule and is NOT parallelSafe', () => {
    const tool = deleteBusinessRuleTool(makeFakeConnector());
    expect(tool.definition.name).toBe('k3cloud_delete_business_rule');
    expect(tool.parallelSafe).toBeUndefined();
  });

  it('passes extensionFid + ruleId through to connector and returns location', async () => {
    const fake = makeFakeConnector({
      removeBusinessRule: vi.fn(async () => ({ location: 'entity' as const }))
    });
    const tool = deleteBusinessRuleTool(fake);
    const raw = await tool.execute({ extensionFid: 'fid-1', ruleId: 'rule-guid' });
    expect(fake.removeBusinessRule).toHaveBeenCalledWith('fid-1', 'rule-guid');
    const parsed = JSON.parse(raw);
    expect(parsed.location).toBe('entity');
  });

  it('surfaces connector errors (e.g. field-level deferred)', async () => {
    const fake = makeFakeConnector({
      removeBusinessRule: vi.fn(async () => {
        throw new Error('field-level UpdateAction removal deferred to Task 3.5');
      })
    });
    const tool = deleteBusinessRuleTool(fake);
    await expect(
      tool.execute({ extensionFid: 'fid-1', ruleId: 'field-svc' })
    ).rejects.toThrow(/Task 3\.5/);
  });

  it('rejects when extensionFid or ruleId is missing', async () => {
    const tool = deleteBusinessRuleTool(makeFakeConnector());
    await expect(tool.execute({ ruleId: 'r' })).rejects.toThrow(/extensionFid/);
    await expect(tool.execute({ extensionFid: 'f' })).rejects.toThrow(/ruleId/);
  });
});

describe('describeServiceMetaTool', () => {
  it('registers as k3cloud_describe_service_meta and is parallelSafe', () => {
    const tool = describeServiceMetaTool();
    expect(tool.definition.name).toBe('k3cloud_describe_service_meta');
    expect(tool.parallelSafe).toBe(true);
  });

  it('returns schema for ActionId 67 (GetInvStock) including stockQtyField default', async () => {
    const tool = describeServiceMetaTool();
    const parsed = JSON.parse(await tool.execute({ actionId: 67 }));
    expect(parsed.found).toBe(true);
    expect(parsed.actionId).toBe(67);
    expect(parsed.className).toBe('GetInvStockBusinessServiceMeta');
    expect(parsed.properties).toBeDefined();
    expect(Object.keys(parsed.properties)).toContain('stockQtyField');
    expect(parsed.properties.stockQtyField.default).toBe('FInvQty');
    // wire-format-supplemented properties stay in schema
    expect(Object.keys(parsed.properties)).toContain('extAuxQtyField');
  });

  it('returns schema for ActionId 2 (Calculate / FormBusinessService)', async () => {
    const tool = describeServiceMetaTool();
    const parsed = JSON.parse(await tool.execute({ actionId: 2 }));
    expect(parsed.found).toBe(true);
    expect(parsed.actionId).toBe(2);
    expect(parsed.className).toBe('FormBusinessService');
    expect(parsed.properties.parameters.type).toBe('string[]');
  });

  it('returns found:false for unsupported ActionId, naming the supported set', async () => {
    const tool = describeServiceMetaTool();
    const parsed = JSON.parse(await tool.execute({ actionId: 42 }));
    expect(parsed.found).toBe(false);
    expect(parsed.actionId).toBe(42);
    expect(parsed.message).toContain('2');
    expect(parsed.message).toContain('67');
  });

  it('rejects when actionId is missing or not a number', async () => {
    const tool = describeServiceMetaTool();
    await expect(tool.execute({})).rejects.toThrow(/actionId/);
    await expect(tool.execute({ actionId: 'not-a-number' })).rejects.toThrow(/actionId/);
  });
});

describe('addGetInvStockRuleTool', () => {
  const EXT_ID = '7cd9e5a1dbd54faba4be1b558877fbd2';
  const PARENT_ID = 'SAL_SaleOrder';

  function extObject(): ObjectMeta {
    return {
      id: EXT_ID,
      name: 'OpenDeploy 库存查询扩展',
      modelTypeId: 100,
      subsystemId: '23',
      baseObjectId: PARENT_ID,
      isTemplate: false,
      modifyDate: null
    };
  }

  // Parent's original fields — schema defaults reference these (FInvQty,
  // FAwaitQty, FAvbQty, FSTOCKID, FMATERIALID, FBillTypeID, FQty …).
  function parentFields(): FieldMeta[] {
    return [
      { key: 'FBillTypeID', name: '单据类型', type: 'BasedataField', isEntryField: false },
      { key: 'FInvQty', name: '库存数量', type: 'DecimalField', isEntryField: false },
      { key: 'FAwaitQty', name: '在途数量', type: 'DecimalField', isEntryField: false },
      { key: 'FAvbQty', name: '可用数量', type: 'DecimalField', isEntryField: false },
      { key: 'FSTOCKID', name: '仓库', type: 'BasedataField', isEntryField: false },
      { key: 'FMATERIALID', name: '物料', type: 'BasedataField', isEntryField: false },
      { key: 'FSTOCKORGID', name: '库存组织', type: 'BasedataField', isEntryField: false },
      { key: 'FKEEPERTYPEID', name: '保管者类型', type: 'BasedataField', isEntryField: false },
      { key: 'FKEEPERID', name: '保管者', type: 'BasedataField', isEntryField: false },
      { key: 'FOWNERTYPEID', name: '货主类型', type: 'BasedataField', isEntryField: false },
      { key: 'FOWNERID', name: '货主', type: 'BasedataField', isEntryField: false },
      { key: 'FSTOCKLOCID', name: '仓位', type: 'BasedataField', isEntryField: false },
      { key: 'FQty', name: '数量', type: 'DecimalField', isEntryField: false }
    ];
  }

  // Extension delta — custom fields the user added.
  function extFields(): FieldMeta[] {
    return [
      { key: 'F_TestQty', name: '自定义数量', type: 'DecimalField', isEntryField: false },
      { key: 'F_TestStock', name: '自定义库存', type: 'DecimalField', isEntryField: false }
    ];
  }

  function happyConnector(
    addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }))
  ): K3CloudConnector {
    return makeFakeConnector({
      getObject: vi.fn(async (id: string) => (id === EXT_ID ? extObject() : null)),
      getFields: vi.fn(async (formId: string) =>
        formId === EXT_ID ? extFields() : formId === PARENT_ID ? parentFields() : []
      ),
      addEntityServiceRule
    });
  }

  it('registers as k3cloud_add_get_inv_stock_rule and is NOT parallelSafe (writer)', () => {
    const tool = addGetInvStockRuleTool(happyConnector());
    expect(tool.definition.name).toBe('k3cloud_add_get_inv_stock_rule');
    expect(tool.parallelSafe).toBeUndefined();
  });

  it('exposes every schema property as a parameter (with description)', () => {
    const tool = addGetInvStockRuleTool(happyConnector());
    const props = (tool.definition.parameters as { properties: Record<string, unknown> }).properties;
    // Schema-driven props from SERVICE_META_SCHEMAS[67].properties
    expect(props.stockQtyField).toBeDefined();
    expect(props.awaitQtyField).toBeDefined();
    expect(props.extAuxQtyField).toBeDefined();
    expect(props.returnQtyField).toBeDefined();
    // Plus the structural required ones
    expect(props.extensionFid).toBeDefined();
    expect(props.description).toBeDefined();
    expect(props.preCondition).toBeDefined();
  });

  it('happy path: forwards to addEntityServiceRule with className+actionId+id+properties', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid-from-server' }));
    const fake = happyConnector(addEntityServiceRule);
    const tool = addGetInvStockRuleTool(fake);

    const raw = await tool.execute({
      extensionFid: EXT_ID,
      description: '出货时查可用库存',
      preCondition: "FBillTypeID.FNumber == '01.01'",
      stockQtyField: 'F_TestQty', // override default 'FInvQty'
      preConditionDesc: '只对出货单触发'
    });
    const parsed = JSON.parse(raw);

    expect(parsed.found).toBe(true);
    expect(parsed.ruleId).toBe('rule-guid-from-server');
    expect(parsed.serviceId).toMatch(/^[0-9a-f]{32}$/); // 32-hex no dashes
    expect(parsed.message).toMatch(/重登/); // BOS cache hint

    expect(addEntityServiceRule).toHaveBeenCalledTimes(1);
    const call = addEntityServiceRule.mock.calls[0][0];
    expect(call.extensionFid).toBe(EXT_ID);
    expect(call.description).toBe('出货时查可用库存');
    expect(call.preCondition).toBe("FBillTypeID.FNumber == '01.01'");
    expect(call.preConditionDesc).toBe('只对出货单触发');
    // ruleId GUID — dashed form
    expect(call.ruleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(call.services).toHaveLength(1);
    expect(call.services[0].className).toBe('GetInvStockBusinessServiceMeta');
    expect(call.services[0].actionId).toBe(67);
    expect(call.services[0].id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('default override skipping: equals-default props are dropped, non-default are emitted', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }));
    const fake = happyConnector(addEntityServiceRule);
    const tool = addGetInvStockRuleTool(fake);

    await tool.execute({
      extensionFid: EXT_ID,
      description: 'mixed-defaults rule',
      preCondition: 'True',
      stockQtyField: 'FInvQty', // EQUALS default — must be dropped
      awaitQtyField: 'F_TestQty', // overrides default 'FAwaitQty' — must be present
      // not passing availableQtyField — must not appear
    });

    const props = addEntityServiceRule.mock.calls[0][0].services[0].properties;
    expect(props).not.toHaveProperty('stockQtyField');
    expect(props.awaitQtyField).toBe('F_TestQty');
    expect(props).not.toHaveProperty('availableQtyField');
  });

  it('non-default-bearing props (extAuxQtyField etc.) are always emitted when supplied', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }));
    const fake = happyConnector(addEntityServiceRule);
    const tool = addGetInvStockRuleTool(fake);

    await tool.execute({
      extensionFid: EXT_ID,
      description: 'with extAux',
      preCondition: 'True',
      extAuxQtyField: 'F_TestQty', // schema has no default for this — must be sent
    });

    const props = addEntityServiceRule.mock.calls[0][0].services[0].properties;
    expect(props.extAuxQtyField).toBe('F_TestQty');
  });

  it('rejects unknown field with Levenshtein suggestion (does not call addEntityServiceRule)', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }));
    const fake = happyConnector(addEntityServiceRule);
    const tool = addGetInvStockRuleTool(fake);

    const raw = await tool.execute({
      extensionFid: EXT_ID,
      description: 'bad field',
      preCondition: 'True',
      stockQtyField: 'F_NonExistent'
    });
    const parsed = JSON.parse(raw);

    expect(parsed.found).toBe(false);
    expect(parsed.errors).toBeDefined();
    expect(parsed.errors[0].field).toBe('F_NonExistent');
    // Suggestions include the closest real field key (F_TestStock or F_TestQty)
    expect(parsed.errors[0].suggestions.length).toBeGreaterThan(0);
    expect(addEntityServiceRule).not.toHaveBeenCalled();
  });

  it('rejects empty preCondition (preCondition mandatory)', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }));
    const fake = happyConnector(addEntityServiceRule);
    const tool = addGetInvStockRuleTool(fake);

    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        description: 'empty pre',
        preCondition: ''
      })
    ).rejects.toThrow(/preCondition/);

    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        description: 'whitespace pre',
        preCondition: '   '
      })
    ).rejects.toThrow(/preCondition/);

    expect(addEntityServiceRule).not.toHaveBeenCalled();
  });

  it('rejects missing description', async () => {
    const tool = addGetInvStockRuleTool(happyConnector());
    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        preCondition: 'True'
      })
    ).rejects.toThrow(/description/);

    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        description: '   ',
        preCondition: 'True'
      })
    ).rejects.toThrow(/description/);
  });

  it('rejects missing extensionFid', async () => {
    const tool = addGetInvStockRuleTool(happyConnector());
    await expect(
      tool.execute({
        description: 'no ext',
        preCondition: 'True'
      })
    ).rejects.toThrow(/extensionFid/);
  });

  it('returns found:false JSON when extension does not exist (no service call)', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }));
    const fake = makeFakeConnector({
      getObject: vi.fn(async () => null),
      addEntityServiceRule
    });
    const tool = addGetInvStockRuleTool(fake);

    const parsed = JSON.parse(
      await tool.execute({
        extensionFid: 'ghost',
        description: 'd',
        preCondition: 'True'
      })
    );

    expect(parsed.found).toBe(false);
    expect(parsed.message).toMatch(/不存在/);
    expect(addEntityServiceRule).not.toHaveBeenCalled();
  });

  it('returns found:false JSON when extension lacks baseObjectId', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }));
    const fake = makeFakeConnector({
      getObject: vi.fn(async () => ({
        ...extObject(),
        baseObjectId: null
      })),
      addEntityServiceRule
    });
    const tool = addGetInvStockRuleTool(fake);

    const parsed = JSON.parse(
      await tool.execute({
        extensionFid: EXT_ID,
        description: 'd',
        preCondition: 'True'
      })
    );

    expect(parsed.found).toBe(false);
    expect(parsed.message).toMatch(/BaseObjectId/);
    expect(addEntityServiceRule).not.toHaveBeenCalled();
  });

  it('field validation accepts keys from EITHER extension OR parent', async () => {
    const addEntityServiceRule = vi.fn(async () => ({ ruleId: 'rule-guid' }));
    const fake = happyConnector(addEntityServiceRule);
    const tool = addGetInvStockRuleTool(fake);

    // Mix: one ext field (F_TestQty) and one parent field (FQty) — both valid.
    const raw = await tool.execute({
      extensionFid: EXT_ID,
      description: 'mixed source',
      preCondition: 'True',
      stockQtyField: 'F_TestQty', // ext delta
      awaitQtyField: 'FQty' // parent original
    });
    const parsed = JSON.parse(raw);

    expect(parsed.found).toBe(true);
    expect(addEntityServiceRule).toHaveBeenCalled();
  });
});
