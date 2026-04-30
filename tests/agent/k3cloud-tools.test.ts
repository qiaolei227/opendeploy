import { describe, expect, it, vi } from 'vitest';
import { buildK3CloudTools } from '../../src/main/agent/k3cloud-tools';
import { UnsupportedConvertRuleError } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type {
  ExtensionMeta,
  FieldMeta,
  ObjectMeta,
  PluginMeta,
  SubsystemMeta
} from '@shared/erp-types';

/**
 * Minimal stand-in for K3CloudConnector — only the methods the tool layer
 * calls, plus a config block so activeProjectTag can read the database name.
 */
function makeFake(
  overrides: Partial<
    Pick<
      K3CloudConnector,
      | 'listObjects'
      | 'getObject'
      | 'getFields'
      | 'listSubsystems'
      | 'searchMetadata'
      | 'listExtensions'
      | 'listFormPlugins'
      | 'getFormLayout'
      | 'listConvertRules'
      | 'describeConvertRule'
      | 'extendConvertRule'
      | 'deleteConvertRuleExtension'
      | 'addConvertFieldMapping'
      | 'setConvertGroupBy'
      | 'setConvertFilter'
      | 'addConvertPlugin'
      | 'removeConvertPlugin'
      | 'addConvertBillTypeMap'
    >
  > = {}
): K3CloudConnector {
  const notConfigured = (name: string) => vi.fn(async () => { throw new Error(`${name} mock not configured`); });
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
    listExtensions: vi.fn(async () => [] as ExtensionMeta[]),
    listFormPlugins: vi.fn(async () => [] as PluginMeta[]),
    getFormLayout: vi.fn(async () => null),
    listConvertRules: vi.fn(async () => []),
    describeConvertRule: notConfigured('describeConvertRule'),
    extendConvertRule: notConfigured('extendConvertRule'),
    deleteConvertRuleExtension: notConfigured('deleteConvertRuleExtension'),
    addConvertFieldMapping: notConfigured('addConvertFieldMapping'),
    setConvertGroupBy: notConfigured('setConvertGroupBy'),
    setConvertFilter: notConfigured('setConvertFilter'),
    addConvertPlugin: notConfigured('addConvertPlugin'),
    removeConvertPlugin: notConfigured('removeConvertPlugin'),
    addConvertBillTypeMap: notConfigured('addConvertBillTypeMap'),
    ...overrides
  } as unknown as K3CloudConnector;
}

