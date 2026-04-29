import { describe, expect, it } from 'vitest';
import { regenerateGuidsInXml } from '../../../src/main/erp/k3cloud/rpc/regenerate-guids';

const DASHED_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const COMPACT_RE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/g;

describe('regenerateGuidsInXml', () => {
  it('rotates a single dashed GUID', () => {
    const input = '<Id>6cd6a0c7-6abb-4014-afc1-790eaf19526e</Id>';
    const out = regenerateGuidsInXml(input);
    expect(out).not.toBe(input);
    expect(out).toMatch(/<Id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}<\/Id>/);
  });

  it('rotates a single compact 32-hex GUID', () => {
    const input = '<Id>521162116b1442c6a4fcb70cdca6c57c</Id>';
    const out = regenerateGuidsInXml(input);
    expect(out).not.toBe(input);
    expect(out).toMatch(/<Id>[0-9a-f]{32}<\/Id>/);
  });

  it('preserves surrounding XML structure', () => {
    const input =
      '<FieldMap ElementType="60002"><TargetFieldKey>FBillNo</TargetFieldKey>' +
      '<Id>521162116b1442c6a4fcb70cdca6c57c</Id><Key /><ElementType>60002</ElementType></FieldMap>';
    const out = regenerateGuidsInXml(input);
    expect(out).toContain('<FieldMap ElementType="60002">');
    expect(out).toContain('<TargetFieldKey>FBillNo</TargetFieldKey>');
    expect(out).toContain('<Key />');
    expect(out).toContain('<ElementType>60002</ElementType>');
    expect(out).toContain('</FieldMap>');
  });

  it('rotates every GUID in a real-shaped XML (no GUID survives)', () => {
    const input =
      '<Policies>' +
      '<LinkEntityPolicy ElementType="7008"><Id>6cd6a0c7-6abb-4014-afc1-790eaf19526e</Id></LinkEntityPolicy>' +
      '<DefaultConvertPolicy><FieldMaps>' +
      '<FieldMap><Id>521162116b1442c6a4fcb70cdca6c57c</Id></FieldMap>' +
      '<FieldMap><Id>f8f0aadcac7a41219f19a8c7fa106b6c</Id></FieldMap>' +
      '</FieldMaps></DefaultConvertPolicy>' +
      '</Policies>';
    const out = regenerateGuidsInXml(input);
    const oldDashed = input.match(DASHED_RE) ?? [];
    const oldCompact = input.match(COMPACT_RE) ?? [];
    for (const g of [...oldDashed, ...oldCompact]) {
      expect(out).not.toContain(g);
    }
    const newDashed = out.match(DASHED_RE) ?? [];
    const newCompact = out.match(COMPACT_RE) ?? [];
    expect(newDashed).toHaveLength(oldDashed.length);
    expect(newCompact).toHaveLength(oldCompact.length);
  });

  it('produces freshly-unique GUIDs (no collisions between rotated values)', () => {
    const input =
      '<a>11111111-2222-3333-4444-555555555555</a>' +
      '<b>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</b>' +
      '<c>bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</c>';
    const out = regenerateGuidsInXml(input);
    const dashed = out.match(DASHED_RE) ?? [];
    const compact = out.match(COMPACT_RE) ?? [];
    expect(dashed).toHaveLength(1);
    expect(compact).toHaveLength(2);
    expect(compact[0]).not.toBe(compact[1]);
  });

  it('returns input unchanged when no GUIDs present', () => {
    const input = '<Foo>bar</Foo><Empty /><Number>42</Number>';
    expect(regenerateGuidsInXml(input)).toBe(input);
  });

  it('does not match short hex strings (< 32 chars)', () => {
    const input = '<n>deadbeef</n><n>cafebabedeadbeef</n>';
    // No 32-hex run in either; output should be unchanged
    expect(regenerateGuidsInXml(input)).toBe(input);
  });
});
