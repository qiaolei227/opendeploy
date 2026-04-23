import { describe, expect, it, vi } from 'vitest';
import { buildK3CloudTools } from '../../src/main/agent/k3cloud-tools';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { FieldMeta, ObjectMeta, SubsystemMeta } from '@shared/erp-types';

/**
 * Minimal stand-in for K3CloudConnector — only the methods the tool layer
 * calls, plus a config block so activeProjectTag can read the database name.
 */
function makeFake(
  overrides: Partial<Pick<K3CloudConnector, 'listObjects' | 'getObject' | 'getFields' | 'listSubsystems' | 'searchMetadata'>> = {}
): K3CloudConnector {
  return {
    config: {
      server: 'localhost',
      database: 'AIS001',
      user: 'sa',
      password: 'x'
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    testConnection: vi.fn(),
    listObjects: vi.fn(async () => [] as ObjectMeta[]),
    getObject: vi.fn(async () => null as ObjectMeta | null),
    getFields: vi.fn(async () => [] as FieldMeta[]),
    listSubsystems: vi.fn(async () => [] as SubsystemMeta[]),
    searchMetadata: vi.fn(async () => [] as ObjectMeta[]),
    ...overrides
  } as unknown as K3CloudConnector;
}

describe('buildK3CloudTools', () => {
  it('returns 5 tools when a connector is present', () => {
    const tools = buildK3CloudTools(makeFake());
    expect(tools.map((t) => t.definition.name).sort()).toEqual([
      'kingdee_get_fields',
      'kingdee_get_object',
      'kingdee_list_objects',
      'kingdee_list_subsystems',
      'kingdee_search_metadata'
    ]);
  });

  it('returns empty when no active connector is configured', () => {
    // no injection → reads from active.ts which starts idle in tests
    expect(buildK3CloudTools()).toEqual([]);
  });
});

describe('kingdee_list_objects tool', () => {
  it('forwards keyword / limit / includeTemplates to the connector', async () => {
    const fake = makeFake({
      listObjects: vi.fn(async () => [
        {
          id: 'SAL_SaleOrder',
          name: '销售订单',
          modelTypeId: 100,
          subsystemId: 'SAL',
          isTemplate: false,
          modifyDate: null
        }
      ])
    });
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_list_objects')!;

    const raw = await tool.execute({ keyword: '销售', limit: 5, includeTemplates: false });

    expect(fake.listObjects).toHaveBeenCalledWith({
      keyword: '销售',
      subsystemId: undefined,
      limit: 5,
      includeTemplates: false
    });
    const parsed = JSON.parse(raw);
    expect(parsed.count).toBe(1);
    expect(parsed.objects[0].id).toBe('SAL_SaleOrder');
  });
});

describe('kingdee_get_object tool', () => {
  it('returns found=false JSON when the object is missing', async () => {
    const fake = makeFake({ getObject: vi.fn(async () => null) });
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_object')!;

    const parsed = JSON.parse(await tool.execute({ id: 'ghost' }));

    expect(parsed).toEqual({ found: false, id: 'ghost' });
  });

  it('returns found=true + the ObjectMeta on hit', async () => {
    const obj: ObjectMeta = {
      id: 'BD_MATERIAL',
      name: '物料',
      modelTypeId: 400,
      subsystemId: 'BD',
      isTemplate: false,
      modifyDate: null
    };
    const fake = makeFake({ getObject: vi.fn(async () => obj) });
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_object')!;

    const parsed = JSON.parse(await tool.execute({ id: 'BD_MATERIAL' }));

    expect(parsed.found).toBe(true);
    expect(parsed.object).toMatchObject(obj);
  });

  it('throws when id arg is missing or empty', async () => {
    const tool = buildK3CloudTools(makeFake()).find(
      (t) => t.definition.name === 'kingdee_get_object'
    )!;
    await expect(tool.execute({})).rejects.toThrow(/id/);
    await expect(tool.execute({ id: '   ' })).rejects.toThrow(/id/);
  });
});

describe('kingdee_get_fields tool', () => {
  it('rejects when the form id is unknown (pre-flight getObject)', async () => {
    const fake = makeFake({ getObject: vi.fn(async () => null) });
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_fields')!;

    const parsed = JSON.parse(await tool.execute({ formId: 'NOPE' }));

    expect(parsed.found).toBe(false);
    expect(fake.getFields).not.toHaveBeenCalled();
  });

  it('groups head + entry fields in the response', async () => {
    const fake = makeFake({
      getObject: vi.fn(async () => ({
        id: 'SAL_SaleOrder',
        name: '销售订单',
        modelTypeId: 100,
        subsystemId: 'SAL',
        isTemplate: false,
        modifyDate: null
      })),
      getFields: vi.fn(async () => [
        { key: 'FCustomerId', name: 'FCustomerId', type: 'BasedataField', isEntryField: false },
        {
          key: 'FMaterialId',
          name: 'FMaterialId',
          type: 'BasedataField',
          isEntryField: true,
          entryKey: 'FSaleOrderEntry'
        },
        {
          key: 'FQty',
          name: 'FQty',
          type: 'DecimalField',
          isEntryField: true,
          entryKey: 'FSaleOrderEntry'
        }
      ])
    });
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_fields')!;

    const parsed = JSON.parse(await tool.execute({ formId: 'SAL_SaleOrder' }));

    expect(parsed.total).toBe(3);
    expect(parsed.headFields).toHaveLength(1);
    expect(parsed.headFields[0].key).toBe('FCustomerId');
    expect(parsed.entryFields.FSaleOrderEntry).toHaveLength(2);
  });
});

describe('kingdee_search_metadata tool', () => {
  it('rejects on empty keyword', async () => {
    const tool = buildK3CloudTools(makeFake()).find(
      (t) => t.definition.name === 'kingdee_search_metadata'
    )!;
    await expect(tool.execute({ keyword: '' })).rejects.toThrow(/keyword/);
    await expect(tool.execute({ keyword: '   ' })).rejects.toThrow(/keyword/);
  });

  it('forwards non-empty keyword', async () => {
    const fake = makeFake({ searchMetadata: vi.fn(async () => []) });
    const tool = buildK3CloudTools(fake).find(
      (t) => t.definition.name === 'kingdee_search_metadata'
    )!;
    await tool.execute({ keyword: '信用额度' });
    expect(fake.searchMetadata).toHaveBeenCalledWith('信用额度');
  });
});

describe('kingdee_list_subsystems tool', () => {
  it('returns the count + records from the connector', async () => {
    const fake = makeFake({
      listSubsystems: vi.fn(async () => [
        { id: 'SAL', number: 'SAL', name: '销售' },
        { id: 'PUR', number: 'PUR', name: '采购' }
      ])
    });
    const tool = buildK3CloudTools(fake).find(
      (t) => t.definition.name === 'kingdee_list_subsystems'
    )!;
    const parsed = JSON.parse(await tool.execute({}));
    expect(parsed.count).toBe(2);
    expect(parsed.subsystems).toHaveLength(2);
  });
});
