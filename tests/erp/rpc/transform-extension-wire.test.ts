import { describe, expect, it } from 'vitest';
import {
  parsePolicyOidMap,
  transformPatchedToExtensionWire,
} from '../../../src/main/erp/k3cloud/rpc/transform-extension-wire';

// Minimal origin XML mirroring the structure of a real K/3 convert rule:
// each Policy node ends with its own <Id> child (the "oid"); preceding
// <Id>s belong to nested elements (FieldMaps etc.).
const ORIGIN_XML = `
<ConvertRuleMetaData><Rule><ConvertRule ElementType="6000" ElementStyle="0">
  <Policies>
    <DefaultConvertPolicy ElementType="7002" ElementStyle="0">
      <FieldMaps>
        <FieldMap ElementType="60002"><Id>fm-1</Id></FieldMap>
        <FieldMap ElementType="60002"><Id>fm-2</Id></FieldMap>
      </FieldMaps>
      <Id>oid-default</Id>
    </DefaultConvertPolicy>
    <ConvertPlugInPolicy ElementType="7003" ElementStyle="0">
      <Plugs />
      <Id>oid-plugin</Id>
    </ConvertPlugInPolicy>
    <LinkEntityPolicy ElementType="7008" ElementStyle="0">
      <LinkEntitys>
        <LinkEntity><Id>le-1</Id></LinkEntity>
      </LinkEntitys>
      <Id>oid-link</Id>
    </LinkEntityPolicy>
    <BillTypeMapPolicy ElementType="7009" ElementStyle="0">
      <BillTypeMaps />
      <Id>oid-billtype</Id>
    </BillTypeMapPolicy>
  </Policies>
  <Id>parent-rule-id</Id>
</ConvertRule></Rule></ConvertRuleMetaData>
`;

describe('parsePolicyOidMap', () => {
  it('extracts ElementType → last-Id mapping for each top-level Policy', () => {
    const map = parsePolicyOidMap(ORIGIN_XML);
    expect(map.get('7002')).toBe('oid-default');
    expect(map.get('7003')).toBe('oid-plugin');
    expect(map.get('7008')).toBe('oid-link');
    expect(map.get('7009')).toBe('oid-billtype');
  });
});

