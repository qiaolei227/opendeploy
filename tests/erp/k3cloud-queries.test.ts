import { describe, expect, it } from 'vitest';
import { parseFieldsFromKernelXml } from '../../src/main/erp/k3cloud/queries';

describe('parseFieldsFromKernelXml', () => {
  it('returns empty array for empty or junk input', () => {
    expect(parseFieldsFromKernelXml('')).toEqual([]);
    expect(parseFieldsFromKernelXml('<FormMetadata></FormMetadata>')).toEqual([]);
  });

  it('extracts a standalone Field tag', () => {
    const xml =
      '<FormMetadata><Elements><Field Key="FNumber" ElementType="TextField"/></Elements></FormMetadata>';
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      key: 'FNumber',
      type: 'TextField',
      isEntryField: false
    });
  });

  it('extracts typed field tags (BasedataField, DecimalField, etc.)', () => {
    const xml = [
      '<FormMetadata><Elements>',
      '<BasedataField Key="FCustomerId" ElementType="BasedataField"/>',
      '<DecimalField Key="FPrice" ElementType="DecimalField"/>',
      '<TextField Key="FNote" ElementType="TextField"/>',
      '</Elements></FormMetadata>'
    ].join('');
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields.map((f) => f.key)).toEqual(['FCustomerId', 'FPrice', 'FNote']);
    expect(fields.map((f) => f.type)).toEqual([
      'BasedataField',
      'DecimalField',
      'TextField'
    ]);
  });

  it('marks fields inside Entity/SubEntity as entry fields', () => {
    const xml = [
      '<FormMetadata><Elements>',
      '<BasedataField Key="FCustomerId" ElementType="BasedataField"/>',
      '<Entity Key="FSaleOrderEntry"><Elements>',
      '<BasedataField Key="FMaterialId" ElementType="BasedataField"/>',
      '<DecimalField Key="FQty" ElementType="DecimalField"/>',
      '</Elements></Entity>',
      '</Elements></FormMetadata>'
    ].join('');
    const fields = parseFieldsFromKernelXml(xml);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.FCustomerId.isEntryField).toBe(false);
    expect(byKey.FCustomerId.entryKey).toBeUndefined();
    expect(byKey.FMaterialId.isEntryField).toBe(true);
    expect(byKey.FMaterialId.entryKey).toBe('FSaleOrderEntry');
    expect(byKey.FQty.entryKey).toBe('FSaleOrderEntry');
  });

  it('deduplicates fields that appear in multiple layout sections', () => {
    const xml = [
      '<FormMetadata>',
      '<Field Key="FCustomerId" ElementType="BasedataField"/>',
      '<Field Key="FCustomerId" ElementType="BasedataField"/>',
      '</FormMetadata>'
    ].join('');
    expect(parseFieldsFromKernelXml(xml)).toHaveLength(1);
  });

  it('uses "Unknown" for fields missing a useful ElementType', () => {
    const xml =
      '<FormMetadata><Field Key="FWeird" ElementType=""/></FormMetadata>';
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields[0]?.type).toBe('Unknown');
  });
});
