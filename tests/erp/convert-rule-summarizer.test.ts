import { describe, expect, it } from 'vitest';
import {
  summarizeConvertRule,
  summarizeConvertPath,
  VALUE_CONVERT_MODE_NAMES,
  GROUP_BY_MODE_NAMES,
} from '../../src/main/erp/k3cloud/convert-rule-summarizer';
import type { RawConvertRule, RawFieldMap, RawPolicy } from '../../src/main/erp/k3cloud/rpc/convert-rules';

function buildRule(policies: RawPolicy[]): RawConvertRule {
  return {
    Id: 'SaleOrder-OutStock',
    ModelTypeId: 790,
    Name: [{ Key: 2052, Value: '销售订单->销售出库单' }],
    SourceFormId: 'SAL_SaleOrder',
    Rule: {
      ___InstClassType__: '...ConvertRuleElement,Kingdee.BOS.Core',
      SourceFormId: 'SAL_SaleOrder',
      TargetFormId: 'SAL_OUTSTOCK',
      Status: true,
      IsDefault: true,
      Invisible: false,
      IsRandom: true,
      FreePush: false,
      CheckLinkSet: true,
      Formula: null,
      PushRunCondition: 'FBUSINESSTYPE = "FY"',
      PushRunConditionExt: null,
      ConvertType: 0,
      Policies: policies,
    },
  };
}

function fieldMap(target: string, mode: number, formula: string | null = null, source: string | null = null): RawFieldMap {
  return {
    ___InstClassType__: '...FieldMapElement',
    TargetFieldKey: target,
    TargetFieldName: null,
    SourceFieldKey: source,
    SourceFieldName: null,
    ValueConvertMode: mode,
    Formula: formula,
    FormulaDesc: formula ? `desc:${formula}` : null,
    IsFilter: false,
  };
}

describe('summarizeConvertRule — top-level metadata', () => {
  it('extracts ruleId / displayName / Source/Target / flags', () => {
    const summary = summarizeConvertRule(buildRule([]));
    expect(summary.ruleId).toBe('SaleOrder-OutStock');
    expect(summary.displayName).toBe('销售订单->销售出库单');
    expect(summary.sourceFormId).toBe('SAL_SaleOrder');
    expect(summary.targetFormId).toBe('SAL_OUTSTOCK');
    expect(summary.isDefault).toBe(true);
    expect(summary.isActive).toBe(true);
    expect(summary.invisible).toBe(false);
    expect(summary.convertType).toBe(0);
    expect(summary.pushRunCondition).toBe('FBUSINESSTYPE = "FY"');
  });

  it('handles missing optional policies (empty Policies array)', () => {
    const summary = summarizeConvertRule(buildRule([]));
    expect(summary.defaultConvert).toBeNull();
    expect(summary.groupBy).toBeNull();
    expect(summary.filter).toBeNull();
    expect(summary.plugins).toEqual([]);
    expect(summary.billTypeMaps).toEqual([]);
    expect(summary.linkEntity).toBeNull();
    expect(summary.attachment).toBeNull();
    expect(summary.tailDiff).toBeNull();
    expect(summary.orderByField).toBeNull();
    expect(summary.formBusinessServices).toEqual([]);
  });

  it('falls back to first locale when zh-CN missing in displayName', () => {
    const r = buildRule([]);
    r.Name = [{ Key: 1033, Value: 'EN-only' }];
    const summary = summarizeConvertRule(r);
    expect(summary.displayName).toBe('EN-only');
  });
});

