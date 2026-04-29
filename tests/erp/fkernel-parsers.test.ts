import { describe, expect, it } from 'vitest';
import {
  parseAppearanceGeometry,
  parseFormLayoutContainers,
} from '../../src/main/erp/k3cloud/fkernel-parsers';

describe('parseAppearanceGeometry', () => {
  it('returns [] for empty / no-Appearances input', () => {
    expect(parseAppearanceGeometry('')).toEqual([]);
    expect(parseAppearanceGeometry('<FormMetadata><Other>x</Other></FormMetadata>')).toEqual([]);
  });

  it('extracts tag/Container/Left/Top/Width from each appearance node', () => {
    const xml = `<LayoutInfo><Appearances>
      <TextFieldAppearance ElementType="1">
        <Container>FTAB_P0</Container>
        <Left>1</Left>
        <Top>0</Top>
        <Width>280</Width>
      </TextFieldAppearance>
      <BaseDataFieldAppearance ElementType="13">
        <Container>FTAB_P0</Container>
        <Left>601</Left>
        <Top>81</Top>
        <Width>270</Width>
      </BaseDataFieldAppearance>
    </Appearances></LayoutInfo>`;
    expect(parseAppearanceGeometry(xml)).toEqual([
      { tag: 'TextFieldAppearance', container: 'FTAB_P0', left: 1, top: 0, width: 280 },
      { tag: 'BaseDataFieldAppearance', container: 'FTAB_P0', left: 601, top: 81, width: 270 },
    ]);
  });

  it('treats missing Top as 0 (matches BillNoFieldAppearance shape)', () => {
    const xml = `<Appearances>
      <BillNoFieldAppearance>
        <Container>FTAB_P0</Container>
        <Left>1</Left>
        <Width>280</Width>
      </BillNoFieldAppearance>
    </Appearances>`;
    expect(parseAppearanceGeometry(xml)).toEqual([
      { tag: 'BillNoFieldAppearance', container: 'FTAB_P0', left: 1, top: 0, width: 280 },
    ]);
  });

  it('skips appearance nodes without a Container child', () => {
    const xml = `<Appearances>
      <FormAppearance>
        <Caption>销售订单</Caption>
        <Width>1569</Width>
      </FormAppearance>
      <TextFieldAppearance>
        <Container>FTAB_P1</Container>
        <Left>10</Left>
        <Top>10</Top>
        <Width>200</Width>
      </TextFieldAppearance>
    </Appearances>`;
    expect(parseAppearanceGeometry(xml)).toEqual([
      { tag: 'TextFieldAppearance', container: 'FTAB_P1', left: 10, top: 10, width: 200 },
    ]);
  });

  it('returns sub-head / region / tab nodes too — caller filters by tag', () => {
    const xml = `<Appearances>
      <SubHeadEntityAppearance>
        <Container>FTAB_P0</Container>
        <Left>0</Left>
        <Top>0</Top>
        <Width>1500</Width>
      </SubHeadEntityAppearance>
      <TextFieldAppearance>
        <Container>FTAB_P0</Container>
        <Left>0</Left>
        <Top>0</Top>
        <Width>280</Width>
      </TextFieldAppearance>
    </Appearances>`;
    const got = parseAppearanceGeometry(xml);
    expect(got.map((g) => g.tag)).toEqual([
      'SubHeadEntityAppearance',
      'TextFieldAppearance',
    ]);
  });

  it('uses the LAST <Appearances> block (active layout when multiple LayoutInfos)', () => {
    const xml = `<root>
      <Appearances>
        <X><Container>OLD</Container><Left>1</Left><Top>1</Top><Width>1</Width></X>
      </Appearances>
      <Appearances>
        <Y><Container>NEW</Container><Left>2</Left><Top>2</Top><Width>2</Width></Y>
      </Appearances>
    </root>`;
    expect(parseAppearanceGeometry(xml)).toEqual([
      { tag: 'Y', container: 'NEW', left: 2, top: 2, width: 2 },
    ]);
  });
});

