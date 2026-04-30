import { describe, it, expect } from 'vitest';
import { buildPatchBaseXml } from '../../../src/main/erp/k3cloud/rpc/build-patch-base-xml';

/**
 * Hand-crafted minimal template that mirrors the structural shape of the
 * bundled `sale-order-outstock-extension-template.xml` (captured from BOS
 * Designer's create-extension flow) — full Policies collection with one
 * DefaultConvertPolicy carrying a FieldMaps block + cloned FieldMap entries
 * + rule-level Name/Id/Key/ElementType triple after </Policies>.
 *
 * Real bundled template is ~52 KB; this fixture covers every shape the
 * helper needs to manipulate without dragging the whole baseline file in.
 */
const FIXTURE_TEMPLATE =
  '<?xml version="1.0" encoding="utf-16"?>' +
  '<ConvertRuleMetaData><Rule>' +
  '<ConvertRule ElementType="6000" ElementStyle="0">' +
  '<SourceFormId>SAL_SaleOrder</SourceFormId>' +
  '<TargetFormId>SAL_OUTSTOCK</TargetFormId>' +
  '<Policies>' +
  '<LinkEntityPolicy ElementType="7008" ElementStyle="0">' +
  '<Id>6cd6a0c7-6abb-4014-afc1-790eaf19526e</Id>' +
  '</LinkEntityPolicy>' +
  '<DefaultConvertPolicy ElementType="7002" ElementStyle="0">' +
  '<SourceEntryKey /><TargetEntryKey />' +
  '<FieldMaps>' +
  '<FieldMap ElementType="60002" ElementStyle="0">' +
  '<TargetFieldKey>FBillNo</TargetFieldKey>' +
  '<SourceFieldKey>FBillNo</SourceFieldKey>' +
  '<Id>521162116b1442c6a4fcb70cdca6c57c</Id>' +
  '</FieldMap>' +
  '<FieldMap ElementType="60002" ElementStyle="0">' +
  '<TargetFieldKey>FDate</TargetFieldKey>' +
  '<Id>019edba80ce049b5be3d6967be58dd5c</Id>' +
  '</FieldMap>' +
  '</FieldMaps>' +
  '<Id>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</Id>' +
  '</DefaultConvertPolicy>' +
  '<ConvertGroupByPolicy ElementType="7003" ElementStyle="0">' +
  '<Id>11111111-2222-3333-4444-555555555555</Id>' +
  '</ConvertGroupByPolicy>' +
  '</Policies>' +
  '<Name>转换规则</Name>' +
  '<Id>793e8fdc-da7f-4058-a6b6-08422cd82688</Id>' +
  '<Key>fd7c0d17-162c-4af0-8865-d88b56f8bbbf</Key>' +
  '<ElementType>6000</ElementType>' +
  '</ConvertRule>' +
  '</Rule></ConvertRuleMetaData>';

