import { describe, expect, it } from 'vitest';
import { extractLayoutInfoOid } from '../../../src/main/erp/k3cloud/rpc/layout-discovery';

describe('extractLayoutInfoOid', () => {
  it('finds oid in <LayoutInfo oid="...">', () => {
    const xml =
      '<FormMetadata><LayoutInfos><LayoutInfo oid="bc952920-057d-4790-9c27-1134091eb298"><Appearances/></LayoutInfo></LayoutInfos></FormMetadata>';
    expect(extractLayoutInfoOid(xml)).toBe('bc952920-057d-4790-9c27-1134091eb298');
  });

  it('finds oid even when other attributes precede it', () => {
    const xml =
      '<LayoutInfo Name="Main" action="edit" oid="bc952920-057d-4790-9c27-1134091eb298" Visible="1">';
    expect(extractLayoutInfoOid(xml)).toBe('bc952920-057d-4790-9c27-1134091eb298');
  });

  it('returns null when no LayoutInfo element exists', () => {
    expect(extractLayoutInfoOid('<FormMetadata></FormMetadata>')).toBeNull();
  });

  it('returns null when LayoutInfo has no oid attr', () => {
    expect(extractLayoutInfoOid('<LayoutInfo Name="Main">')).toBeNull();
  });

  it('takes the first when multiple LayoutInfo elements exist', () => {
    const xml =
      '<LayoutInfo oid="first-guid"><LayoutInfo oid="second-guid">';
    expect(extractLayoutInfoOid(xml)).toBe('first-guid');
  });

  it('is case-insensitive on the tag name and oid attr', () => {
    expect(
      extractLayoutInfoOid('<layoutinfo OID="abc-123">'),
    ).toBe('abc-123');
  });

  it('does not match LayoutInfos plural tag (only LayoutInfo singular)', () => {
    // Word boundary on "LayoutInfo" should reject "LayoutInfos"
    const xml = '<LayoutInfos oid="wrapper-id"></LayoutInfos>';
    expect(extractLayoutInfoOid(xml)).toBeNull();
  });
});