describe('buildK3CloudTools', () => {
  it('returns 21 tools when a connector is present', () => {
    const tools = buildK3CloudTools(makeFake());
    expect(tools.map((t) => t.definition.name).sort()).toEqual([
      'kingdee_add_convert_bill_type_map',
      'kingdee_add_convert_field_mapping',
      'kingdee_add_convert_plugin',
      'kingdee_create_convert_rule_extension',
      'kingdee_delete_convert_rule_extension',
      'kingdee_describe_basedata',
      'kingdee_describe_convert_rule',
      'kingdee_get_extension_fields',
      'kingdee_get_fields',
      'kingdee_get_form_layout',
      'kingdee_get_object',
      'kingdee_list_convert_rules',
      'kingdee_list_enum_types',
      'kingdee_list_extensions',
      'kingdee_list_form_plugins',
      'kingdee_list_objects',
      'kingdee_list_subsystems',
      'kingdee_remove_convert_plugin',
      'kingdee_search_metadata',
      'kingdee_set_convert_filter',
      'kingdee_set_convert_groupby'
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

  const makeFakeWithFields = () =>
    makeFake({
      getObject: vi.fn(async () => ({
        id: 'SAL_SaleOrder',
        name: '销售订单',
        modelTypeId: 100,
        subsystemId: 'SAL',
        isTemplate: false,
        modifyDate: null
      })),
      getFields: vi.fn(async () => [
        { key: 'FCustomerId', name: '客户', type: 'BasedataField', isEntryField: false },
        { key: 'FCreditLimit', name: '信用额度', type: 'DecimalField', isEntryField: false },
        {
          key: 'FMaterialId',
          name: '物料',
          type: 'BasedataField',
          isEntryField: true,
          entryKey: 'FSaleOrderEntry'
        },
        {
          key: 'FQty',
          name: '数量',
          type: 'DecimalField',
          isEntryField: true,
          entryKey: 'FSaleOrderEntry'
        }
      ])
    });

  it('default path returns lean summary (keys only, no per-field detail)', async () => {
    const fake = makeFakeWithFields();
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_fields')!;

    const parsed = JSON.parse(await tool.execute({ formId: 'SAL_SaleOrder' }));

    expect(parsed.total).toBe(4);
    expect(parsed.headKeys).toEqual(['FCustomerId', 'FCreditLimit']);
    expect(parsed.entryTables.FSaleOrderEntry).toEqual(['FMaterialId', 'FQty']);
    // No per-field objects — this is the lean shape that saves tokens.
    expect(parsed.headFields).toBeUndefined();
    expect(parsed.entryFields).toBeUndefined();
    expect(parsed.hint).toContain('keyword');
  });

  it('keyword filter returns only matched fields with full detail', async () => {
    const fake = makeFakeWithFields();
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_fields')!;

    const parsed = JSON.parse(await tool.execute({ formId: 'SAL_SaleOrder', keyword: '信用' }));

    expect(parsed.matched).toBe(1);
    expect(parsed.headFields).toHaveLength(1);
    expect(parsed.headFields[0].key).toBe('FCreditLimit');
    expect(parsed.headFields[0].type).toBe('DecimalField');
    // Lean keys absent — keyword path returns detail.
    expect(parsed.headKeys).toBeUndefined();
  });

  it('keyword matches key substring case-insensitively', async () => {
    const fake = makeFakeWithFields();
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_fields')!;

    const parsed = JSON.parse(await tool.execute({ formId: 'SAL_SaleOrder', keyword: 'qty' }));

    expect(parsed.matched).toBe(1);
    expect(parsed.entryFields.FSaleOrderEntry[0].key).toBe('FQty');
  });

  it('includeDetail:true returns full per-field detail for all fields', async () => {
    const fake = makeFakeWithFields();
    const tool = buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_fields')!;

    const parsed = JSON.parse(
      await tool.execute({ formId: 'SAL_SaleOrder', includeDetail: true })
    );

    expect(parsed.total).toBe(4);
    expect(parsed.headFields).toHaveLength(2);
    expect(parsed.entryFields.FSaleOrderEntry).toHaveLength(2);
    // Full detail carries type info.
    expect(parsed.headFields[0].type).toBe('BasedataField');
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

describe('kingdee_describe_basedata tool (Plan 5.12.1 Task 6)', () => {
  function getDescribeTool(fake: K3CloudConnector) {
    return buildK3CloudTools(fake).find(
      (t) => t.definition.name === 'kingdee_describe_basedata'
    )!;
  }

  it('returns found=false when key does not exist (with helpful hint)', async () => {
    const fake = makeFake({
      getObject: vi.fn(async () => null)
    });
    const tool = getDescribeTool(fake);
    const parsed = JSON.parse(await tool.execute({ key: 'BD_NoSuchThing' }));
    expect(parsed.found).toBe(false);
    expect(parsed.key).toBe('BD_NoSuchThing');
    expect(parsed.message).toMatch(/不存在/);
    expect(parsed.message).toMatch(/BD_Customer/); // hint includes common keys
  });

  it('returns simple-text fields and excludes BaseDataField references', async () => {
    const fake = makeFake({
      getObject: vi.fn(async () => ({
        id: 'BD_Customer', name: '客户',
        modelTypeId: 400, subsystemId: 'BAS', isTemplate: false, modifyDate: null
      })),
      getFields: vi.fn(async () => [
        { key: 'FName', name: '名称', type: 'TextField', isEntryField: false },
        { key: 'FNumber', name: '编号', type: 'TextField', isEntryField: false },
        { key: 'FShortName', name: '简称', type: 'TextField', isEntryField: false },
        { key: 'FCreditLimit', name: '信用额度', type: 'AmountField', isEntryField: false },
        // BaseDataField — itself a reference, can't srcDisplay → must be filtered out
        { key: 'FOwnerOrgID', name: '所属组织', type: 'BaseDataField', isEntryField: false },
        { key: 'FCreateDate', name: '创建日期', type: 'DateTimeField', isEntryField: false }
      ])
    });
    const tool = getDescribeTool(fake);
    const parsed = JSON.parse(await tool.execute({ key: 'BD_Customer' }));
    expect(parsed.found).toBe(true);
    expect(parsed.key).toBe('BD_Customer');
    expect(parsed.name).toBe('客户');
    expect(parsed.totalFields).toBe(6);
    // Only 5 displayable — BaseDataField filtered out
    expect(parsed.displayableCount).toBe(5);
    expect(parsed.fields.map((f: { key: string }) => f.key)).toEqual([
      'FName', 'FNumber', 'FShortName', 'FCreditLimit', 'FCreateDate'
    ]);
    // Hint mentions both base_data and base_property usage
    expect(parsed.hint).toMatch(/refBaseDataObjectKey/);
    expect(parsed.hint).toMatch(/srcDisplayFieldName/);
  });

  it('keyword filter narrows results and uses case-insensitive substring match', async () => {
    const fake = makeFake({
      getObject: vi.fn(async () => ({
        id: 'BD_Customer', name: '客户',
        modelTypeId: 400, subsystemId: 'BAS', isTemplate: false, modifyDate: null
      })),
      getFields: vi.fn(async () => [
        { key: 'FName', name: '名称', type: 'TextField', isEntryField: false },
        { key: 'FShortName', name: '简称', type: 'TextField', isEntryField: false },
        { key: 'FNumber', name: '编号', type: 'TextField', isEntryField: false },
        { key: 'FAddress', name: '地址', type: 'TextField', isEntryField: false }
      ])
    });
    const tool = getDescribeTool(fake);
    // 'name' should match FName + FShortName (key contains "name", case-insensitive)
    const parsed = JSON.parse(await tool.execute({ key: 'BD_Customer', keyword: 'name' }));
    expect(parsed.keyword).toBe('name');
    expect(parsed.fields.map((f: { key: string }) => f.key)).toEqual(['FName', 'FShortName']);
  });

  it('rejects empty key', async () => {
    const fake = makeFake();
    const tool = getDescribeTool(fake);
    await expect(tool.execute({ key: '' })).rejects.toThrow(/non-empty/);
  });

  it('marked parallelSafe (read-only metadata query, no DB writes)', () => {
    const tool = getDescribeTool(makeFake());
    expect(tool.parallelSafe).toBe(true);
  });
});

describe('kingdee_list_extensions tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_list_extensions')!;

  it('forwards parentFormId to connector and returns count + extensions', async () => {
    const exts: ExtensionMeta[] = [
      {
        extId: 'aaa1',
        parentFormId: 'SAL_SaleOrder',
        name: 'OpenDeploy 信用预警',
        developerCode: 'PAIJ',
        modifyDate: '2026-04-27T00:00:00Z'
      },
      {
        extId: 'bbb2',
        parentFormId: 'SAL_SaleOrder',
        name: '友商扩展',
        developerCode: 'OTHER_ISV',
        modifyDate: '2026-03-15T00:00:00Z'
      }
    ];
    const fake = makeFake({ listExtensions: vi.fn(async () => exts) });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ parentFormId: 'SAL_SaleOrder' }));

    expect(fake.listExtensions).toHaveBeenCalledWith('SAL_SaleOrder');
    expect(parsed.count).toBe(2);
    expect(parsed.extensions).toEqual(exts);
  });

  it('returns count=0 when no extensions exist', async () => {
    const fake = makeFake({ listExtensions: vi.fn(async () => []) });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ parentFormId: 'SAL_SaleOrder' }));

    expect(parsed.count).toBe(0);
    expect(parsed.extensions).toEqual([]);
  });

  it('throws on empty parentFormId', async () => {
    const tool = findTool(makeFake());
    await expect(tool.execute({})).rejects.toThrow(/parentFormId/);
    await expect(tool.execute({ parentFormId: '   ' })).rejects.toThrow(/parentFormId/);
  });

  it('marked parallelSafe', () => {
    expect(findTool(makeFake()).parallelSafe).toBe(true);
  });
});

