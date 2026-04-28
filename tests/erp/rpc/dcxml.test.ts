import { describe, expect, it } from 'vitest';
import { buildDcxmlSource } from '../../../src/main/erp/k3cloud/rpc/dcxml';
import type { SaveExtensionRequest } from '../../../src/main/erp/k3cloud/rpc/types';

const baselineExt: SaveExtensionRequest['extension'] = {
  formId: '00000000000000000000000000000001',
  baseObjectId: 'SAL_SaleOrder',
  modelTypeId: 100,
  subSystemId: '23',
  name: [{ localeId: 2052, value: '销售订单' }],
  isv: { devCode: 'PAIJ' },
};

describe('rpc/dcxml emitter', () => {
  it('emits Form root + outer scaffolding for an empty save', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'aaaa-bbbb',
    });
    expect(xml).toContain('<?xml version="1.0" encoding="utf-16"?>');
    expect(xml).toContain('<FormMetadata>');
    expect(xml).toContain('<Form action="edit" oid="BOS_BillModel" ElementType="100"');
    expect(xml).toContain('<Id>00000000000000000000000000000001</Id>');
    expect(xml).toContain('<LayoutInfo action="edit" oid="aaaa-bbbb">');
    expect(xml).toContain('</FormMetadata>');
  });

  it('emits TextField with baseline 7 children and uppercase FieldName', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'TextField',
          key: 'F_PAIJ_Memo_abc',
          caption: '备注',
          listTabIndex: 3135,
          id: '11111111111111111111111111111111',
        },
      ],
    });
    expect(xml).toContain('<TextField ElementType="1" ElementStyle="0">');
    expect(xml).toContain('<PropertyName>F_PAIJ_Memo_abc</PropertyName>');
    expect(xml).toContain('<FieldName>F_PAIJ_MEMO_ABC</FieldName>');
    expect(xml).toContain('<Key>F_PAIJ_Memo_abc</Key>');
    expect(xml).toContain('<Name>备注</Name>');
    expect(xml).toContain('<Id>11111111111111111111111111111111</Id>');
  });

  it('emits BasePropertyField WITHOUT FieldName/FieldType (the regression we kept hitting in SQL path)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'BasePropertyField',
          key: 'F_PAIJ_BProp_xx',
          caption: '客户属性',
          listTabIndex: 3144,
          controlFieldKey: 'FCustId',
          id: '22222222222222222222222222222222',
        },
      ],
    });
    expect(xml).toContain('<BasePropertyField ElementType="14"');
    expect(xml).toContain('<ControlFieldKey>FCustId</ControlFieldKey>');
    expect(xml).toContain('<SrcDisplayFieldName>FName</SrcDisplayFieldName>');
    expect(xml).toContain('<DefaultCondition>67</DefaultCondition>');
    // Critical: no FieldName / FieldType / SrcBaseDataDisplayType.
    expect(xml).not.toMatch(/<FieldName>[^<]/);
    expect(xml).not.toContain('<FieldType>');
    expect(xml).not.toContain('SrcBaseDataDisplayType');
  });

  it('renders BasePropertyFieldAppearance with required <Locked>-1</Locked>', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addAppearances: [
        {
          type: 'BasePropertyField',
          key: 'F_PAIJ_BProp_xx',
          caption: '客户属性',
          container: 'FTAB_P0',
          zOrderIndex: 38,
          tabindex: 229,
          left: 279,
          top: 169,
          id: '33333333333333333333333333333333',
        },
      ],
    });
    expect(xml).toContain('<BasePropertyFieldAppearance ElementType="14"');
    expect(xml).toContain('<Locked>-1</Locked>');
    expect(xml).toContain('<EmptyText action="setnull" />');
  });

  it('omits EmptyText for CheckBoxFieldAppearance', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addAppearances: [
        {
          type: 'CheckBoxField',
          key: 'F_PAIJ_Chk_yy',
          caption: '是否启用',
          container: 'FTAB_P0',
          zOrderIndex: 30,
          tabindex: 200,
          left: 10,
          top: 10,
        },
      ],
    });
    expect(xml).toContain('<CheckBoxFieldAppearance ElementType="8"');
    expect(xml).not.toContain('<EmptyText');
  });

  it('renders remove elements as self-closing with action="remove" and oid', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      removeFields: [
        { tagName: 'TextField', oid: 'FSaleOrderEntry_Link_FFlowId' },
        { tagName: 'SubEntryEntity', oid: '0746461a3cc24661ab1936aa83536451' },
      ],
    });
    expect(xml).toContain('<TextField action="remove" oid="FSaleOrderEntry_Link_FFlowId" />');
    expect(xml).toContain(
      '<SubEntryEntity action="remove" oid="0746461a3cc24661ab1936aa83536451" />',
    );
  });

  it('renders FormPlugins block inside Form for Python plugin (matches captured req-75 shape)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addPlugins: [
        {
          className: 'smoke_test_plugin',
          type: 'python',
          pyScript: '#smoke_test_plugin',
        },
      ],
    });
    // Plugin must be INSIDE <Form>...</Form> (between Id and the closing tag),
    // wrapped by <FormPlugins>.
    expect(xml).toMatch(
      /<Form action="edit"[^>]*>\s*<Id>[^<]+<\/Id>\s*<FormPlugins>\s*<PlugIn /,
    );
    expect(xml).toContain('<PlugIn ElementType="0" ElementStyle="0">');
    expect(xml).toContain('<ClassName>smoke_test_plugin</ClassName>');
    expect(xml).toContain('<PlugInType>1</PlugInType>');
    expect(xml).toContain('<PyScript><![CDATA[#smoke_test_plugin]]></PyScript>');
    expect(xml).toContain('</FormPlugins></Form>');
  });

  it('preserves CDATA-wrapped script content even with XML special chars', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addPlugins: [
        {
          className: 'guard',
          type: 'python',
          // Real Python may have < / > / & / quotes in conditionals etc.
          pyScript: 'if x < 5 and y > 0 & flag: print("ok")',
        },
      ],
    });
    expect(xml).toContain(
      '<PyScript><![CDATA[if x < 5 and y > 0 & flag: print("ok")]]></PyScript>',
    );
    expect(xml).not.toContain('&lt;');
    expect(xml).not.toContain('&amp;');
    expect(xml).not.toContain('&quot;');
  });

  it('renders multiple plugins in order under one FormPlugins wrapper', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addPlugins: [
        { className: 'first', type: 'python', pyScript: '#a' },
        { className: 'second', type: 'python', pyScript: '#b' },
      ],
    });
    const formPluginsBlocks = xml.match(/<FormPlugins>/g) ?? [];
    expect(formPluginsBlocks).toHaveLength(1);
    expect(xml).toContain('<ClassName>first</ClassName>');
    expect(xml).toContain('<ClassName>second</ClassName>');
    expect(xml.indexOf('<ClassName>first</ClassName>')).toBeLessThan(
      xml.indexOf('<ClassName>second</ClassName>'),
    );
  });

  it('does not emit FormPlugins block when addPlugins is empty/undefined', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
    });
    expect(xml).not.toContain('<FormPlugins>');
    expect(xml).not.toContain('<PlugIn ');
  });

  it('emits existingFieldsRaw chunks before new addFields inside <Elements>', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      existingFieldsRaw: [
        '<TextField ElementType="1" ElementStyle="0"><Key>F_OLD</Key><Name>旧</Name><Id>old1</Id></TextField>',
      ],
      addFields: [
        {
          type: 'IntegerField',
          key: 'F_NEW',
          caption: '新',
          listTabIndex: 9001,
          id: '55555555555555555555555555555555',
        },
      ],
    });
    expect(xml).toContain('<Key>F_OLD</Key>');
    expect(xml).toContain('<Key>F_NEW</Key>');
    // Existing must come BEFORE new so the read-back order is preserved.
    expect(xml.indexOf('<Key>F_OLD</Key>')).toBeLessThan(xml.indexOf('<Key>F_NEW</Key>'));
  });

  it('emits existingAppearancesRaw before new addAppearances under <Appearances>', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      existingAppearancesRaw: [
        '<TextFieldAppearance ElementType="1" ElementStyle="1"><Key>F_OLD</Key><Container>FTAB_P0</Container></TextFieldAppearance>',
      ],
      addAppearances: [
        {
          type: 'IntegerField',
          key: 'F_NEW',
          caption: '新',
          container: 'FTAB_P0',
          zOrderIndex: 99,
          tabindex: 9001,
          left: 10,
          top: 10,
          id: '66666666666666666666666666666666',
        },
      ],
    });
    expect(xml).toContain('<TextFieldAppearance');
    expect(xml).toContain('<IntegerFieldAppearance');
    expect(xml.indexOf('<TextFieldAppearance')).toBeLessThan(
      xml.indexOf('<IntegerFieldAppearance'),
    );
  });

  it('merges existingPluginsRaw with new addPlugins under one FormPlugins wrapper', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      existingPluginsRaw: [
        '<PlugIn ElementType="0" ElementStyle="0"><ClassName>old_plug</ClassName><PlugInType>1</PlugInType><PyScript><![CDATA[#old]]></PyScript></PlugIn>',
      ],
      addPlugins: [
        { className: 'new_plug', type: 'python', pyScript: '#new' },
      ],
    });
    // Exactly one FormPlugins wrapper; both plugins inside.
    expect((xml.match(/<FormPlugins>/g) ?? [])).toHaveLength(1);
    expect(xml).toContain('<ClassName>old_plug</ClassName>');
    expect(xml).toContain('<ClassName>new_plug</ClassName>');
    expect(xml.indexOf('<ClassName>old_plug</ClassName>')).toBeLessThan(
      xml.indexOf('<ClassName>new_plug</ClassName>'),
    );
  });

  it('emits FormPlugins block when only existing plugins are provided (no new ones)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      existingPluginsRaw: [
        '<PlugIn ElementType="0" ElementStyle="0"><ClassName>only_old</ClassName><PlugInType>1</PlugInType><PyScript><![CDATA[#x]]></PyScript></PlugIn>',
      ],
    });
    expect(xml).toContain('<FormPlugins>');
    expect(xml).toContain('<ClassName>only_old</ClassName>');
  });

  it('xml-escapes special chars in user-controlled values', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'TextField',
          key: 'F_T_xx',
          caption: '<script>&"\'',
          listTabIndex: 3135,
          id: '44444444444444444444444444444444',
        },
      ],
    });
    expect(xml).toContain('<Name>&lt;script&gt;&amp;&quot;&apos;</Name>');
    expect(xml).not.toContain('<script>');
  });
});