describe('summarizeConvertRule — extension overlay metadata', () => {
  it('defaults all extension fields to safe values when wrapper omits them', () => {
    const summary = summarizeConvertRule(buildRule([]));
    expect(summary.extension).toEqual({
      hasExtends: false,
      lineage: [],
      originId: null,
      isv: null,
      isInheritView: false,
    });
  });

  it('extracts HasExtends + lineage + originId + ISV when present', () => {
    const r = buildRule([]);
    r.HasExtends = true;
    r.FirstNonExtendObjectID = 'SaleOrder-OutStock';
    r.IsInheritElement = false;
    r.InheritPathDescription = [
      { Item1: 'SaleOrder-OutStock', Item2: [{ Key: 2052, Value: '销售订单至销售出库单' }] },
      { Item1: 'fe6154fe-7144-4633-97e9-601f65135ae9', Item2: [{ Key: 2052, Value: '销售订单至销售出库单' }] },
    ];
    r.ISV = { Id: null, Name: 'Kingdee', ISVSignal: 'Kingdee', PackageSignal: '', DevCode: null };

    const summary = summarizeConvertRule(r);

    expect(summary.extension.hasExtends).toBe(true);
    expect(summary.extension.originId).toBe('SaleOrder-OutStock');
    expect(summary.extension.isInheritView).toBe(false);
    expect(summary.extension.isv).toEqual({ name: 'Kingdee', signal: 'Kingdee', devCode: null });
    expect(summary.extension.lineage).toEqual([
      { id: 'SaleOrder-OutStock', displayName: '销售订单至销售出库单' },
      { id: 'fe6154fe-7144-4633-97e9-601f65135ae9', displayName: '销售订单至销售出库单' },
    ]);
  });

  it('flags non-Kingdee ISV (customer extension) on inherit-view rule', () => {
    // The "design-time GUID" view from the SaleOrder-OutStock probe — ISV is UNW, IsInheritElement=true
    const r = buildRule([]);
    r.Id = 'fe6154fe-7144-4633-97e9-601f65135ae9';
    r.HasExtends = true;
    r.IsInheritElement = true;
    r.ISV = { Id: null, Name: 'UNW', ISVSignal: 'UNW', PackageSignal: '', DevCode: null };

    const summary = summarizeConvertRule(r);

    expect(summary.extension.isInheritView).toBe(true);
    expect(summary.extension.isv?.name).toBe('UNW');
    expect(summary.extension.isv?.devCode).toBeNull();
  });

  it('handles ISV with non-null DevCode', () => {
    const r = buildRule([]);
    r.ISV = { Id: 'isv-1', Name: 'CustomCo', ISVSignal: 'CCO', PackageSignal: 'pkg-x', DevCode: 'CCODEV' };

    const summary = summarizeConvertRule(r);
    expect(summary.extension.isv).toEqual({ name: 'CustomCo', signal: 'CCO', devCode: 'CCODEV' });
  });
});