describe('kingdee_get_extension_fields tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_extension_fields')!;

  it('returns fields when extension exists', async () => {
    const fake = makeFake({
      getObject: vi.fn(async (id: string) =>
        id === 'ext1'
          ? {
              id: 'ext1',
              name: 'OpenDeploy 信用预警',
              modelTypeId: 100,
              subsystemId: '23',
              baseObjectId: 'SAL_SaleOrder',
              isTemplate: false,
              modifyDate: null
            }
          : null
      ),
      getFields: vi.fn(async () => [
        { key: 'F_PAIJ_Warn', name: '预警标记', type: 'CheckBoxField', isEntryField: false }
      ] as FieldMeta[])
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ extId: 'ext1' }));

    expect(parsed.found).toBe(true);
    expect(parsed.extId).toBe('ext1');
    expect(parsed.parentFormId).toBe('SAL_SaleOrder');
    expect(parsed.count).toBe(1);
    expect(parsed.fields[0].key).toBe('F_PAIJ_Warn');
  });

  it('returns found=false when extension is missing (does not call getFields)', async () => {
    const fake = makeFake({ getObject: vi.fn(async () => null) });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ extId: 'ghost' }));

    expect(parsed.found).toBe(false);
    expect(fake.getFields).not.toHaveBeenCalled();
  });

  it('throws on empty extId', async () => {
    const tool = findTool(makeFake());
    await expect(tool.execute({})).rejects.toThrow(/extId/);
  });

  it('marked parallelSafe', () => {
    expect(findTool(makeFake()).parallelSafe).toBe(true);
  });
});

