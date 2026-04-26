import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  getFieldTypeSpec,
  insertFieldIntoKernelXml,
  type FieldType
} from '../../src/main/erp/k3cloud/bos-xml';

const BASE_XML =
  '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
  '<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">' +
  '<Id>ext-id-001</Id>' +
  '<FormPlugins/>' +
  '</Form>' +
  '</Elements></BusinessInfo></BusinessInfo></FormMetadata>';

const FIXED_IDS = (): (() => string) => {
  let n = 0;
  return () => `id${++n}`.padEnd(32, '0');
};

const FIXED_NUMERICS = () => ({ listTabIndex: 9001, zOrderIndex: 99, tabindex: 9001 });

describe('Field type registry', () => {
  it('declares all 15 expected types (reference_property dropped in v0.1)', () => {
    // reference_property C# class exists but BOS rejects the XML tag during
    // deserialization on standard bills (2026-04-26 user demo实证). Re-add
    // when we have a real-XML sample showing the right context.
    const expected: FieldType[] = [
      'text',
      'large_text',
      'int',
      'decimal',
      'amount',
      'qty',
      'date',
      'datetime',
      'checkbox',
      'combo',
      'mul_combo',
      'base_data',
      'base_property',
      'color',
      'mobile'
    ];
    for (const t of expected) {
      expect(FIELD_TYPES).toContain(t);
    }
    expect(FIELD_TYPES.length).toBe(expected.length);
  });

  it('maps each type to a spec with xmlTag + csClass + requiredExtraProps', () => {
    for (const t of FIELD_TYPES) {
      const spec = getFieldTypeSpec(t);
      expect(spec, `spec missing for ${t}`).toBeDefined();
      expect(spec.xmlTag, `xmlTag missing for ${t}`).toBeTruthy();
      expect(spec.csClass, `csClass missing for ${t}`).toBeTruthy();
      expect(Array.isArray(spec.requiredExtraProps)).toBe(true);
    }
  });

  it('xmlTag matches C# class name (BOS convention: tag = class)', () => {
    expect(getFieldTypeSpec('text').xmlTag).toBe('TextField');
    expect(getFieldTypeSpec('int').xmlTag).toBe('IntegerField');
    expect(getFieldTypeSpec('decimal').xmlTag).toBe('DecimalField');
    expect(getFieldTypeSpec('amount').xmlTag).toBe('AmountField');
    expect(getFieldTypeSpec('qty').xmlTag).toBe('QtyField');
    expect(getFieldTypeSpec('datetime').xmlTag).toBe('DateTimeField');
    expect(getFieldTypeSpec('date').xmlTag).toBe('DateTimeField');
    expect(getFieldTypeSpec('large_text').xmlTag).toBe('LargeRichTextField');
    expect(getFieldTypeSpec('checkbox').xmlTag).toBe('CheckBoxField');
    expect(getFieldTypeSpec('combo').xmlTag).toBe('ComboField');
    expect(getFieldTypeSpec('mul_combo').xmlTag).toBe('MulComboField');
    expect(getFieldTypeSpec('base_data').xmlTag).toBe('BaseDataField');
    expect(getFieldTypeSpec('base_property').xmlTag).toBe('BasePropertyField');
    expect(getFieldTypeSpec('color').xmlTag).toBe('ColorField');
    expect(getFieldTypeSpec('mobile').xmlTag).toBe('MobileField');
  });

  it('base_data requires refBaseDataObjectKey', () => {
    expect(getFieldTypeSpec('base_data').requiredExtraProps).toContain('refBaseDataObjectKey');
  });

  it('base_property requires sourceField + srcDisplayFieldName', () => {
    expect(getFieldTypeSpec('base_property').requiredExtraProps).toEqual(
      expect.arrayContaining(['sourceField', 'srcDisplayFieldName'])
    );
  });

  it('combo + mul_combo require enumTypeGuid', () => {
    expect(getFieldTypeSpec('combo').requiredExtraProps).toContain('enumTypeGuid');
    expect(getFieldTypeSpec('mul_combo').requiredExtraProps).toContain('enumTypeGuid');
  });

  it('simple types (text/int/decimal/etc.) have no required extra props', () => {
    expect(getFieldTypeSpec('text').requiredExtraProps).toEqual([]);
    expect(getFieldTypeSpec('int').requiredExtraProps).toEqual([]);
    expect(getFieldTypeSpec('date').requiredExtraProps).toEqual([]);
    expect(getFieldTypeSpec('datetime').requiredExtraProps).toEqual([]);
  });

  it('date and datetime share xmlTag but spec carries dateOnly flag', () => {
    expect(getFieldTypeSpec('date').dateOnly).toBe(true);
    expect(getFieldTypeSpec('datetime').dateOnly).toBe(false);
  });

  it('getFieldTypeSpec throws on unknown type', () => {
    expect(() => getFieldTypeSpec('not_a_type' as FieldType)).toThrow();
  });
});

