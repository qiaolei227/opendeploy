import { describe, expect, it } from 'vitest';
import { parseFieldsFromKernelXml } from '../../src/main/erp/k3cloud/queries';

/**
 * Fixtures mirror the real K/3 Cloud FormMetadata shape: each field is an
 * element whose tag name is the type (BaseDataField, TextField, …), whose
 * own identity is declared via CHILD elements (<Name>, <Key>, <EntityKey>).
 * All real fields sit FLAT at the top level of <Elements>; entry
 * affiliation comes from a direct-child <EntityKey>, not from nesting
 * inside <EntryEntity>. Nested structures like RefProperty / UpdateActions
 * can contain their own <Key> tags — the parser must only take the top-
 * level one.
 */
describe('parseFieldsFromKernelXml', () => {
  it('returns empty for empty or structureless XML', () => {
    expect(parseFieldsFromKernelXml('')).toEqual([]);
    expect(parseFieldsFromKernelXml('<FormMetadata></FormMetadata>')).toEqual([]);
    expect(parseFieldsFromKernelXml('<FormMetadata><Elements/></FormMetadata>')).toEqual([]);
  });

  it('extracts a head field from its direct-child Key / Name', () => {
    const xml = [
      '<FormMetadata><Elements>',
      '<TextField ElementType="0" ElementStyle="0">',
      '<Name>单据编号</Name>',
      '<Id>uuid-1</Id>',
      '<Key>FBillNo</Key>',
      '</TextField>',
      '</Elements></FormMetadata>'
    ].join('');
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual({
      key: 'FBillNo',
      name: '单据编号',
      type: 'TextField',
      isEntryField: false,
      entryKey: undefined
    });
  });

  it('ignores <Key> tags nested inside sub-structures (RefProperty, etc.)', () => {
    // The BaseDataField's OWN <Key>FCustId</Key> is at top level, but
    // it also has many <RefProperty><Key>...</Key></RefProperty> children
    // whose Keys reference OTHER fields. The parser must only return
    // FCustId.
    const xml = [
      '<BaseDataField>',
      '<RefPropertyKeys>',
      '<RefProperty><Key>FPRICELISTID</Key></RefProperty>',
      '<RefProperty><Key>FSETTLETYPEID</Key></RefProperty>',
      '</RefPropertyKeys>',
      '<Name>客户</Name>',
      '<Id>uuid-cust</Id>',
      '<Key>FCustId</Key>',
      '</BaseDataField>'
    ].join('');
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      key: 'FCustId',
      name: '客户',
      type: 'BaseDataField'
    });
  });

  it('keeps type from the element tag name (BaseDataField, AmountField, …)', () => {
    const xml = [
      '<Elements>',
      '<BaseDataField><Name>客户</Name><Key>FCustId</Key></BaseDataField>',
      '<AmountField><Name>金额</Name><Key>FAmount</Key></AmountField>',
      '<CheckBoxField><Name>已审核</Name><Key>FChecked</Key></CheckBoxField>',
      '</Elements>'
    ].join('');
    const types = parseFieldsFromKernelXml(xml).map((f) => f.type);
    expect(types).toEqual(['BaseDataField', 'AmountField', 'CheckBoxField']);
  });

  it('uses direct-child <EntityKey> to mark entry fields', () => {
    // Real K/3 Cloud: fields are listed flat at top level of Elements,
    // with <EntityKey> naming the enclosing entry when applicable.
    const xml = [
      '<FormMetadata><Elements>',
      // Head field — no EntityKey.
      '<BaseDataField><Name>客户</Name><Key>FCustId</Key></BaseDataField>',
      // Entry field — EntityKey points to FSaleOrderEntry.
      '<BaseDataField>',
      '<EntityKey>FSaleOrderEntry</EntityKey>',
      '<Name>物料编码</Name>',
      '<Key>FMaterialId</Key>',
      '</BaseDataField>',
      '<QtyField>',
      '<EntityKey>FSaleOrderEntry</EntityKey>',
      '<Name>销售数量</Name>',
      '<Key>FQty</Key>',
      '</QtyField>',
      '</Elements></FormMetadata>'
    ].join('');
    const byKey = Object.fromEntries(parseFieldsFromKernelXml(xml).map((f) => [f.key, f]));
    expect(byKey.FCustId.isEntryField).toBe(false);
    expect(byKey.FCustId.entryKey).toBeUndefined();
    expect(byKey.FMaterialId.isEntryField).toBe(true);
    expect(byKey.FMaterialId.entryKey).toBe('FSaleOrderEntry');
    expect(byKey.FQty.entryKey).toBe('FSaleOrderEntry');
  });

  it('ignores <EntityKey> tags nested inside sub-structures', () => {
    // If EntityKey appears only inside a nested block, it shouldn't promote
    // the field to entry status.
    const xml = [
      '<BaseDataField>',
      '<UpdateActions>',
      '<FormBusinessService><EntityKey>FFake</EntityKey></FormBusinessService>',
      '</UpdateActions>',
      '<Name>客户</Name><Key>FCustId</Key>',
      '</BaseDataField>'
    ].join('');
    const f = parseFieldsFromKernelXml(xml)[0];
    expect(f.isEntryField).toBe(false);
    expect(f.entryKey).toBeUndefined();
  });

  it('deduplicates fields that reappear in layout / duplicate sections', () => {
    const xml = [
      '<Elements>',
      '<TextField><Name>单据编号</Name><Key>FBillNo</Key></TextField>',
      '<TextField><Name>单据编号</Name><Key>FBillNo</Key></TextField>',
      '</Elements>'
    ].join('');
    expect(parseFieldsFromKernelXml(xml)).toHaveLength(1);
  });

  it('skips pseudo-field nodes without a <Name> child', () => {
    // Internal markers like <QKFField> have a <Key> but no <Name>. They
    // would otherwise steal the slot from the real field via first-wins
    // dedup, leaving the user staring at "FCustId · FCustId".
    const xml = [
      '<FormMetadata>',
      '<QKFField><Key>FCustId</Key></QKFField>',
      '<BaseDataField><Name>客户</Name><Key>FCustId</Key></BaseDataField>',
      '</FormMetadata>'
    ].join('');
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      key: 'FCustId',
      name: '客户',
      type: 'BaseDataField'
    });
  });

  it('skips Appearance-like tags whose name ends in something other than "Field"', () => {
    const xml = [
      '<BaseDataField>',
      '<BaseDataFieldAppearance><FieldKey>FCustId</FieldKey></BaseDataFieldAppearance>',
      '<Name>客户</Name>',
      '<Key>FCustId</Key>',
      '</BaseDataField>'
    ].join('');
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe('FCustId');
  });

  it('skips field nodes with no <Key> child', () => {
    expect(parseFieldsFromKernelXml('<TextField><Name>orphan</Name></TextField>')).toEqual([]);
  });
});