describe('kingdee_list_form_plugins tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_list_form_plugins')!;

  it('returns python + dll plugins from connector', async () => {
    const plugins: PluginMeta[] = [
      { className: 'credit_warn', type: 'python', pyScript: '#stub' },
      {
        className: 'Kingdee.K3.SCM.Sal.Business.PlugIn.SaleOrderEdit',
        type: 'dll',
        orderId: 100
      }
    ];
    const fake = makeFake({ listFormPlugins: vi.fn(async () => plugins) });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ formOrExtId: 'ext1' }));

    expect(fake.listFormPlugins).toHaveBeenCalledWith('ext1');
    expect(parsed.count).toBe(2);
    expect(parsed.plugins[0].type).toBe('python');
    expect(parsed.plugins[1].type).toBe('dll');
  });

  it('returns count=0 when no plugins exist', async () => {
    const fake = makeFake({ listFormPlugins: vi.fn(async () => []) });
    const parsed = JSON.parse(await findTool(fake).execute({ formOrExtId: 'SAL_SaleOrder' }));
    expect(parsed.count).toBe(0);
  });

  it('throws on empty formOrExtId', async () => {
    const tool = findTool(makeFake());
    await expect(tool.execute({})).rejects.toThrow(/formOrExtId/);
  });

  it('marked parallelSafe', () => {
    expect(findTool(makeFake()).parallelSafe).toBe(true);
  });
});