describe('summarizeConvertRule — DefaultConvertPolicy', () => {
  function defaultPolicy(maps: RawFieldMap[]): RawPolicy {
    return {
      ___InstClassType__: 'Kingdee.BOS.Core.Metadata.ConvertElement.DefaultConvertPolicyElement,Kingdee.BOS.Core',
      SourceEntryKey: 'FSaleOrderEntry',
      TargetEntryKey: 'FEntity',
      FieldMaps: maps,
    } as RawPolicy;
  }

  it('drops Auto-mapped (mode 0) maps from formulaMaps + aggregateMaps', () => {
    const summary = summarizeConvertRule(
      buildRule([
        defaultPolicy([fieldMap('FBillNo', 0), fieldMap('FCreatorId', 0), fieldMap('FRecord', 0)]),
      ]),
    );
    const dc = summary.defaultConvert!;
    expect(dc.fieldMapCount).toBe(3);
    expect(dc.formulaMaps).toEqual([]);
    expect(dc.aggregateMaps).toEqual([]);
  });

  it('lists Formula maps (mode 6) with formula + desc', () => {
    const summary = summarizeConvertRule(
      buildRule([
        defaultPolicy([
          fieldMap('FBaseUnitQty', 6, 'FStockBaseCanOutQty if (FStockBaseCanOutQty > 0) else 0'),
          fieldMap('FBillNo', 0),
        ]),
      ]),
    );
    const fm = summary.defaultConvert!.formulaMaps;
    expect(fm).toHaveLength(1);
    expect(fm[0].target).toBe('FBaseUnitQty');
    expect(fm[0].mode).toBe('Formula');
    expect(fm[0].formula).toContain('FStockBaseCanOutQty');
    expect(fm[0].formulaDesc).toContain('desc:');
  });

  it('lists aggregate maps (Sum/Avg/Count/Max/Min/Join/SumFormula) without Auto', () => {
    const summary = summarizeConvertRule(
      buildRule([
        defaultPolicy([
          fieldMap('FQty', 1, null, 'FQtySrc'),    // Sum
          fieldMap('FAvg', 2),                     // Average
          fieldMap('FCount', 3),                   // Count
          fieldMap('FMax', 4),                     // Max
          fieldMap('FMin', 5),                     // Min
          fieldMap('FJoin', 7),                    // Join
          fieldMap('FSumF', 8),                    // SumFormula
          fieldMap('FAuto', 0),                    // Auto — dropped
        ]),
      ]),
    );
    const agg = summary.defaultConvert!.aggregateMaps;
    expect(agg).toHaveLength(7);
    expect(agg.map((a) => a.mode)).toEqual([
      'Sum', 'Average', 'Count', 'Max', 'Min', 'Join', 'SumFormula',
    ]);
    expect(agg[0]).toEqual({ target: 'FQty', source: 'FQtySrc', mode: 'Sum' });
  });

  it('preserves entry keys', () => {
    const summary = summarizeConvertRule(buildRule([defaultPolicy([])]));
    const dc = summary.defaultConvert!;
    expect(dc.sourceEntry).toBe('FSaleOrderEntry');
    expect(dc.targetEntry).toBe('FEntity');
  });
});

describe('summarizeConvertRule — GroupByPolicy', () => {
  it('reverse-maps GroupByMode int to string + splits CSV fields', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertGroupByPolicyElement',
      GroupByMode: 2,
      GroupByField: 'FCustId,FSettleModeId,FStockOrgId',
      GroupByFormula: null,
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.groupBy).toEqual({
      mode: 'GroupByField',
      fields: ['FCustId', 'FSettleModeId', 'FStockOrgId'],
      formula: null,
    });
  });

  it('handles unknown GroupByMode gracefully', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertGroupByPolicyElement',
      GroupByMode: 99,
      GroupByField: '',
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.groupBy?.mode).toBe('Unknown(99)');
    expect(summary.groupBy?.fields).toEqual([]);
  });
});