describe('insertFieldIntoKernelXml — simple types', () => {
  // 11 类 "TextField-shape" 字段(只是 tag 名换),共享同一份 render 模板。
  // 每行: [type, xmlTag, ElementType 数值]。
  // ElementType 是 BOS XML schema 关键属性,不同类型必须不同 — 基于
  // SAL_SaleOrder 真 FKERNELXML 实证(见 memory `bos_field_xml_realities.md`)。
  const SIMPLE_CASES: Array<[FieldType, string, number]> = [
    ['text',       'TextField',           1],
    ['large_text', 'LargeRichTextField',  1],
    ['int',        'IntegerField',        3],
    ['decimal',    'DecimalField',        2],
    ['amount',     'AmountField',         21],
    ['qty',        'QtyField',            22],
    ['date',       'DateTimeField',       5],
    ['datetime',   'DateTimeField',       5],
    ['checkbox',   'CheckBoxField',       8],
    ['color',      'ColorField',          1],
    ['mobile',     'MobileField',         1]
  ];

  it.each(SIMPLE_CASES)('%s emits matching field + appearance tags + correct ElementType', (type, tag, elementType) => {
    const out = insertFieldIntoKernelXml(BASE_XML, type, {
      spec: { key: 'F_TEST', caption: '测试' },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(new RegExp(`<${tag}[ >]`));
    expect(out).toMatch(new RegExp(`<${tag}Appearance[ >]`));
    // Both the field-side AND the appearance-side ElementType are type-
    // specific. Earlier code wrote `Appearance ElementType="1"` for every
    // type, which made BOS Designer mis-render non-text fields as text and
    // emit "QtyField does not have property Editlen" warnings (2026-04-26
    // user demo实证). Lock that in.
    expect(out).toMatch(new RegExp(`<${tag} ElementType="${elementType}" `));
    expect(out).toMatch(new RegExp(`<${tag}Appearance ElementType="${elementType}" `));
  });

  it('CheckBoxFieldAppearance does NOT emit EmptyText (no placeholder concept for yes/no widget)', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'checkbox', {
      spec: { key: 'F_CB', caption: '是否启用' },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    // Slice the appearance node, then assert no EmptyText inside.
    const apMatch = out.match(/<CheckBoxFieldAppearance[\s\S]*?<\/CheckBoxFieldAppearance>/);
    expect(apMatch).toBeTruthy();
    expect(apMatch![0]).not.toMatch(/<EmptyText/);
  });

  it('decimal / amount / qty emit FieldPrecision=23 + FieldScale=10 (BOS dragged-default)', () => {
    // Without these, BOS sees C# default 0/0 and rejects the field on bill
    // save: "字段的小数精度不能大于等于整体精度" (2026-04-26 user实证).
    for (const type of ['decimal', 'amount', 'qty'] as const) {
      const out = insertFieldIntoKernelXml(BASE_XML, type, {
        spec: { key: `F_${type.toUpperCase()}`, caption: type },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      });
      expect(out, `${type} missing FieldPrecision`).toContain('<FieldPrecision>23</FieldPrecision>');
      expect(out, `${type} missing FieldScale`).toContain('<FieldScale>10</FieldScale>');
    }
  });

  it('int emits FieldPrecision=10 + FieldScale=0 (integer has no decimals)', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'int', {
      spec: { key: 'F_INT', caption: '整数' },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toContain('<FieldPrecision>10</FieldPrecision>');
    expect(out).toContain('<FieldScale>0</FieldScale>');
  });

  it('TextFieldAppearance keeps EmptyText (regression — was right before, must stay)', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'text', {
      spec: { key: 'F_T', caption: '文本' },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    const apMatch = out.match(/<TextFieldAppearance[\s\S]*?<\/TextFieldAppearance>/);
    expect(apMatch![0]).toContain('<EmptyText action="setnull"/>');
  });

  it('shared body — Key/Caption/Container all serialize regardless of type', () => {
    for (const [type] of SIMPLE_CASES) {
      const out = insertFieldIntoKernelXml(BASE_XML, type, {
        spec: { key: 'F_X', caption: '中文标签' },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      });
      expect(out, `${type} missing Key`).toContain('<Key>F_X</Key>');
      expect(out, `${type} missing Caption`).toContain('<Caption>中文标签</Caption>');
      expect(out, `${type} missing Container`).toContain('<Container>FTAB_P0</Container>');
    }
  });

  it('date type sets DateOnly mode (sub-element)', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'date', {
      spec: { key: 'F_DATE', caption: '日期' },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    // Date-only mode emits a marker the BOS Designer reads as "show 日期 picker not 日期时间"
    expect(out).toMatch(/<EditFormat>yyyy-MM-dd<\/EditFormat>/);
  });

  it('datetime type does NOT set date-only marker', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'datetime', {
      spec: { key: 'F_DT', caption: '日期时间' },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).not.toMatch(/<EditFormat>yyyy-MM-dd<\/EditFormat>/);
  });

  it('rejects empty key', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'int', {
        spec: { key: '', caption: '空 key' },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/key/);
  });

  it('rejects XML with no </Form>', () => {
    expect(() =>
      insertFieldIntoKernelXml('<not-an-extension/>', 'int', {
        spec: { key: 'F_X', caption: 'x' },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/Form/);
  });
});

describe('insertFieldIntoKernelXml — combo / mul_combo', () => {
  // GUID-shape fixture for the FORMENUM row created by the writer layer
  // (see `bos-writer.ts → createFormEnum`). XML layer only sees this GUID;
  // ComboItems are inserted separately into T_META_FORMENUMITEM (+ _L).
  const ENUM_GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('combo emits <EnumType> referencing the FORMENUM row, not <ComboItems>', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'combo', {
      spec: { key: 'F_PRIORITY', caption: '优先级', enumTypeGuid: ENUM_GUID },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(/<ComboField[ >]/);
    expect(out).toContain(`<EnumType>${ENUM_GUID}</EnumType>`);
    // BOS silently drops <ComboItems>; never emit it.
    expect(out).not.toMatch(/<ComboItems>/);
    // Editlen=36 default — matches real SAL_SaleOrder ComboField + what
    // BOS Designer auto-fills if absent.
    expect(out).toContain('<Editlen>36</Editlen>');
  });

  it('mul_combo emits MulComboField + <EnumType> (same path as combo)', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'mul_combo', {
      spec: { key: 'F_TAGS', caption: '标签', enumTypeGuid: ENUM_GUID },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(/<MulComboField[ >]/);
    expect(out).toContain(`<EnumType>${ENUM_GUID}</EnumType>`);
    expect(out).not.toMatch(/<ComboItems>/);
  });

  it('combo without enumTypeGuid throws', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'combo', {
        spec: { key: 'F_P', caption: '优先级' }, // no enumTypeGuid
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/enumTypeGuid/);
  });

  it('mul_combo without enumTypeGuid throws', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'mul_combo', {
        spec: { key: 'F_T', caption: '标签' },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/enumTypeGuid/);
  });
});