describe('kingdee_get_form_layout tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_get_form_layout')!;

  function makeLayoutFake(
    overrides: Partial<Pick<K3CloudConnector, 'getObject' | 'getFormLayout'>> = {}
  ): K3CloudConnector {
    const base = makeFake();
    return Object.assign(base, overrides);
  }

  it('returns tabs + entries from connector', async () => {
    const fake = makeLayoutFake({
      getObject: vi.fn(async () => ({
        id: 'SAL_SaleOrder',
        name: '销售订单',
        modelTypeId: 1,
        subsystemId: 'SAL',
        baseObjectId: null,
        isTemplate: false,
        modifyDate: null
      }) as ObjectMeta),
      getFormLayout: vi.fn(async () => ({
        tabs: [
          { key: 'FTab_P0', caption: '基本信息', parentControl: 'FTab' },
          { key: 'FTab_P1', caption: '客户信息', parentControl: 'FTab' }
        ],
        entries: [
          {
            key: 'FSaleOrderEntry',
            name: '明细信息',
            tableName: 'T_SAL_ORDERENTRY',
            kind: 'entry'
          }
        ]
      }))
    });
    const parsed = JSON.parse(await findTool(fake).execute({ formId: 'SAL_SaleOrder' }));
    expect(parsed.found).toBe(true);
    expect(parsed.formName).toBe('销售订单');
    expect(parsed.tabs).toHaveLength(2);
    expect(parsed.entries[0].kind).toBe('entry');
  });

  it('returns found=false when object missing', async () => {
    const fake = makeLayoutFake({ getObject: vi.fn(async () => null) });
    const parsed = JSON.parse(await findTool(fake).execute({ formId: 'NoSuch' }));
    expect(parsed.found).toBe(false);
  });

  it('returns found=false when kernel xml missing', async () => {
    const fake = makeLayoutFake({
      getObject: vi.fn(async () => ({
        id: 'X', name: 'x', modelTypeId: 1, subsystemId: null,
        baseObjectId: null, isTemplate: false, modifyDate: null
      }) as ObjectMeta),
      getFormLayout: vi.fn(async () => null)
    });
    const parsed = JSON.parse(await findTool(fake).execute({ formId: 'X' }));
    expect(parsed.found).toBe(false);
  });

  it('throws on empty formId', async () => {
    const tool = findTool(makeLayoutFake());
    await expect(tool.execute({})).rejects.toThrow(/formId/);
  });

  it('marked parallelSafe', () => {
    expect(findTool(makeLayoutFake()).parallelSafe).toBe(true);
  });
});

describe('kingdee_list_convert_rules tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_list_convert_rules')!;

  it('forwards sourceFormId filter to the connector', async () => {
    const fake = makeFake({
      listConvertRules: vi.fn(async () => [
        {
          sourceFormId: 'SAL_SaleOrder',
          targetFormId: 'SAL_OUTSTOCK',
          sourceFormName: '销售订单',
          targetFormName: '销售出库单'
        }
      ])
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ sourceFormId: 'SAL_SaleOrder' }));

    expect(fake.listConvertRules).toHaveBeenCalledWith('SAL_SaleOrder');
    expect(parsed.count).toBe(1);
    expect(parsed.paths[0].targetFormId).toBe('SAL_OUTSTOCK');
  });

  it('passes undefined when sourceFormId omitted (returns full table)', async () => {
    const fake = makeFake({ listConvertRules: vi.fn(async () => []) });
    const tool = findTool(fake);

    await tool.execute({});

    expect(fake.listConvertRules).toHaveBeenCalledWith(undefined);
  });

  it('treats whitespace-only sourceFormId as omitted', async () => {
    const fake = makeFake({ listConvertRules: vi.fn(async () => []) });
    const tool = findTool(fake);

    await tool.execute({ sourceFormId: '   ' });

    expect(fake.listConvertRules).toHaveBeenCalledWith(undefined);
  });

  it('marked parallelSafe', () => {
    expect(findTool(makeFake()).parallelSafe).toBe(true);
  });
});