describe('buildPatchBaseXml', () => {
  it('clears every FieldMap entry — empty <FieldMaps /> only', () => {
    const xml = buildPatchBaseXml({
      templateXml: FIXTURE_TEMPLATE,
      newExtensionId: 'newexta1b2c3d4e5f60718293a4b5c6d7e8',
      displayName: 'X',
    });
    // No FieldMap nodes survive
    expect(xml.includes('<FieldMap ')).toBe(false);
    expect(xml.includes('FBillNo')).toBe(false);
    expect(xml.includes('521162116b1442c6a4fcb70cdca6c57c')).toBe(false);
    // Wrapper present and self-closing — bridge needs the collection schema
    // to mount FieldMaps.Add into.
    expect(xml.includes('<FieldMaps />')).toBe(true);
    expect(xml.includes('<FieldMaps>')).toBe(false);
  });

  it('preserves every Policy shell so bridge RequirePolicy<T> succeeds', () => {
    const xml = buildPatchBaseXml({
      templateXml: FIXTURE_TEMPLATE,
      newExtensionId: 'newexta1b2c3d4e5f60718293a4b5c6d7e8',
      displayName: 'X',
    });
    expect(xml).toMatch(/<LinkEntityPolicy[^>]+>/);
    expect(xml).toMatch(/<DefaultConvertPolicy[^>]+ElementType="7002"[^>]*>/);
    expect(xml).toMatch(/<ConvertGroupByPolicy[^>]+>/);
  });

  it('preserves DefaultConvertPolicy mount-point keys (TargetEntryKey / SourceEntryKey)', () => {
    const xml = buildPatchBaseXml({
      templateXml: FIXTURE_TEMPLATE,
      newExtensionId: 'newexta1b2c3d4e5f60718293a4b5c6d7e8',
      displayName: 'X',
    });
    // Header-level DCP carries empty TargetEntryKey — bridge matches via
    // string.IsNullOrEmpty(targetEntryKey), so the self-closing tag must
    // survive the rewrite.
    expect(xml).toMatch(/<TargetEntryKey \/>/);
    expect(xml).toMatch(/<SourceEntryKey \/>/);
  });

  it('replaces the rule-level Id / Key with newExtensionId', () => {
    const newId = 'cafebabedeadbeef000102030405060708';
    const xml = buildPatchBaseXml({
      templateXml: FIXTURE_TEMPLATE,
      newExtensionId: newId,
      displayName: '我的扩展',
    });
    // Original placeholders gone
    expect(xml.includes('793e8fdc-da7f-4058-a6b6-08422cd82688')).toBe(false);
    expect(xml.includes('fd7c0d17-162c-4af0-8865-d88b56f8bbbf')).toBe(false);
    // New rule-level Id+Key present after </Policies>
    expect(xml).toContain(`</Policies><Name>我的扩展</Name><Id>${newId}</Id><Key>${newId}</Key>`);
  });

  it('escapes angle brackets / ampersands / quotes in displayName', () => {
    const xml = buildPatchBaseXml({
      templateXml: FIXTURE_TEMPLATE,
      newExtensionId: 'newexta1b2c3d4e5f60718293a4b5c6d7e8',
      displayName: 'a&b <c> "d"',
    });
    expect(xml).toContain('<Name>a&amp;b &lt;c&gt; &quot;d&quot;</Name>');
  });

  it('rotates internal Policy / FieldMap GUIDs so multiple extensions do not collide', () => {
    const xml1 = buildPatchBaseXml({
      templateXml: FIXTURE_TEMPLATE,
      newExtensionId: 'extone1111111111111111111111111111',
      displayName: 'Ext 1',
    });
    const xml2 = buildPatchBaseXml({
      templateXml: FIXTURE_TEMPLATE,
      newExtensionId: 'exttwo2222222222222222222222222222',
      displayName: 'Ext 2',
    });
    // Internal LinkEntityPolicy.Id from the template should NOT appear
    // in either output (rotated independently each call).
    expect(xml1.includes('6cd6a0c7-6abb-4014-afc1-790eaf19526e')).toBe(false);
    expect(xml2.includes('6cd6a0c7-6abb-4014-afc1-790eaf19526e')).toBe(false);
    // The two outputs should differ on Policy ids beyond just the rule-level id
    expect(xml1).not.toBe(xml2);
  });

  it('throws when template lacks the rule-level Id/Key triple', () => {
    const malformed =
      '<?xml version="1.0"?><ConvertRuleMetaData><Rule>' +
      '<ConvertRule ElementType="6000"><Policies></Policies></ConvertRule>' +
      '</Rule></ConvertRuleMetaData>';
    expect(() =>
      buildPatchBaseXml({
        templateXml: malformed,
        newExtensionId: 'newexta1b2c3d4e5f60718293a4b5c6d7e8',
        displayName: 'X',
      }),
    ).toThrow(/cannot locate rule-level Name\/Id\/Key/);
  });

  it('handles template without <Name> (Name node optional in capture)', () => {
    // Some captured templates omit the rule-level <Name>; the regex must
    // still match Id/Key alone after </Policies>.
    const noName = FIXTURE_TEMPLATE.replace('<Name>转换规则</Name>', '');
    const xml = buildPatchBaseXml({
      templateXml: noName,
      newExtensionId: 'newexta1b2c3d4e5f60718293a4b5c6d7e8',
      displayName: 'New Name',
    });
    expect(xml).toContain('</Policies><Name>New Name</Name><Id>newexta1b2c3d4e5f60718293a4b5c6d7e8</Id>');
  });
});
