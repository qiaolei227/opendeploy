import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  getFieldTypeSpec,
  type FieldType
} from '../../src/main/erp/k3cloud/bos-xml';

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
