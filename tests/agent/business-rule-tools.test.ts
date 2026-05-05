import { describe, expect, it, vi } from 'vitest';
import {
  listBusinessRulesTool,
  deleteBusinessRuleTool,
  describeServiceMetaTool
} from '../../src/main/agent/business-rule-tools';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';

/**
 * Tiny stand-in shaped to whatever the business-rule tools call. Cast to
 * K3CloudConnector at use-site since we only need 2 methods.
 */
function makeFakeConnector(
  overrides: Partial<Pick<K3CloudConnector, 'listBusinessRules' | 'removeBusinessRule'>> = {}
): K3CloudConnector {
  return {
    listBusinessRules: vi.fn(async () => ({ entityRules: [], fieldUpdateActions: [] })),
    removeBusinessRule: vi.fn(async () => ({ location: 'entity' as const })),
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