describe('kingdee_describe_convert_rule tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_describe_convert_rule')!;

  it('returns the connector summary as pretty JSON', async () => {
    const fake = makeFake({
      describeConvertRule: vi.fn(async (id: string) => ({
        ruleId: id,
        displayName: '销售订单->销售出库单',
        sourceFormId: 'SAL_SaleOrder',
        targetFormId: 'SAL_OUTSTOCK',
        isDefault: true,
        isActive: true,
        invisible: false,
        convertType: 0,
        pushRunCondition: null,
        extension: { hasExtends: false, lineage: [], originId: null, isv: null, isInheritView: false },
        defaultConvert: null,
        groupBy: null,
        filter: null,
        plugins: [],
        billTypeMaps: [],
        linkEntity: null,
        attachment: null,
        tailDiff: null,
        orderByField: null,
        formBusinessServices: []
      }))
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ ruleId: 'SaleOrder-OutStock' }));

    expect(fake.describeConvertRule).toHaveBeenCalledWith('SaleOrder-OutStock');
    expect(parsed.ruleId).toBe('SaleOrder-OutStock');
    expect(parsed.isDefault).toBe(true);
  });

  it('trims whitespace before passing to connector', async () => {
    const fake = makeFake({
      describeConvertRule: vi.fn(async () => ({
        ruleId: 'X',
        displayName: '',
        sourceFormId: '',
        targetFormId: '',
        isDefault: false,
        isActive: false,
        invisible: false,
        convertType: 0,
        pushRunCondition: null,
        extension: { hasExtends: false, lineage: [], originId: null, isv: null, isInheritView: false },
        defaultConvert: null,
        groupBy: null,
        filter: null,
        plugins: [],
        billTypeMaps: [],
        linkEntity: null,
        attachment: null,
        tailDiff: null,
        orderByField: null,
        formBusinessServices: []
      }))
    });
    const tool = findTool(fake);

    await tool.execute({ ruleId: '  SaleOrder-OutStock  ' });

    expect(fake.describeConvertRule).toHaveBeenCalledWith('SaleOrder-OutStock');
  });

  it('throws when ruleId is missing or empty', async () => {
    const tool = findTool(makeFake());
    await expect(tool.execute({})).rejects.toThrow(/ruleId/);
    await expect(tool.execute({ ruleId: '' })).rejects.toThrow(/ruleId/);
    await expect(tool.execute({ ruleId: '   ' })).rejects.toThrow(/ruleId/);
  });

  it('returns found=false JSON when server reports rule does not exist', async () => {
    const fake = makeFake({
      describeConvertRule: vi.fn(async () => {
        throw new Error('response_error: 不存在的规则 X');
      })
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(await tool.execute({ ruleId: 'X' }));

    expect(parsed.found).toBe(false);
    expect(parsed.ruleId).toBe('X');
    expect(parsed.message).toContain('kingdee_list_convert_rules');
  });

  it('rethrows non-not-found errors', async () => {
    const fake = makeFake({
      describeConvertRule: vi.fn(async () => {
        throw new Error('network unreachable');
      })
    });
    const tool = findTool(fake);

    await expect(tool.execute({ ruleId: 'X' })).rejects.toThrow(/network unreachable/);
  });

  it('marked parallelSafe', () => {
    expect(findTool(makeFake()).parallelSafe).toBe(true);
  });
});