describe('parseFormLayoutContainers', () => {
  it('returns empty layout for empty input', () => {
    expect(parseFormLayoutContainers('')).toEqual({
      tabs: [],
      entries: [],
      tabControls: [],
    });
  });

  it('extracts head + entry tabs with key, caption, parentControl', () => {
    const xml = `<Appearances>
      <TabPageAppearance>
        <Container>FTab</Container>
        <Caption>基本信息</Caption>
        <Key>FTab_P0</Key>
      </TabPageAppearance>
      <TabPageAppearance>
        <Container>FTab</Container>
        <Caption>客户信息</Caption>
        <Key>FTab_P1</Key>
      </TabPageAppearance>
      <TabPageAppearance>
        <Container>FTab1</Container>
        <Caption>明细信息</Caption>
        <Key>FTab1_P0</Key>
      </TabPageAppearance>
    </Appearances>`;
    expect(parseFormLayoutContainers(xml).tabs).toEqual([
      { key: 'FTab_P0', caption: '基本信息', parentControl: 'FTab', pageIndex: null, zOrderIndex: null },
      { key: 'FTab_P1', caption: '客户信息', parentControl: 'FTab', pageIndex: null, zOrderIndex: null },
      { key: 'FTab1_P0', caption: '明细信息', parentControl: 'FTab1', pageIndex: null, zOrderIndex: null },
    ]);
  });

  it('extracts PageIndex + ZOrderIndex independently (they can desync)', () => {
    // SAL_SaleOrder's 收款执行明细 has pageIndex=10 zOrderIndex=7 in real data,
    // a side effect of historical tab deletes.
    const xml = `<Appearances>
      <TabPageAppearance>
        <Container>FTab1</Container>
        <PageIndex>0</PageIndex>
        <ZOrderIndex>0</ZOrderIndex>
        <Caption>明细信息</Caption>
        <Key>FTab1_P0</Key>
      </TabPageAppearance>
      <TabPageAppearance>
        <Container>FTab1</Container>
        <PageIndex>10</PageIndex>
        <ZOrderIndex>7</ZOrderIndex>
        <Caption>收款执行明细</Caption>
        <Key>FTab1_P</Key>
      </TabPageAppearance>
    </Appearances>`;
    const tabs = parseFormLayoutContainers(xml).tabs;
    expect(tabs[0]).toMatchObject({ pageIndex: 0, zOrderIndex: 0 });
    expect(tabs[1]).toMatchObject({ pageIndex: 10, zOrderIndex: 7 });
  });

  it('extracts EntryEntity + SubEntryEntity with kind label', () => {
    const xml = `<Elements>
      <EntryEntity ElementType="35">
        <Name>明细信息</Name>
        <TableName>T_SAL_ORDERENTRY</TableName>
        <Key>FSaleOrderEntry</Key>
      </EntryEntity>
      <EntryEntity ElementType="35">
        <Name>订单条款</Name>
        <TableName>T_SAL_ORDERCLAUSE</TableName>
        <Key>FSaleOrderClause</Key>
      </EntryEntity>
      <SubEntryEntity ElementType="60502">
        <Name>交货明细</Name>
        <TableName>T_SAL_ORDERENTRYDELIPLAN</TableName>
        <Key>FDeliveryEntry</Key>
      </SubEntryEntity>
    </Elements>`;
    expect(parseFormLayoutContainers(xml).entries).toEqual([
      {
        key: 'FSaleOrderEntry',
        name: '明细信息',
        tableName: 'T_SAL_ORDERENTRY',
        kind: 'entry',
      },
      {
        key: 'FSaleOrderClause',
        name: '订单条款',
        tableName: 'T_SAL_ORDERCLAUSE',
        kind: 'entry',
      },
      {
        key: 'FDeliveryEntry',
        name: '交货明细',
        tableName: 'T_SAL_ORDERENTRYDELIPLAN',
        kind: 'sub-entry',
      },
    ]);
  });

  it('dedups duplicate Key occurrences (cumulative ancestor models)', () => {
    const xml = `<root>
      <EntryEntity><Name>x</Name><Key>FE</Key><TableName>T_E</TableName></EntryEntity>
      <EntryEntity><Name>x dup</Name><Key>FE</Key><TableName>T_E</TableName></EntryEntity>
    </root>`;
    expect(parseFormLayoutContainers(xml).entries).toHaveLength(1);
  });

  it('combines tabs and entries from a mixed XML in one pass', () => {
    const xml = `<Form>
      <Elements>
        <EntryEntity><Name>明细</Name><Key>FE1</Key><TableName>T1</TableName></EntryEntity>
      </Elements>
      <Appearances>
        <TabPageAppearance>
          <Container>FTab</Container>
          <Caption>基本信息</Caption>
          <Key>FTAB_P0</Key>
        </TabPageAppearance>
      </Appearances>
    </Form>`;
    const layout = parseFormLayoutContainers(xml);
    expect(layout.tabs).toHaveLength(1);
    expect(layout.entries).toHaveLength(1);
    expect(layout.tabs[0].key).toBe('FTAB_P0');
    expect(layout.entries[0].key).toBe('FE1');
  });

  // Plan 5.14 — entry creation needs id/entryName/seq/entryPkFieldName so
  // a follow-up `kingdee_create_entry` can compute next Seq + emit consistent
  // EntryEntity DCXML. Wire format reference: memory `bos_entry_creation_wire_format.md`
  // (capture #1334 EntryEntity full body).
  it('extracts EntryEntity detail fields (id, entryName, seq, entryPkFieldName)', () => {
    const xml = `<Elements>
      <EntryEntity ElementType="35" ElementStyle="0">
        <EntryName>UNW_Cust_Entry100002</EntryName>
        <EntryPkFieldName>FEntryID</EntryPkFieldName>
        <Seq>14</Seq>
        <TableName>UNW_t_Cust_Entry100002</TableName>
        <Name>测试体B</Name>
        <Id>0144d0583c0a4693b699607a9aa29710</Id>
        <Key>F_UNW_Entity_rnk</Key>
      </EntryEntity>
    </Elements>`;
    const layout = parseFormLayoutContainers(xml);
    expect(layout.entries[0]).toEqual({
      key: 'F_UNW_Entity_rnk',
      name: '测试体B',
      tableName: 'UNW_t_Cust_Entry100002',
      kind: 'entry',
      id: '0144d0583c0a4693b699607a9aa29710',
      entryName: 'UNW_Cust_Entry100002',
      seq: 14,
      entryPkFieldName: 'FEntryID',
    });
  });

  it('omits optional entry detail fields when absent (back-compat)', () => {
    // Old tests use minimal EntryEntity — make sure new optional fields don't
    // appear as `undefined` in output (would break .toEqual).
    const xml = `<Elements>
      <EntryEntity><Name>x</Name><Key>FE</Key><TableName>T_E</TableName></EntryEntity>
    </Elements>`;
    const e = parseFormLayoutContainers(xml).entries[0];
    expect(e).toEqual({ key: 'FE', name: 'x', tableName: 'T_E', kind: 'entry' });
    expect('id' in e).toBe(false);
    expect('seq' in e).toBe(false);
  });

  // TabControl is the parent container for TabPages. Plan 5.14 supports
  // creating one (kingdee_create_tab_control), so we need to enumerate the
  // extension's existing TabControls + their containers.
  it('extracts TabControlAppearance with key + caption + container', () => {
    const xml = `<Appearances>
      <TabControlAppearance ElementType="1005" ElementStyle="1">
        <Container>FSPLITECONTAINER~Panel2</Container>
        <Caption>页签控件</Caption>
        <Id>2ceea14b-7a1a-419c-b7ca-152c9c033e56</Id>
        <Key>F_UNW_Tab_8mg</Key>
      </TabControlAppearance>
    </Appearances>`;
    expect(parseFormLayoutContainers(xml).tabControls).toEqual([
      {
        key: 'F_UNW_Tab_8mg',
        caption: '页签控件',
        container: 'FSPLITECONTAINER~Panel2',
      },
    ]);
  });

  it('dedups duplicate TabControl Keys', () => {
    const xml = `<Appearances>
      <TabControlAppearance>
        <Container>FSPLITECONTAINER~Panel2</Container>
        <Caption>a</Caption>
        <Key>FTC1</Key>
      </TabControlAppearance>
      <TabControlAppearance>
        <Container>FSPLITECONTAINER~Panel2</Container>
        <Caption>a dup</Caption>
        <Key>FTC1</Key>
      </TabControlAppearance>
    </Appearances>`;
    expect(parseFormLayoutContainers(xml).tabControls).toHaveLength(1);
  });
});