describe('transformPatchedToExtensionWire', () => {
  function makePatchedXml(opts: {
    statusOpen?: string;
    defaultPolicyContent?: string;
    pluginPolicyContent?: string;
    linkPolicyContent?: string;
    billtypePolicyContent?: string;
  }): string {
    return `<ConvertRule ElementType="6000" ElementStyle="0">
  ${opts.statusOpen ?? '<Status>True</Status>'}
  <Policies>
    <DefaultConvertPolicy ElementType="7002" ElementStyle="0">
      ${opts.defaultPolicyContent ?? '<FieldMaps />'}
      <Id>x-default</Id>
    </DefaultConvertPolicy>
    <ConvertPlugInPolicy ElementType="7003" ElementStyle="0">
      ${opts.pluginPolicyContent ?? '<Plugs />'}
      <Id>x-plugin</Id>
    </ConvertPlugInPolicy>
    <LinkEntityPolicy ElementType="7008" ElementStyle="0">
      ${opts.linkPolicyContent ?? '<LinkEntitys />'}
      <Id>x-link</Id>
    </LinkEntityPolicy>
    <BillTypeMapPolicy ElementType="7009" ElementStyle="0">
      ${opts.billtypePolicyContent ?? '<BillTypeMaps />'}
      <Id>x-billtype</Id>
    </BillTypeMapPolicy>
  </Policies>
  <Id>ext-id</Id>
</ConvertRule>`;
  }

  it('strips empty Policy nodes, preserves the one with content + injects action+oid', () => {
    const patched = makePatchedXml({
      defaultPolicyContent: '<FieldMaps><FieldMap ElementType="60002"><TargetFieldKey>F_NEW</TargetFieldKey><Id>new-fm</Id></FieldMap></FieldMaps>',
    });
    const out = transformPatchedToExtensionWire({ patchedXml: patched, originXml: ORIGIN_XML });
    // DefaultConvertPolicy survives with action+oid
    expect(out).toContain('<DefaultConvertPolicy action="edit" oid="oid-default"');
    expect(out).toContain('F_NEW');
    // The other 3 Policies (empty skeletons) are stripped
    expect(out).not.toContain('<ConvertPlugInPolicy');
    expect(out).not.toContain('<LinkEntityPolicy');
    expect(out).not.toContain('<BillTypeMapPolicy');
  });

  it('keeps multiple Policies when each has content', () => {
    const patched = makePatchedXml({
      defaultPolicyContent: '<FieldMaps><FieldMap><TargetFieldKey>F_X</TargetFieldKey><Id>fm-x</Id></FieldMap></FieldMaps>',
      pluginPolicyContent: '<Plugs><PlugIn><ClassName>my_plugin</ClassName><Id>plug-1</Id></PlugIn></Plugs>',
    });
    const out = transformPatchedToExtensionWire({ patchedXml: patched, originXml: ORIGIN_XML });
    expect(out).toContain('<DefaultConvertPolicy action="edit" oid="oid-default"');
    expect(out).toContain('<ConvertPlugInPolicy action="edit" oid="oid-plugin"');
    expect(out).toContain('F_X');
    expect(out).toContain('my_plugin');
    expect(out).not.toContain('<LinkEntityPolicy');
    expect(out).not.toContain('<BillTypeMapPolicy');
  });

  it('rewrites <Status> to action="reset"', () => {
    const patched = makePatchedXml({
      statusOpen: '<Status>True</Status>',
      defaultPolicyContent: '<FieldMaps><FieldMap><Id>x</Id></FieldMap></FieldMaps>',
    });
    const out = transformPatchedToExtensionWire({ patchedXml: patched, originXml: ORIGIN_XML });
    expect(out).toContain('<Status action="reset" />');
    expect(out).not.toMatch(/<Status>True<\/Status>/);
  });

  it('handles self-closing <Status /> too', () => {
    const patched = makePatchedXml({
      statusOpen: '<Status />',
      defaultPolicyContent: '<FieldMaps><FieldMap><Id>x</Id></FieldMap></FieldMaps>',
    });
    const out = transformPatchedToExtensionWire({ patchedXml: patched, originXml: ORIGIN_XML });
    expect(out).toContain('<Status action="reset" />');
  });

  it('is idempotent — running twice yields the same result', () => {
    const patched = makePatchedXml({
      defaultPolicyContent: '<FieldMaps><FieldMap><Id>x</Id></FieldMap></FieldMaps>',
    });
    const once = transformPatchedToExtensionWire({ patchedXml: patched, originXml: ORIGIN_XML });
    const twice = transformPatchedToExtensionWire({ patchedXml: once, originXml: ORIGIN_XML });
    // Re-running on already-transformed wire should not double-add action attrs
    const actionCount = (twice.match(/action="edit"/g) ?? []).length;
    expect(actionCount).toBe(1);
    expect(twice).toBe(once);
  });

  it('passes through Policy with no parent-oid match (treats as new addition)', () => {
    // Patched contains a Policy whose ElementType isn't in originXml at all.
    const patched = `<ConvertRule>
  <Status>True</Status>
  <Policies>
    <DefaultConvertPolicy ElementType="9999" ElementStyle="0">
      <FieldMaps><FieldMap><Id>x</Id></FieldMap></FieldMaps>
      <Id>x-default</Id>
    </DefaultConvertPolicy>
  </Policies>
</ConvertRule>`;
    const out = transformPatchedToExtensionWire({ patchedXml: patched, originXml: ORIGIN_XML });
    // Policy passes through unchanged (no action/oid injected)
    expect(out).toContain('<DefaultConvertPolicy ElementType="9999"');
    expect(out).not.toContain('action="edit"');
  });

  it('does not touch unknown Policy types (forward-compatible)', () => {
    const patched = `<ConvertRule>
  <Status>True</Status>
  <Policies>
    <FuturePolicy ElementType="99999" ElementStyle="0">
      <Stuff /><Id>x-future</Id>
    </FuturePolicy>
    <DefaultConvertPolicy ElementType="7002" ElementStyle="0">
      <FieldMaps><FieldMap><Id>x</Id></FieldMap></FieldMaps>
      <Id>x-default</Id>
    </DefaultConvertPolicy>
  </Policies>
</ConvertRule>`;
    const out = transformPatchedToExtensionWire({ patchedXml: patched, originXml: ORIGIN_XML });
    // FuturePolicy stays untouched
    expect(out).toContain('<FuturePolicy ElementType="99999"');
    // DefaultConvertPolicy still gets the action+oid treatment
    expect(out).toContain('<DefaultConvertPolicy action="edit" oid="oid-default"');
  });
});
