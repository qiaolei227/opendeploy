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
  it('declares all 16 expected types', () => {
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
      'reference_property',
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
    expect(getFieldTypeSpec('reference_property').xmlTag).toBe('ReferencePropertyField');
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

  it('reference_property requires sourceField', () => {
    expect(getFieldTypeSpec('reference_property').requiredExtraProps).toContain('sourceField');
  });

  it('combo + mul_combo require comboItems', () => {
    expect(getFieldTypeSpec('combo').requiredExtraProps).toContain('comboItems');
    expect(getFieldTypeSpec('mul_combo').requiredExtraProps).toContain('comboItems');
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
  // 11 类 "TextField-shape" 字段(只是 tag 名换),共享同一份 render 模板
  const SIMPLE_CASES: Array<[FieldType, RegExp, RegExp]> = [
    ['text',       /<TextField[ >]/,            /<TextFieldAppearance[ >]/],
    ['large_text', /<LargeRichTextField[ >]/,   /<LargeRichTextFieldAppearance[ >]/],
    ['int',        /<IntegerField[ >]/,         /<IntegerFieldAppearance[ >]/],
    ['decimal',    /<DecimalField[ >]/,         /<DecimalFieldAppearance[ >]/],
    ['amount',     /<AmountField[ >]/,          /<AmountFieldAppearance[ >]/],
    ['qty',        /<QtyField[ >]/,             /<QtyFieldAppearance[ >]/],
    ['date',       /<DateTimeField[ >]/,        /<DateTimeFieldAppearance[ >]/],
    ['datetime',   /<DateTimeField[ >]/,        /<DateTimeFieldAppearance[ >]/],
    ['checkbox',   /<CheckBoxField[ >]/,        /<CheckBoxFieldAppearance[ >]/],
    ['color',      /<ColorField[ >]/,           /<ColorFieldAppearance[ >]/],
    ['mobile',     /<MobileField[ >]/,          /<MobileFieldAppearance[ >]/]
  ];

  it.each(SIMPLE_CASES)('%s emits matching field + appearance tags', (type, fieldRe, apRe) => {
    const out = insertFieldIntoKernelXml(BASE_XML, type, {
      spec: { key: 'F_TEST', caption: '测试' },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(fieldRe);
    expect(out).toMatch(apRe);
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
  it('combo emits ComboItems with provided values', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'combo', {
      spec: {
        key: 'F_PRIORITY',
        caption: '优先级',
        comboItems: [
          { value: 'H', caption: '高' },
          { value: 'M', caption: '中' },
          { value: 'L', caption: '低' }
        ]
      },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(/<ComboField[ >]/);
    expect(out).toMatch(/<ComboItems>/);
    expect(out).toContain('<Value>H</Value>');
    expect(out).toContain('<Caption>高</Caption>');
    expect(out).toContain('<Value>M</Value>');
    expect(out).toContain('<Value>L</Value>');
  });

  it('mul_combo emits MulComboField + ComboItems', () => {
    const out = insertFieldIntoKernelXml(BASE_XML, 'mul_combo', {
      spec: {
        key: 'F_TAGS',
        caption: '标签',
        comboItems: [{ value: 'A', caption: 'A 类' }]
      },
      idGenerator: FIXED_IDS(),
      numericGenerator: FIXED_NUMERICS
    });
    expect(out).toMatch(/<MulComboField[ >]/);
    expect(out).toMatch(/<ComboItems>/);
    expect(out).toContain('<Value>A</Value>');
  });

  it('combo without comboItems throws', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'combo', {
        spec: { key: 'F_P', caption: '优先级' }, // no comboItems
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/comboItems/);
  });

  it('mul_combo without comboItems throws', () => {
    expect(() =>
      insertFieldIntoKernelXml(BASE_XML, 'mul_combo', {
        spec: { key: 'F_T', caption: '标签' },
        idGenerator: FIXED_IDS(),
        numericGenerator: FIXED_NUMERICS
      })
    ).toThrow(/comboItems/);
  });
});
