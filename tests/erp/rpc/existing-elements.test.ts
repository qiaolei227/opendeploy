import { describe, expect, it } from 'vitest';
import { extractExistingExtensionElements } from '../../../src/main/erp/k3cloud/rpc/existing-elements';

describe('extractExistingExtensionElements', () => {
  it('returns empty arrays for empty / null input', () => {
    expect(extractExistingExtensionElements('')).toEqual({
      fields: [],
      appearances: [],
      plugins: [],
      entries: [],
      entryAppearances: [],
      tabPages: [],
      tabControls: [],
      formOperations: [],
      headEntity: '',
    });
  });

  it('returns empty arrays when there are no Elements/Appearances blocks', () => {
    const xml = '<FormMetadata><Other>x</Other></FormMetadata>';
    expect(extractExistingExtensionElements(xml)).toEqual({
      fields: [],
      appearances: [],
      plugins: [],
      entries: [],
      entryAppearances: [],
      tabPages: [],
      tabControls: [],
      formOperations: [],
      headEntity: '',
    });
  });

  it('extracts each field as a raw chunk including its open + close tags', () => {
    const xml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">
        <Id>ext1</Id>
      </Form>
      <TextField ElementType="1" ElementStyle="0">
        <PropertyName>F_PAIJ_A</PropertyName>
        <FieldName>F_PAIJ_A</FieldName>
        <Name>A</Name>
        <Id>aaa</Id>
        <Key>F_PAIJ_A</Key>
      </TextField>
      <BaseDataField ElementType="13" ElementStyle="0">
        <LookUpObjectID>BD_Customer</LookUpObjectID>
        <PropertyName>F_PAIJ_B</PropertyName>
        <Name>B</Name>
        <Id>bbb</Id>
        <Key>F_PAIJ_B</Key>
      </BaseDataField>
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]).toContain('<TextField');
    expect(result.fields[0]).toContain('</TextField>');
    expect(result.fields[0]).toContain('<Key>F_PAIJ_A</Key>');
    expect(result.fields[1]).toContain('<BaseDataField');
    expect(result.fields[1]).toContain('<Key>F_PAIJ_B</Key>');
    expect(result.fields[1]).toContain('</BaseDataField>');
  });

  it('skips self-closing remove-action field markers', () => {
    const xml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <TextField ElementType="1"><Key>F_X</Key><Name>X</Name></TextField>
      <TextField action="remove" oid="ghost" />
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toContain('<Key>F_X</Key>');
  });

  it('does not capture Form itself as a field even though tag matches', () => {
    const xml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form action="edit" oid="BOS_BillModel" ElementType="100"><Id>ext1</Id></Form>
      <TextField><Key>F_X</Key><Name>X</Name></TextField>
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).not.toContain('<Form ');
  });

  it('extracts appearance chunks from <LayoutInfo><Appearances>', () => {
    const xml = `<FormMetadata>
      <LayoutInfos><LayoutInfo action="edit" oid="L1">
        <Appearances>
          <TextFieldAppearance ElementType="1" ElementStyle="1">
            <Key>F_PAIJ_A</Key>
            <Container>FTAB_P0</Container>
          </TextFieldAppearance>
          <BaseDataFieldAppearance ElementType="13" ElementStyle="1">
            <Key>F_PAIJ_B</Key>
            <Container>FTAB_P0</Container>
          </BaseDataFieldAppearance>
        </Appearances>
      </LayoutInfo></LayoutInfos>
    </FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.appearances).toHaveLength(2);
    expect(result.appearances[0]).toContain('<TextFieldAppearance');
    expect(result.appearances[0]).toContain('<Key>F_PAIJ_A</Key>');
    expect(result.appearances[1]).toContain('<BaseDataFieldAppearance');
    expect(result.appearances[1]).toContain('<Key>F_PAIJ_B</Key>');
  });

  it('extracts plugins from <Form><FormPlugins> and preserves CDATA', () => {
    const xml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form action="edit" oid="BOS_BillModel" ElementType="100">
        <Id>ext1</Id>
        <FormPlugins>
          <PlugIn ElementType="0" ElementStyle="0">
            <ClassName>credit_warn</ClassName>
            <PlugInType>1</PlugInType>
            <PyScript><![CDATA[if x < 5 and y > 0: print("ok")]]></PyScript>
          </PlugIn>
          <PlugIn ElementType="0" ElementStyle="0">
            <ClassName>second</ClassName>
            <PlugInType>1</PlugInType>
            <PyScript><![CDATA[#second]]></PyScript>
          </PlugIn>
        </FormPlugins>
      </Form>
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.plugins).toHaveLength(2);
    expect(result.plugins[0]).toContain('<ClassName>credit_warn</ClassName>');
    // CDATA must be preserved verbatim (with both `<` inside).
    expect(result.plugins[0]).toContain('<![CDATA[if x < 5 and y > 0: print("ok")]]>');
    expect(result.plugins[1]).toContain('<ClassName>second</ClassName>');
    expect(result.plugins[1]).toContain('<![CDATA[#second]]>');
  });

  it('CDATA-safe even when script body contains tag-like sequences', () => {
    // PyScript with `<i:` would corrupt a naive tokenizer (it'd treat <i: as
    // an open tag). This test catches that regression.
    const xml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>ext1</Id>
        <FormPlugins>
          <PlugIn>
            <ClassName>tricky</ClassName>
            <PyScript><![CDATA[for i in range(10): if x<i: pass]]></PyScript>
          </PlugIn>
        </FormPlugins>
      </Form>
      <TextField><Key>F_X</Key><Name>X</Name></TextField>
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toContain('<![CDATA[for i in range(10): if x<i: pass]]>');
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toContain('<Key>F_X</Key>');
  });

  // ─── Plan 5.14 — entry / tab-page / tab-control extraction ──────────
  // These four collections are what `k3cloud_create_entry`,
  // `k3cloud_create_tab_*`, and the delete/rename tools read & re-emit so the
  // baseline-diff DCXML keeps cumulative state. Wire format reference:
  // memory `bos_entry_creation_wire_format.md`.

  it('extracts EntryEntity raw chunks from <Elements>', () => {
    const xml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form><Id>ext1</Id></Form>
      <EntryEntity ElementType="35" ElementStyle="0">
        <EntryName>UNW_Cust_Entry100002</EntryName>
        <EntryPkFieldName>FEntryID</EntryPkFieldName>
        <Seq>14</Seq>
        <TableName>UNW_t_Cust_Entry100002</TableName>
        <Name>测试体</Name>
        <Id>0144d058</Id>
        <Key>F_UNW_Entity_rnk</Key>
      </EntryEntity>
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toContain('<EntryEntity ');
    expect(result.entries[0]).toContain('<Key>F_UNW_Entity_rnk</Key>');
    expect(result.entries[0]).toContain('</EntryEntity>');
  });

  it('does NOT capture SubEntryEntity as an entry (v0.1 single-level only)', () => {
    const xml = `<FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <EntryEntity><Key>F_E1</Key></EntryEntity>
      <SubEntryEntity><Key>F_SUB</Key></SubEntryEntity>
    </Elements></BusinessInfo></BusinessInfo></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toContain('<Key>F_E1</Key>');
    expect(result.entries[0]).not.toContain('<SubEntryEntity');
  });

  it('extracts TabPage / TabControl / EntryEntity appearances from <Appearances>', () => {
    const xml = `<FormMetadata>
      <LayoutInfos><LayoutInfo>
        <Appearances>
          <TextFieldAppearance><Key>F_A</Key></TextFieldAppearance>
          <TabControlAppearance ElementType="1005" ElementStyle="1">
            <Container>FSPLITECONTAINER~Panel2</Container>
            <Caption>页签控件</Caption>
            <Key>F_UNW_Tab_8mg</Key>
          </TabControlAppearance>
          <TabPageAppearance ElementType="1004" ElementStyle="1">
            <Container>F_UNW_Tab_8mg</Container>
            <Caption>页签</Caption>
            <Key>F_UNW_Tab_8mg_P0_8mg</Key>
          </TabPageAppearance>
          <TabPageAppearance ElementType="1004" ElementStyle="1">
            <Container>FTab1</Container>
            <Caption>页签</Caption>
            <Key>FTab1_UNW_P_o9w</Key>
          </TabPageAppearance>
          <EntryEntityAppearance ElementType="35" ElementStyle="1">
            <Caption>测试体</Caption>
            <Container>FTab1_UNW_P_o9w</Container>
            <Key>F_UNW_Entity_rnk</Key>
          </EntryEntityAppearance>
        </Appearances>
      </LayoutInfo></LayoutInfos>
    </FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.appearances).toHaveLength(1); // TextFieldAppearance only
    expect(result.tabControls).toHaveLength(1);
    expect(result.tabControls[0]).toContain('<Key>F_UNW_Tab_8mg</Key>');
    expect(result.tabPages).toHaveLength(2);
    expect(result.tabPages[0]).toContain('<Key>F_UNW_Tab_8mg_P0_8mg</Key>');
    expect(result.tabPages[1]).toContain('<Key>FTab1_UNW_P_o9w</Key>');
    expect(result.entryAppearances).toHaveLength(1);
    expect(result.entryAppearances[0]).toContain('<Key>F_UNW_Entity_rnk</Key>');
  });

  it('extracts fields, appearances, and plugins together from a realistic save echo', () => {
    // Mirror what an extension's stored FKERNELXML looks like after BOS
    // applies a save: Form + multiple fields + matching appearances.
    const xml = `<?xml version="1.0" encoding="utf-16"?><FormMetadata><BusinessInfo><BusinessInfo><Elements>
      <Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">
        <Id>ext1</Id>
        <FormPlugins>
          <PlugIn ElementType="0" ElementStyle="0">
            <ClassName>p1</ClassName>
            <PlugInType>1</PlugInType>
            <PyScript><![CDATA[#p1]]></PyScript>
          </PlugIn>
        </FormPlugins>
      </Form>
      <TextField ElementType="1" ElementStyle="0"><Key>F_A</Key><Name>A</Name><Id>id-a</Id></TextField>
      <DecimalField ElementType="2" ElementStyle="0"><FieldScale>2</FieldScale><Key>F_B</Key><Name>B</Name><Id>id-b</Id></DecimalField>
    </Elements></BusinessInfo></BusinessInfo>
    <LayoutInfos><LayoutInfo action="edit" oid="L1">
      <Appearances>
        <TextFieldAppearance ElementType="1" ElementStyle="1"><Key>F_A</Key><Container>FTAB_P0</Container></TextFieldAppearance>
        <DecimalFieldAppearance ElementType="2" ElementStyle="1"><Key>F_B</Key><Container>FTAB_P0</Container></DecimalFieldAppearance>
      </Appearances>
    </LayoutInfo></LayoutInfos></FormMetadata>`;

    const result = extractExistingExtensionElements(xml);
    expect(result.fields).toHaveLength(2);
    expect(result.appearances).toHaveLength(2);
    expect(result.plugins).toHaveLength(1);
  });
});