describe('insertFieldIntoKernelXml — base_data', () => {
  // GUID-shape fixture: SAL_SaleOrder 上 F客户 的 LookUpObjectID 实例。
  // 工具层把 'BD_Customer' 翻译成 GUID 后,XML 层只看 GUID。
  const FIXTURE_GUID = '407d24cb-57f7-46bf-afb6-a9ab458fd845';

  it('emits BaseDataField tag + ElementType=13 + LookUpObjectID + Appearance ElementType=7', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'base_data', {
      spec: {
        key: 'F_REFCUST',
        caption: '关联客户',
        refBaseDataObjectKey: FIXTURE_GUID
      },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(/<BaseDataField ElementType="13" /);
    // Real BOS XML uses `<LookUpObjectID>{guid}</LookUpObjectID>`,
    // NOT `<RefBaseDataObjectType>{key}` (the latter was a training-data
    // hallucination — see memory `bos_field_xml_realities.md`).
    expect(out).toContain(`<LookUpObjectID>${FIXTURE_GUID}</LookUpObjectID>`);
    // BaseDataField is the only type where field-node ElementType (13) and
    // appearance-node ElementType (7) differ — verified against real
    // SAL_SaleOrder F客户 节点。
    expect(out).toMatch(/<BaseDataFieldAppearance ElementType="7" /);
    expect(out).toContain('<Key>F_REFCUST</Key>');
    expect(out).toContain('<Caption>关联客户</Caption>');
  });

  it('rejects base_data without refBaseDataObjectKey', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'base_data', {
        spec: { key: 'F_R', caption: '客户' }, // no refBaseDataObjectKey
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/refBaseDataObjectKey/);
  });
});

describe('insertFieldIntoKernelXml — base_property', () => {
  it('base_property emits ControlFieldKey + SrcDisplayFieldName + SrcBaseDataDisplayType', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'base_property', {
      spec: {
        key: 'F_CUSTNAME',
        caption: '客户名称',
        sourceField: 'FCustId',
        srcDisplayFieldName: 'FName'
      },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(/<BasePropertyField ElementType="14" /);
    // C# 类属性叫 SourceField, 但 BOS XML 序列化用 ControlFieldKey ——
    // 这是真单据 (SAL_SaleOrder F结算方地址) XML 实证的命名,不能写
    // <SourceField>。详见 memory bos_field_xml_realities.md。
    expect(out).toContain('<ControlFieldKey>FCustId</ControlFieldKey>');
    expect(out).toContain('<SrcDisplayFieldName>FName</SrcDisplayFieldName>');
    expect(out).toContain('<SrcBaseDataDisplayType action="setnull"/>');
    expect(out).not.toMatch(/<SourceField>/);
  });

  it('base_property rejects missing sourceField', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'base_property', {
        spec: { key: 'F_X', caption: 'x', srcDisplayFieldName: 'FName' },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/sourceField/);
  });

  it('base_property rejects missing srcDisplayFieldName', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'base_property', {
        spec: { key: 'F_X', caption: 'x', sourceField: 'FCustId' },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/srcDisplayFieldName/);
  });

  // reference_property dropped in v0.1 — see FIELD_TYPES comment in bos-xml.ts.
});