describe('summarizeConvertRule — other policies', () => {
  it('extracts plugin ClassNames', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertPlugInPolicyElement',
      Plugs: [
        { ClassName: 'Kingdee.K3.SCM.SaleOrderToOutStock, Kingdee.K3.SCM.App.Sal.ServicePlugIn' },
        { ClassName: 'Kingdee.K3.SCM.ConvertBomDefaultValueService' },
        { ClassName: '' },
      ],
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.plugins).toEqual([
      'Kingdee.K3.SCM.SaleOrderToOutStock, Kingdee.K3.SCM.App.Sal.ServicePlugIn',
      'Kingdee.K3.SCM.ConvertBomDefaultValueService',
    ]);
  });

  it('extracts BillTypeMap GUID pairs', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...BillTypeMapPolicyElement',
      BillTypeMaps: [
        { SourceBillTypeId: 'src-guid-1', TargetBillTypeId: 'tgt-guid-1' },
        { SourceBillTypeId: 'src-guid-2', TargetBillTypeId: 'tgt-guid-2' },
      ],
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.billTypeMaps).toHaveLength(2);
    expect(summary.billTypeMaps[0]).toEqual({ source: 'src-guid-1', target: 'tgt-guid-1' });
  });

  it('extracts LinkEntity ControlEntityKey + map count', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...LinkEntityPolicyElement',
      ControlEntityKey: 'FEntity',
      FieldMaps: [{}, {}, {}] as RawFieldMap[],
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.linkEntity).toEqual({ controlEntity: 'FEntity', fieldMapCount: 3 });
  });

  it('extracts Attachment booleans', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertAttachmentPolicyElement',
      EnabledHeader: true,
      EnabledEntry: false,
      EnabledSubEntry: true,
      Deduplication: true,
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.attachment).toEqual({
      header: true,
      entry: false,
      subEntry: true,
      deduplication: true,
    });
  });

  it('extracts TailDiff state', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertTailDiffPolicyElement',
      IsEnabled: true,
      MarkFieldKey: 'FTailFlag',
      RecordFieldKey: 'FTailAmount',
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.tailDiff).toEqual({
      enabled: true,
      markField: 'FTailFlag',
      recordField: 'FTailAmount',
    });
  });

  it('extracts FilterPolicy AlertMessage from LocaleString[] and CustFilter', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertFilterPolicyElement',
      AlertMessage: [{ Key: 2052, Value: '请确认源单已审核' }],
      CustFilter: 'FBillStatus = "C"',
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.filter).toEqual({
      alertMessage: '请确认源单已审核',
      customFilter: 'FBillStatus = "C"',
    });
  });

  it('extracts OrderByField string', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertOrderByPolicyElement',
      OrderByField: 'FCreateDate desc',
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.orderByField).toBe('FCreateDate desc');
  });

  it('extracts FormBusinessServices with precondition + className', () => {
    const policy: RawPolicy = {
      ___InstClassType__: '...ConvertFormBusinessPolicyElement',
      FormBusinessList: [
        {
          PreCondition: 'NOT (FMaterialID <> null)',
          PreConditionDesc: [{ Key: 2052, Value: '物料没启用 BOM' }],
          ClassName: 'Kingdee.Some.Service',
          Type: 0,
        },
        {
          PreCondition: null,
          PreConditionDesc: [],
          ClassName: null,
          Type: 1,
        },
      ],
    } as RawPolicy;
    const summary = summarizeConvertRule(buildRule([policy]));
    expect(summary.formBusinessServices).toHaveLength(2);
    expect(summary.formBusinessServices[0]).toEqual({
      precondition: 'NOT (FMaterialID <> null)',
      preconditionDesc: '物料没启用 BOM',
      className: 'Kingdee.Some.Service',
      type: 0,
    });
    expect(summary.formBusinessServices[1]).toEqual({
      precondition: null,
      preconditionDesc: null,
      className: null,
      type: 1,
    });
  });
});

describe('summarizeConvertPath', () => {
  it('picks zh-CN display name', () => {
    const summary = summarizeConvertPath({
      SourceFormId: 'SAL_SaleOrder',
      TargetFormId: 'SAL_OUTSTOCK',
      SourceFormName: [{ Key: 2052, Value: '销售订单' }, { Key: 1033, Value: 'Sale Order' }],
      TargetFormName: [{ Key: 2052, Value: '销售出库单' }],
    });
    expect(summary).toEqual({
      sourceFormId: 'SAL_SaleOrder',
      targetFormId: 'SAL_OUTSTOCK',
      sourceFormName: '销售订单',
      targetFormName: '销售出库单',
    });
  });

  it('falls back when zh-CN missing', () => {
    const summary = summarizeConvertPath({
      SourceFormId: 'X',
      TargetFormId: 'Y',
      SourceFormName: [{ Key: 1033, Value: 'X-en' }],
      TargetFormName: [],
    });
    expect(summary.sourceFormName).toBe('X-en');
    expect(summary.targetFormName).toBe('');
  });
});

describe('enum tables exposed for external use', () => {
  it('VALUE_CONVERT_MODE_NAMES covers 0..8', () => {
    for (let i = 0; i <= 8; i++) {
      expect(VALUE_CONVERT_MODE_NAMES[i]).toBeTruthy();
    }
  });

  it('GROUP_BY_MODE_NAMES covers 0..3', () => {
    for (let i = 0; i <= 3; i++) {
      expect(GROUP_BY_MODE_NAMES[i]).toBeTruthy();
    }
  });
});
