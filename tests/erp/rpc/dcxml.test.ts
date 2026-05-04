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

  // ─── Plan 5.14 — entry / tab / entry-field rendering ────────────────────
  // Wire format reference: memory `bos_entry_creation_wire_format.md`.

  it('emits EntryEntity into <Elements> with full child shape', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntries: [
        {
          key: 'F_PAIJ_Entity_abc',
          name: '测试体',
          entryName: 'PAIJ_Cust_Entry100050',
          tableName: 'PAIJ_t_Cust_Entry100050',
          seq: 13,
          id: '06de3ec92a7b428abe0a8cf4e8f47c4b',
          groupColumnInfoId: '052ad82f-0940-45d8-bd80-827eb9e7bc03',
        },
      ],
    });
    expect(xml).toContain('<EntryEntity ElementType="35" ElementStyle="0">');
    expect(xml).toContain('<EntryName>PAIJ_Cust_Entry100050</EntryName>');
    expect(xml).toContain('<EntryPkFieldName>FEntryID</EntryPkFieldName>');
    expect(xml).toContain('<Seq>13</Seq>');
    expect(xml).toContain('<TableName>PAIJ_t_Cust_Entry100050</TableName>');
    expect(xml).toContain(
      '<GroupColumnInfo><GroupColumnInfo><Id>052ad82f-0940-45d8-bd80-827eb9e7bc03</Id></GroupColumnInfo></GroupColumnInfo>',
    );
    expect(xml).toContain('<Name>测试体</Name>');
    expect(xml).toContain('<Id>06de3ec92a7b428abe0a8cf4e8f47c4b</Id>');
    expect(xml).toContain('<Key>F_PAIJ_Entity_abc</Key>');
    expect(xml).toContain('</EntryEntity>');
  });

  it('emits EntryEntityAppearance with PageRows=100 / Dock=5 defaults', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntryAppearances: [
        {
          key: 'F_PAIJ_Entity_abc',
          caption: '测试体',
          container: 'FTab1_PAIJ_P_xyz',
          width: 300,
          height: 65,
          id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    });
    expect(xml).toContain('<EntryEntityAppearance ElementType="35" ElementStyle="1">');
    expect(xml).toContain('<Caption>测试体</Caption>');
    expect(xml).toContain('<PageRows>100</PageRows>');
    expect(xml).toContain('<Dock>5</Dock>');
    expect(xml).toContain('<Container>FTab1_PAIJ_P_xyz</Container>');
    expect(xml).toContain('<Height>65</Height>');
    expect(xml).toContain('<Width>300</Width>');
    expect(xml).toContain('<Key>F_PAIJ_Entity_abc</Key>');
  });

  it('emits default 新增行 / 删除行 toolbar on new entries by default', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntryAppearances: [
        { key: 'F_PAIJ_Entity_abc', caption: '测试体', container: 'FTab1_PAIJ_P_xyz' },
      ],
    });
    // BOS Designer schema: <Menu><BarDataManager><BarItems>...</BarItems>
    // <BarItemLinks>...</BarItemLinks></BarDataManager></Menu>
    expect(xml).toContain('<Menu><BarDataManager>');
    expect(xml).toContain('<BarItems>');
    expect(xml).toContain('<ToolBar ElementType="2001" ElementStyle="1">');
    expect(xml).toContain('<Key>F_PAIJ_Entity_abc_TB</Key>');
    expect(xml).toContain('<Key>F_PAIJ_Entity_abc_NEW</Key>');
    expect(xml).toContain('<Key>F_PAIJ_Entity_abc_DEL</Key>');
    expect(xml).toContain('<Caption>新增行</Caption>');
    expect(xml).toContain('<Caption>删除行</Caption>');
    expect(xml).toContain('<Parameters>["Insert_F_PAIJ_Entity_abc"]</Parameters>');
    expect(xml).toContain('<Parameters>["Delete_F_PAIJ_Entity_abc"]</Parameters>');
    // BarItemLinks must attach each button to the ToolBar via ParentKey.
    expect(xml).toContain('<BarItemLinks>');
    expect(xml).toContain('<BarItemKey>F_PAIJ_Entity_abc_NEW</BarItemKey><ParentKey>F_PAIJ_Entity_abc_TB</ParentKey>');
    expect(xml).toContain('<BarItemKey>F_PAIJ_Entity_abc_DEL</BarItemKey><ParentKey>F_PAIJ_Entity_abc_TB</ParentKey>');
    expect(xml).toContain('</BarDataManager></Menu>');
  });

  it('omits Menu/BarDataManager when includeDefaultBarItems=false', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntryAppearances: [
        {
          key: 'F_PAIJ_Entity_abc',
          caption: '测试体',
          container: 'FTab1_PAIJ_P_xyz',
          includeDefaultBarItems: false,
        },
      ],
    });
    expect(xml).not.toContain('<Menu>');
    expect(xml).not.toContain('<BarDataManager>');
    expect(xml).not.toContain('<BarItems>');
  });

  it('emits FormOperations registering Insert/Delete services for entry buttons', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addFormOperations: [
        { service: 'Insert_F_X_Entity_abc', operationId: 19, operationName: '新增记录', entryKey: 'F_X_Entity_abc' },
        { service: 'Delete_F_X_Entity_abc', operationId: 4, operationName: '删除记录', entryKey: 'F_X_Entity_abc' },
      ],
    });
    expect(xml).toContain('<FormOperations>');
    expect(xml).toContain('<FormOperation>');
    expect(xml).toContain('<Id>Insert_F_X_Entity_abc</Id>');
    expect(xml).toContain('<Operation>Insert_F_X_Entity_abc</Operation>');
    expect(xml).toContain('<OperationId>19</OperationId>');
    expect(xml).toContain('<OperationName>新增记录</OperationName>');
    expect(xml).toContain('<OperationObjectKey>F_X_Entity_abc</OperationObjectKey>');
    expect(xml).toContain('<OperEleIds>35</OperEleIds>');
    expect(xml).toContain('<LoadKeys>[]</LoadKeys>');
    expect(xml).toContain('<AfterOpFailedInfo action="setnull"/>');
    // Both Insert + Delete services present
    expect(xml).toContain('<Id>Delete_F_X_Entity_abc</Id>');
    expect(xml).toContain('<OperationId>4</OperationId>');
  });

  it('emits TabControlAppearance for self-built TabControls', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addTabControls: [
        {
          key: 'F_PAIJ_Tab_8mg',
          caption: '页签控件',
          container: 'FSPLITECONTAINER~Panel2',
          id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
    });
    expect(xml).toContain('<TabControlAppearance ElementType="1005" ElementStyle="1">');
    expect(xml).toContain('<Container>FSPLITECONTAINER~Panel2</Container>');
    expect(xml).toContain('<Caption>页签控件</Caption>');
    expect(xml).toContain('<Key>F_PAIJ_Tab_8mg</Key>');
  });

  it('emits TabPageAppearance with parent TabControl as Container', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addTabPages: [
        {
          key: 'FTab1_PAIJ_P_xyz',
          caption: '质检明细',
          container: 'FTab1',
          id: 'cccccccccccccccccccccccccccccccc',
        },
      ],
    });
    expect(xml).toContain('<TabPageAppearance ElementType="1004" ElementStyle="1">');
    expect(xml).toContain('<Container>FTab1</Container>');
    expect(xml).toContain('<Caption>质检明细</Caption>');
    expect(xml).toContain('<Key>FTab1_PAIJ_P_xyz</Key>');
  });

  it('renders entry-field element with <EntityKey> after PropertyName', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'TextField',
          key: 'F_PAIJ_EntryNote',
          caption: '备注',
          listTabIndex: 9005,
          id: 'dddddddddddddddddddddddddddddddd',
          entityKey: 'F_PAIJ_Entity_abc',
        },
      ],
    });
    // EntityKey must appear AFTER PropertyName, BEFORE FieldName.
    const order = xml.indexOf('<PropertyName>F_PAIJ_EntryNote</PropertyName>');
    const ekIdx = xml.indexOf('<EntityKey>F_PAIJ_Entity_abc</EntityKey>');
    const fnIdx = xml.indexOf('<FieldName>F_PAIJ_ENTRYNOTE</FieldName>');
    expect(order).toBeGreaterThan(0);
    expect(ekIdx).toBeGreaterThan(order);
    expect(fnIdx).toBeGreaterThan(ekIdx);
  });

  it('renders entry-field appearance without Container/Top/Left/ZOrderIndex', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addAppearances: [
        {
          type: 'TextField',
          key: 'F_PAIJ_EntryNote',
          caption: '备注',
          tabindex: 1,
          entityKey: 'F_PAIJ_Entity_abc',
          id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        } as never, // existing interface still requires container/top/left; the
                    // entry-field appearance shape allows them undefined
      ],
    });
    expect(xml).toContain('<TextFieldAppearance ElementType="1" ElementStyle="1">');
    expect(xml).toContain('<EntityKey>F_PAIJ_Entity_abc</EntityKey>');
    expect(xml).toContain('<Tabindex>1</Tabindex>');
    expect(xml).toContain('<Width>150</Width>'); // default width for entry-field
    // Must NOT emit Container / Top / Left / ZOrderIndex for entry-fields
    expect(xml).not.toContain('<Container>');
    expect(xml).not.toContain('<Top>');
    expect(xml).not.toContain('<Left>');
    expect(xml).not.toContain('<ZOrderIndex>');
  });

  it('emits existingEntriesRaw / existingEntryAppearancesRaw / existingTabPagesRaw / existingTabControlsRaw verbatim', () => {
    const existingEntry = '<EntryEntity ElementType="35"><Key>F_OLD_E</Key><Name>old</Name><TableName>T_O</TableName></EntryEntity>';
    const existingEntryApp = '<EntryEntityAppearance ElementType="35"><Caption>old</Caption><Container>FTab1_OLD</Container><Key>F_OLD_E</Key></EntryEntityAppearance>';
    const existingTabPage = '<TabPageAppearance ElementType="1004"><Container>FTab1</Container><Caption>old page</Caption><Key>FTab1_OLD</Key></TabPageAppearance>';
    const existingTabControl = '<TabControlAppearance ElementType="1005"><Container>FSPLITECONTAINER~Panel2</Container><Caption>old tc</Caption><Key>F_OLD_TC</Key></TabControlAppearance>';
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      existingEntriesRaw: [existingEntry],
      existingEntryAppearancesRaw: [existingEntryApp],
      existingTabPagesRaw: [existingTabPage],
      existingTabControlsRaw: [existingTabControl],
    });
    expect(xml).toContain(existingEntry);
    expect(xml).toContain(existingEntryApp);
    expect(xml).toContain(existingTabPage);
    expect(xml).toContain(existingTabControl);
  });

  // ─── Plan 5.12.7 — property grid additions ─────────────────────────────
  // Wire format verified against captures req-77 + req-103 (2026-05-04).
  // Position rules per memory `bos_property_grid_inventory.md` §wire 实证.

  it('emits Field.MustInput (int 1) right after FieldName when mustInput=true', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'TextField',
          key: 'F_PAIJ_TestText',
          caption: '测试文本',
          listTabIndex: 9000,
          id: 'cccccccccccccccccccccccccccccc01',
          mustInput: true,
        },
      ],
    });
    expect(xml).toContain('<MustInput>1</MustInput>');
    // Must come after FieldName, before ListTabIndex (capture req-103 shape).
    const fnIdx = xml.indexOf('<FieldName>F_PAIJ_TESTTEXT</FieldName>');
    const miIdx = xml.indexOf('<MustInput>1</MustInput>');
    const ltiIdx = xml.indexOf('<ListTabIndex>');
    expect(fnIdx).toBeGreaterThan(0);
    expect(miIdx).toBeGreaterThan(fnIdx);
    expect(ltiIdx).toBeGreaterThan(miIdx);
  });

  it('does not emit MustInput when mustInput is false / undefined (BOS default = 0)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'TextField',
          key: 'F_PAIJ_NoMust',
          caption: '不必录',
          listTabIndex: 9001,
          id: 'cccccccccccccccccccccccccccccc02',
        },
      ],
    });
    expect(xml).not.toContain('<MustInput>');
  });

  it('emits Field.MustInput on DecimalField after FieldName as well', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'DecimalField',
          key: 'F_PAIJ_Amt',
          caption: '金额',
          listTabIndex: 9002,
          fieldScale: 2,
          fieldPrecision: 23,
          id: 'cccccccccccccccccccccccccccccc03',
          mustInput: true,
        },
      ],
    });
    const fnIdx = xml.indexOf('<FieldName>F_PAIJ_AMT</FieldName>');
    const miIdx = xml.indexOf('<MustInput>1</MustInput>');
    expect(miIdx).toBeGreaterThan(fnIdx);
  });

  it('emits BaseDataField.OrgFieldKey after SrcDisplayFieldName, before PropertyName', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'BaseDataField',
          key: 'F_PAIJ_Cust',
          caption: '客户',
          listTabIndex: 9003,
          lookUpObjectId: '407d24cb-57f7-46bf-afb6-a9ab458fd845',
          orgFieldKey: 'FSaleOrgId',
          id: 'cccccccccccccccccccccccccccccc04',
        },
      ],
    });
    expect(xml).toContain('<OrgFieldKey>FSaleOrgId</OrgFieldKey>');
    const sdfIdx = xml.indexOf('<SrcDisplayFieldName>FNAME</SrcDisplayFieldName>');
    const ofkIdx = xml.indexOf('<OrgFieldKey>FSaleOrgId</OrgFieldKey>');
    const pnIdx = xml.indexOf('<PropertyName>F_PAIJ_Cust</PropertyName>');
    expect(sdfIdx).toBeGreaterThan(0);
    expect(ofkIdx).toBeGreaterThan(sdfIdx);
    expect(pnIdx).toBeGreaterThan(ofkIdx);
  });

  it('does not emit OrgFieldKey when orgFieldKey is undefined (single-org standard edition)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'BaseDataField',
          key: 'F_PAIJ_Cust',
          caption: '客户',
          listTabIndex: 9003,
          lookUpObjectId: '407d24cb-57f7-46bf-afb6-a9ab458fd845',
          id: 'cccccccccccccccccccccccccccccc05',
        },
      ],
    });
    expect(xml).not.toContain('<OrgFieldKey>');
  });

  it('emits Entity.MustInput right after GroupColumnInfo when set on EntryEntity', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntries: [
        {
          key: 'F_PAIJ_Entity_61b',
          name: '测试明细',
          entryName: 'PAIJ_Cust_Entry200001',
          tableName: 'PAIJ_t_Cust_Entry200001',
          seq: 14,
          id: '57192dd366054483a1e092472c03d6eb',
          groupColumnInfoId: 'e3920f2b-5a19-4794-b0b6-636728ccec26',
          mustInput: true,
        },
      ],
    });
    expect(xml).toContain('<MustInput>1</MustInput>');
    // Position: after </GroupColumnInfo></GroupColumnInfo> closer, before <Name>.
    const gciCloseIdx = xml.indexOf('</GroupColumnInfo></GroupColumnInfo>');
    const miIdx = xml.indexOf('<MustInput>1</MustInput>');
    const nameIdx = xml.indexOf('<Name>测试明细</Name>');
    expect(gciCloseIdx).toBeGreaterThan(0);
    expect(miIdx).toBeGreaterThan(gciCloseIdx);
    expect(nameIdx).toBeGreaterThan(miIdx);
  });

  it('omits Entity.MustInput when not set', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntries: [
        {
          key: 'F_PAIJ_Entity_xx',
          name: '默认明细',
          entryName: 'PAIJ_Cust_Entry200002',
          tableName: 'PAIJ_t_Cust_Entry200002',
          seq: 15,
        },
      ],
    });
    expect(xml).not.toContain('<MustInput>');
  });

  it('emits IsShowSeq=True after Caption when isShowSeq=true on EntryEntityAppearance', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntryAppearances: [
        {
          key: 'F_PAIJ_Entity_61b',
          caption: '测试明细',
          container: 'FTab1_PAIJ_P_rtb',
          isShowSeq: true,
        },
      ],
    });
    expect(xml).toContain('<IsShowSeq>True</IsShowSeq>');
    const captionIdx = xml.indexOf('<Caption>测试明细</Caption>');
    const issIdx = xml.indexOf('<IsShowSeq>True</IsShowSeq>');
    const pageRowsIdx = xml.indexOf('<PageRows>');
    expect(captionIdx).toBeGreaterThan(0);
    expect(issIdx).toBeGreaterThan(captionIdx);
    expect(pageRowsIdx).toBeGreaterThan(issIdx);
  });

  it('emits IsShowSeq=False (with capitalized False) when explicitly set to false', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntryAppearances: [
        {
          key: 'F_PAIJ_Entity_yy',
          caption: '无序号明细',
          container: 'FTab1_PAIJ_P_yy',
          isShowSeq: false,
        },
      ],
    });
    expect(xml).toContain('<IsShowSeq>False</IsShowSeq>');
  });

  it('omits IsShowSeq when isShowSeq is undefined (server falls back to default)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: false,
      layoutInfoOid: 'L1',
      addEntryAppearances: [
        {
          key: 'F_PAIJ_Entity_zz',
          caption: '默认明细',
          container: 'FTab1_PAIJ_P_zz',
        },
      ],
    });
    expect(xml).not.toContain('<IsShowSeq>');
  });

  it('emits DefValue literal for TextField (DefaultValue/Value wrapper)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'TextField',
          key: 'F_PAIJ_TestText',
          caption: '文本',
          listTabIndex: 9100,
          defValue: { kind: 'literal', value: 'TEST' },
          id: 'dddddddddddddddddddddddddddddd01',
        },
      ],
    });
    expect(xml).toContain('<DefValue><DefaultValue><Value>TEST</Value></DefaultValue></DefValue>');
    // DefValue position: between ConditionType and PropertyName per req-103 capture.
    const ctIdx = xml.indexOf('<ConditionType>0</ConditionType>');
    const dvIdx = xml.indexOf('<DefValue>');
    const pnIdx = xml.indexOf('<PropertyName>F_PAIJ_TestText</PropertyName>');
    expect(ctIdx).toBeGreaterThan(0);
    expect(dvIdx).toBeGreaterThan(ctIdx);
    expect(pnIdx).toBeGreaterThan(dvIdx);
  });

  it('emits DefValue literal for ComboField (Value=enum literal)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'ComboField',
          key: 'F_PAIJ_TestCombo',
          caption: '下拉',
          listTabIndex: 9101,
          enumTypeId: 'd6ab165a-be17-4f2c-b845-49a05b1cef9a',
          defValue: { kind: 'literal', value: 'A' },
          id: 'dddddddddddddddddddddddddddddd02',
        },
      ],
    });
    expect(xml).toContain('<DefValue><DefaultValue><Value>A</Value></DefaultValue></DefValue>');
  });

  it('emits DefValue literal for CheckBoxField (Value=True/False)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'CheckBoxField',
          key: 'F_PAIJ_TestCheck',
          caption: '复选',
          listTabIndex: 9102,
          defValue: { kind: 'literal', value: 'True' },
          id: 'dddddddddddddddddddddddddddddd03',
        },
      ],
    });
    expect(xml).toContain('<DefValue><DefaultValue><Value>True</Value></DefaultValue></DefValue>');
  });

  it('emits DefValue function GetNumeric for DecimalField', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'DecimalField',
          key: 'F_PAIJ_TestDecimal',
          caption: '小数',
          listTabIndex: 9103,
          fieldScale: 2,
          fieldPrecision: 10,
          defValue: { kind: 'function', functionId: 14, functionName: 'GetNumeric', value: '66.66' },
          id: 'dddddddddddddddddddddddddddddd04',
        },
      ],
    });
    expect(xml).toContain(
      '<DefValue><FunctionDefaultValue><FunctionId>14</FunctionId><FunctionName>GetNumeric</FunctionName><Value>66.66</Value></FunctionDefaultValue></DefValue>',
    );
    // Position: after FieldPrecision, before PropertyName.
    const fpIdx = xml.indexOf('<FieldPrecision>10</FieldPrecision>');
    const dvIdx = xml.indexOf('<DefValue>');
    const pnIdx = xml.indexOf('<PropertyName>F_PAIJ_TestDecimal</PropertyName>');
    expect(fpIdx).toBeGreaterThan(0);
    expect(dvIdx).toBeGreaterThan(fpIdx);
    expect(pnIdx).toBeGreaterThan(dvIdx);
  });

  it('emits DefValue function GetDate with Parameter for DateField "today"', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'DateField',
          key: 'F_PAIJ_TestDate',
          caption: '日期',
          listTabIndex: 9104,
          defValue: {
            kind: 'function',
            functionId: 1,
            functionName: 'GetDate',
            parameter: 'yyyy-MM-dd,@CurrentDate',
          },
          id: 'dddddddddddddddddddddddddddddd05',
        },
      ],
    });
    expect(xml).toContain(
      '<DefValue><FunctionDefaultValue><FunctionId>1</FunctionId><FunctionName>GetDate</FunctionName><Parameter>yyyy-MM-dd,@CurrentDate</Parameter></FunctionDefaultValue></DefValue>',
    );
  });

  it('emits DefValue function GetBaseData for BaseDataField with FNumber Value', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'BaseDataField',
          key: 'F_PAIJ_TestCust',
          caption: '客户',
          listTabIndex: 9105,
          lookUpObjectId: '407d24cb-57f7-46bf-afb6-a9ab458fd845',
          defValue: { kind: 'function', functionId: 15, functionName: 'GetBaseData', value: '01' },
          id: 'dddddddddddddddddddddddddddddd06',
        },
      ],
    });
    expect(xml).toContain(
      '<DefValue><FunctionDefaultValue><FunctionId>15</FunctionId><FunctionName>GetBaseData</FunctionName><Value>01</Value></FunctionDefaultValue></DefValue>',
    );
    // BaseDataField position: after OrgFieldKey (or SrcDisplayFieldName when no OrgFieldKey),
    // before PropertyName.
    const sdfIdx = xml.indexOf('<SrcDisplayFieldName>FNAME</SrcDisplayFieldName>');
    const dvIdx = xml.indexOf('<DefValue>');
    const pnIdx = xml.indexOf('<PropertyName>F_PAIJ_TestCust</PropertyName>');
    expect(sdfIdx).toBeGreaterThan(0);
    expect(dvIdx).toBeGreaterThan(sdfIdx);
    expect(pnIdx).toBeGreaterThan(dvIdx);
  });

  it('emits OrgFieldKey before DefValue when both are set on BaseDataField (capture order)', () => {
    const xml = buildDcxmlSource({
      extension: baselineExt,
      isNew: true,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'BaseDataField',
          key: 'F_PAIJ_OrgCust',
          caption: '组织客户',
          listTabIndex: 9106,
          lookUpObjectId: '407d24cb-57f7-46bf-afb6-a9ab458fd845',
          orgFieldKey: 'FSaleOrgId',
          defValue: { kind: 'function', functionId: 15, functionName: 'GetBaseData', value: '01' },
          id: 'dddddddddddddddddddddddddddddd07',
        },
      ],
    });
    const ofkIdx = xml.indexOf('<OrgFieldKey>FSaleOrgId</OrgFieldKey>');
    const dvIdx = xml.indexOf('<DefValue>');
    expect(ofkIdx).toBeGreaterThan(0);
    expect(dvIdx).toBeGreaterThan(ofkIdx);
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