describe('kingdee_create_convert_rule_extension tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find((t) => t.definition.name === 'kingdee_create_convert_rule_extension')!;

  it('forwards originRuleId + displayName to the connector', async () => {
    const fake = makeFake({
      extendConvertRule: vi.fn(async () => ({
        ok: true,
        raw: '',
        newExtensionId: 'aabbccddeeff00112233445566778899'
      }))
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(
      await tool.execute({ originRuleId: 'SaleOrder-OutStock', displayName: '我的扩展' })
    );

    expect(fake.extendConvertRule).toHaveBeenCalledWith('SaleOrder-OutStock', '我的扩展');
    expect(parsed.ok).toBe(true);
    expect(parsed.newExtensionId).toBe('aabbccddeeff00112233445566778899');
  });

  it('passes undefined displayName when omitted or whitespace-only', async () => {
    const fake = makeFake({
      extendConvertRule: vi.fn(async () => ({
        ok: true,
        raw: '',
        newExtensionId: 'newid'
      }))
    });
    const tool = findTool(fake);

    await tool.execute({ originRuleId: 'SaleOrder-OutStock' });
    expect(fake.extendConvertRule).toHaveBeenLastCalledWith('SaleOrder-OutStock', undefined);

    await tool.execute({ originRuleId: 'SaleOrder-OutStock', displayName: '   ' });
    expect(fake.extendConvertRule).toHaveBeenLastCalledWith('SaleOrder-OutStock', undefined);
  });

  it('trims whitespace before passing to connector', async () => {
    const fake = makeFake({
      extendConvertRule: vi.fn(async () => ({
        ok: true,
        raw: '',
        newExtensionId: 'newid'
      }))
    });
    const tool = findTool(fake);

    await tool.execute({ originRuleId: '  SaleOrder-OutStock  ', displayName: '  ext  ' });
    expect(fake.extendConvertRule).toHaveBeenCalledWith('SaleOrder-OutStock', 'ext');
  });

  it('throws when originRuleId is missing or empty', async () => {
    const tool = findTool(makeFake());
    await expect(tool.execute({})).rejects.toThrow(/originRuleId/);
    await expect(tool.execute({ originRuleId: '' })).rejects.toThrow(/originRuleId/);
    await expect(tool.execute({ originRuleId: '   ' })).rejects.toThrow(/originRuleId/);
  });

  it('returns ok=false JSON for unsupported rules (v0.1 baseline limitation)', async () => {
    const fake = makeFake({
      extendConvertRule: vi.fn(async () => {
        throw new UnsupportedConvertRuleError(
          'extendConvertRule',
          'PUR_PurchaseOrder-PUR_Receive'
        );
      })
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(
      await tool.execute({ originRuleId: 'PUR_PurchaseOrder-PUR_Receive' })
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('BOS Designer');
    expect(parsed.message).toContain('SaleOrder-OutStock');
  });

  it('rethrows on unrecognized errors (network, server)', async () => {
    const fake = makeFake({
      extendConvertRule: vi.fn(async () => {
        throw new Error('network unreachable');
      })
    });
    const tool = findTool(fake);

    await expect(tool.execute({ originRuleId: 'SaleOrder-OutStock' })).rejects.toThrow(
      /network unreachable/
    );
  });

  it('omits parallelSafe (write tool — must serialize)', () => {
    expect(findTool(makeFake()).parallelSafe).toBeUndefined();
  });
});

describe('kingdee_delete_convert_rule_extension tool', () => {
  const findTool = (fake: K3CloudConnector) =>
    buildK3CloudTools(fake).find(
      (t) => t.definition.name === 'kingdee_delete_convert_rule_extension'
    )!;

  it('forwards originRuleId + extId to the connector', async () => {
    const fake = makeFake({
      deleteConvertRuleExtension: vi.fn(async () => ({ ok: true, raw: '' }))
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(
      await tool.execute({
        originRuleId: 'SaleOrder-OutStock',
        extId: 'fe6154fe-7144-4633-97e9-601f65135ae9'
      })
    );

    expect(fake.deleteConvertRuleExtension).toHaveBeenCalledWith(
      'SaleOrder-OutStock',
      'fe6154fe-7144-4633-97e9-601f65135ae9'
    );
    expect(parsed.ok).toBe(true);
  });

  it('throws when either argument is missing or empty', async () => {
    const tool = findTool(makeFake());
    await expect(tool.execute({ originRuleId: 'SaleOrder-OutStock' })).rejects.toThrow(/extId/);
    await expect(tool.execute({ extId: 'X' })).rejects.toThrow(/originRuleId/);
    await expect(
      tool.execute({ originRuleId: '   ', extId: 'X' })
    ).rejects.toThrow(/originRuleId/);
    await expect(
      tool.execute({ originRuleId: 'SaleOrder-OutStock', extId: '   ' })
    ).rejects.toThrow(/extId/);
  });

  it('returns ok=false JSON for unsupported rules', async () => {
    const fake = makeFake({
      deleteConvertRuleExtension: vi.fn(async () => {
        throw new UnsupportedConvertRuleError('deleteConvertRuleExtension', 'X');
      })
    });
    const tool = findTool(fake);

    const parsed = JSON.parse(
      await tool.execute({ originRuleId: 'X', extId: 'someExtId' })
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('BOS Designer');
    expect(parsed.message).toContain('SaleOrder-OutStock');
  });

  it('omits parallelSafe (write tool — must serialize)', () => {
    expect(findTool(makeFake()).parallelSafe).toBeUndefined();
  });
});
