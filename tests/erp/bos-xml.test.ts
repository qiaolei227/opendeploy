import { describe, expect, it } from 'vitest';
import {
  addPluginToKernelXml,
  buildExtensionKernelXml,
  insertTextFieldIntoKernelXml,
  parseFieldsFromKernelXml,
  parseFormPluginsFromKernelXml,
  removePluginFromKernelXml,
  xmlEscape,
  type ExtensionFieldMeta
} from '../../src/main/erp/k3cloud/bos-xml';
import type { PluginMeta } from '@shared/erp-types';

const EXT = '719dec90-f2d9-4c13-b26e-08b88642c3eb';

describe('xmlEscape', () => {
  it('escapes XML entities', () => {
    expect(xmlEscape('<foo & "bar">')).toBe('&lt;foo &amp; &quot;bar&quot;&gt;');
  });
});

describe('buildExtensionKernelXml', () => {
  it('emits empty <FormPlugins/> when no plugins are supplied', () => {
    const xml = buildExtensionKernelXml(EXT, []);
    expect(xml).toContain(`<Id>${EXT}</Id>`);
    expect(xml).toContain('<FormPlugins/>');
    expect(xml).not.toContain('<FormPlugins>');
  });

  it('emits a Python PlugIn with ClassName + PlugInType=1 + PyScript', () => {
    const xml = buildExtensionKernelXml(EXT, [
      { className: 'credit_guard', type: 'python', pyScript: '# body' }
    ]);
    expect(xml).toContain('<ClassName>credit_guard</ClassName>');
    expect(xml).toContain('<PlugInType>1</PlugInType>');
    expect(xml).toContain('<PyScript># body</PyScript>');
  });

  it('escapes XML specials in Python script body', () => {
    const xml = buildExtensionKernelXml(EXT, [
      {
        className: 'guard',
        type: 'python',
        pyScript: 'if x < y and y > 0 and name == "foo":'
      }
    ]);
    expect(xml).toContain(
      '<PyScript>if x &lt; y and y &gt; 0 and name == &quot;foo&quot;:</PyScript>'
    );
    // Round-trip: parsing the output should yield the original body.
    const roundTrip = parseFormPluginsFromKernelXml(xml)[0];
    expect(roundTrip.pyScript).toBe('if x < y and y > 0 and name == "foo":');
  });

  it('emits a DLL PlugIn with ClassName + OrderId (no PlugInType/PyScript)', () => {
    const xml = buildExtensionKernelXml(EXT, [
      {
        className: 'Kingdee.Foo, Kingdee.Foo',
        type: 'dll',
        orderId: 3
      }
    ]);
    expect(xml).toContain('<ClassName>Kingdee.Foo, Kingdee.Foo</ClassName>');
    expect(xml).toContain('<OrderId>3</OrderId>');
    expect(xml).not.toContain('<PlugInType>');
    expect(xml).not.toContain('<PyScript>');
  });
});

describe('parseFormPluginsFromKernelXml', () => {
  it('returns [] for XML without a <FormPlugins> block', () => {
    expect(parseFormPluginsFromKernelXml('')).toEqual([]);
    expect(parseFormPluginsFromKernelXml(buildExtensionKernelXml(EXT, []))).toEqual([]);
  });

  it('parses the canonical Python plugin shape (from real UAT data)', () => {
    // Copied verbatim from scripts/out recon: user's `opendeploy_python_test`
    // extension on SAL_SaleOrder.
    const xml = [
      '<FormMetadata><BusinessInfo><BusinessInfo><Elements>',
      '<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">',
      `<Id>${EXT}</Id>`,
      '<FormPlugins>',
      '<PlugIn ElementType="0" ElementStyle="0">',
      '<ClassName>opendeploy_python_test</ClassName>',
      '<PlugInType>1</PlugInType>',
      '<PyScript>#opendeploy_python_test</PyScript>',
      '</PlugIn>',
      '</FormPlugins>',
      '</Form>',
      '</Elements></BusinessInfo></BusinessInfo></FormMetadata>'
    ].join('');
    const plugins = parseFormPluginsFromKernelXml(xml);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toEqual({
      className: 'opendeploy_python_test',
      type: 'python',
      pyScript: '#opendeploy_python_test'
    });
  });

  it('parses the canonical DLL plugin shape', () => {
    // From SAL_SaleOrder base form's FKERNELXML.
    const xml = [
      '<FormPlugins>',
      '<PlugIn ElementType="0" ElementStyle="0">',
      '<ClassName>Kingdee.K3.SCM.Sal.Business.PlugIn.SaleOrderEdit, Kingdee.K3.SCM.Sal.Business.PlugIn</ClassName>',
      '<OrderId>3</OrderId>',
      '</PlugIn>',
      '</FormPlugins>'
    ].join('');
    expect(parseFormPluginsFromKernelXml(xml)[0]).toEqual({
      className:
        'Kingdee.K3.SCM.Sal.Business.PlugIn.SaleOrderEdit, Kingdee.K3.SCM.Sal.Business.PlugIn',
      type: 'dll',
      orderId: 3
    });
  });

  it('keeps multiple plugins in declared order', () => {
    const xml = [
      '<FormPlugins>',
      '<PlugIn><ClassName>first</ClassName><PlugInType>1</PlugInType><PyScript># a</PyScript></PlugIn>',
      '<PlugIn><ClassName>second</ClassName><OrderId>2</OrderId></PlugIn>',
      '<PlugIn><ClassName>third</ClassName><PlugInType>1</PlugInType><PyScript># c</PyScript></PlugIn>',
      '</FormPlugins>'
    ].join('');
    const plugins = parseFormPluginsFromKernelXml(xml);
    expect(plugins.map((p) => p.className)).toEqual(['first', 'second', 'third']);
    expect(plugins.map((p) => p.type)).toEqual(['python', 'dll', 'python']);
  });

  it('ignores <ClassName> appearing in unrelated nested structures', () => {
    // FormPlugins at top level, but document also contains other ClassName
    // tags in unrelated nodes — parser should only pick up top-level <PlugIn>.
    const xml = [
      '<Form>',
      '<SomeOtherBlock><ClassName>should_not_appear</ClassName></SomeOtherBlock>',
      '<FormPlugins>',
      '<PlugIn><ClassName>real_plugin</ClassName><PlugInType>1</PlugInType><PyScript/></PlugIn>',
      '</FormPlugins>',
      '</Form>'
    ].join('');
    const plugins = parseFormPluginsFromKernelXml(xml);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].className).toBe('real_plugin');
  });
});

describe('addPluginToKernelXml', () => {
  it('adds a Python plugin to an extension that had none', () => {
    const xml = buildExtensionKernelXml(EXT, []);
    const plugin: PluginMeta = { className: 'new_guard', type: 'python', pyScript: '# x' };
    const next = addPluginToKernelXml(xml, plugin);
    expect(parseFormPluginsFromKernelXml(next)).toEqual([plugin]);
  });

  it('appends to an existing plugin list', () => {
    const original: PluginMeta[] = [
      { className: 'existing', type: 'python', pyScript: '# old' }
    ];
    const xml = buildExtensionKernelXml(EXT, original);
    const added: PluginMeta = { className: 'new_one', type: 'python', pyScript: '# new' };
    const next = addPluginToKernelXml(xml, added);
    const parsed = parseFormPluginsFromKernelXml(next);
    expect(parsed.map((p) => p.className)).toEqual(['existing', 'new_one']);
  });

  it('throws when adding a plugin whose ClassName already exists', () => {
    const xml = buildExtensionKernelXml(EXT, [
      { className: 'dupe', type: 'python', pyScript: '# v1' }
    ]);
    expect(() =>
      addPluginToKernelXml(xml, { className: 'dupe', type: 'python', pyScript: '# v2' })
    ).toThrow(/already registered/);
  });
});

describe('removePluginFromKernelXml', () => {
  it('removes a plugin by ClassName', () => {
    const xml = buildExtensionKernelXml(EXT, [
      { className: 'keep', type: 'python', pyScript: '# k' },
      { className: 'drop', type: 'python', pyScript: '# d' }
    ]);
    const next = removePluginFromKernelXml(xml, 'drop');
    const plugins = parseFormPluginsFromKernelXml(next);
    expect(plugins.map((p) => p.className)).toEqual(['keep']);
  });

  it('is a no-op when the target plugin is absent', () => {
    const xml = buildExtensionKernelXml(EXT, [
      { className: 'only', type: 'python', pyScript: '# o' }
    ]);
    const next = removePluginFromKernelXml(xml, 'missing');
    expect(parseFormPluginsFromKernelXml(next).map((p) => p.className)).toEqual(['only']);
  });

  it('leaves <FormPlugins/> when the last plugin is removed', () => {
    const xml = buildExtensionKernelXml(EXT, [
      { className: 'solo', type: 'python', pyScript: '' }
    ]);
    const next = removePluginFromKernelXml(xml, 'solo');
    expect(next).toContain('<FormPlugins/>');
    expect(parseFormPluginsFromKernelXml(next)).toEqual([]);
  });
});

describe('insertTextFieldIntoKernelXml', () => {
  // 固定 id/numeric generator 让输出可确定, 测试能精确断言。
  const fixedIds = () => {
    let n = 0;
    return () => {
      n++;
      return `0000000000000000000000000000000${n}`.slice(-32);
    };
  };
  const fixedNumerics = () => ({ listTabIndex: 100, zOrderIndex: 10, tabindex: 200 });

  const baseExtXml = buildExtensionKernelXml(EXT, []);

  it('在还没字段的扩展里首次加文本字段 → 创建 TextField 节点 + 新建 LayoutInfos 块', () => {
    const xml = insertTextFieldIntoKernelXml(baseExtXml, {
      spec: { key: 'F_TEST01', caption: '文本字段' },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    expect(xml).toContain('<TextField');
    expect(xml).toContain('<Key>F_TEST01</Key>');
    expect(xml).toContain('<Caption>文本字段</Caption>');
    expect(xml).toContain('<LayoutInfos>');
    expect(xml).toContain('<TextFieldAppearance');
  });

  it('TextField 节点插在 Form 之后 Elements 之内 (兄弟节点位置, 不嵌在 Form 里)', () => {
    const xml = insertTextFieldIntoKernelXml(baseExtXml, {
      spec: { key: 'F_X', caption: 'x' },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    const formCloseIdx = xml.indexOf('</Form>');
    const textFieldIdx = xml.indexOf('<TextField');
    const elementsCloseIdx = xml.indexOf('</Elements>');
    expect(formCloseIdx).toBeGreaterThan(0);
    expect(textFieldIdx).toBeGreaterThan(formCloseIdx);
    expect(elementsCloseIdx).toBeGreaterThan(textFieldIdx);
  });

  it('派生 PropertyName/FieldName: 未提供时用 key (FieldName 大写)', () => {
    const xml = insertTextFieldIntoKernelXml(baseExtXml, {
      spec: { key: 'F_my_col', caption: 'x' },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    expect(xml).toContain('<PropertyName>F_my_col</PropertyName>');
    expect(xml).toContain('<FieldName>F_MY_COL</FieldName>');
  });

  it('自定义 propertyName / fieldName 覆盖默认派生', () => {
    const xml = insertTextFieldIntoKernelXml(baseExtXml, {
      spec: {
        key: 'F_X',
        caption: 'x',
        propertyName: 'F_Custom_Prop',
        fieldName: 'F_CUSTOM_COL'
      },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    expect(xml).toContain('<PropertyName>F_Custom_Prop</PropertyName>');
    expect(xml).toContain('<FieldName>F_CUSTOM_COL</FieldName>');
  });

  it('containerKey 默认 FTAB_P0', () => {
    const xml = insertTextFieldIntoKernelXml(baseExtXml, {
      spec: { key: 'F_X', caption: 'x' },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    expect(xml).toContain('<Container>FTAB_P0</Container>');
  });

  it('第二次加字段 (XML 已有 LayoutInfos) → 只追加 TextFieldAppearance, 不重建 LayoutInfos', () => {
    const first = insertTextFieldIntoKernelXml(baseExtXml, {
      spec: { key: 'F_A', caption: 'A' },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    const second = insertTextFieldIntoKernelXml(first, {
      spec: { key: 'F_B', caption: 'B' },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    // 两个 TextField, 两个 TextFieldAppearance, 但只有一个 LayoutInfos 块
    expect((second.match(/<TextField[\s>]/g) || [])).toHaveLength(2);
    expect((second.match(/<TextFieldAppearance\b/g) || [])).toHaveLength(2);
    expect((second.match(/<LayoutInfos>/g) || [])).toHaveLength(1);
    expect((second.match(/<\/LayoutInfos>/g) || [])).toHaveLength(1);
  });

  it('XML 转义: caption 含特殊字符时被安全转义, 不破坏 XML 结构', () => {
    const xml = insertTextFieldIntoKernelXml(baseExtXml, {
      spec: { key: 'F_X', caption: '<script>&"危险"' },
      idGenerator: fixedIds(),
      numericGenerator: fixedNumerics
    });
    expect(xml).toContain('<Caption>&lt;script&gt;&amp;&quot;危险&quot;</Caption>');
  });

  it('key 非法 (空) → 抛错', () => {
    expect(() =>
      insertTextFieldIntoKernelXml(baseExtXml, {
        spec: { key: '', caption: 'x' },
        idGenerator: fixedIds(),
        numericGenerator: fixedNumerics
      })
    ).toThrow(/key/i);
  });

  it('XML 没有扩展 <Id> 节点 → 抛错 (不是扩展 kernel xml)', () => {
    expect(() =>
      insertTextFieldIntoKernelXml('<not-extension/>', {
        spec: { key: 'F_X', caption: 'x' },
        idGenerator: fixedIds(),
        numericGenerator: fixedNumerics
      })
    ).toThrow();
  });
});

describe('parseFieldsFromKernelXml', () => {
  it('returns [] for XML without TextField', () => {
    const xml = buildExtensionKernelXml(EXT, []);
    expect(parseFieldsFromKernelXml(xml)).toEqual([]);
  });

  it('parses one inserted text field with caption from appearance', () => {
    const base = buildExtensionKernelXml(EXT, []);
    const xml = insertTextFieldIntoKernelXml(base, {
      spec: { key: 'F_DEMO', caption: '演示字段' }
    });
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields).toEqual<ExtensionFieldMeta[]>([
      {
        key: 'F_DEMO',
        type: 'text',
        caption: '演示字段',
        propertyName: 'F_DEMO',
        fieldName: 'F_DEMO',
        container: 'FTAB_P0'
      }
    ]);
  });

  it('parses multiple fields keeping insertion order', () => {
    let xml = buildExtensionKernelXml(EXT, []);
    xml = insertTextFieldIntoKernelXml(xml, { spec: { key: 'F_A', caption: '甲' } });
    xml = insertTextFieldIntoKernelXml(xml, { spec: { key: 'F_B', caption: '乙' } });
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields.map((f) => f.key)).toEqual(['F_A', 'F_B']);
    expect(fields.find((f) => f.key === 'F_A')?.caption).toBe('甲');
    expect(fields.find((f) => f.key === 'F_B')?.caption).toBe('乙');
  });

  it('falls back to Name when no matching appearance Caption', () => {
    // 手工构造一个只有 TextField 没有 Appearance 的 XML — 实际场景罕见
    // (Designer 总会写 Appearance), 但 parser 不能因此 crash.
    const xml =
      '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
      '<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">' +
      `<Id>${EXT}</Id><FormPlugins/>` +
      '</Form>' +
      '<TextField ElementType="1" ElementStyle="0">' +
      '<PropertyName>F_X</PropertyName><FieldName>F_X</FieldName>' +
      '<Name>仅名称</Name><Id>x</Id><Key>F_X</Key>' +
      '</TextField>' +
      '</Elements></BusinessInfo></BusinessInfo></FormMetadata>';
    const fields = parseFieldsFromKernelXml(xml);
    expect(fields).toEqual<ExtensionFieldMeta[]>([
      {
        key: 'F_X',
        type: 'text',
        caption: '仅名称',
        propertyName: 'F_X',
        fieldName: 'F_X',
        container: undefined
      }
    ]);
  });
});

describe('insertTextFieldIntoKernelXml default placement', () => {
  it('places new field with high Top/ZOrder so it does not overlap top-left', () => {
    const xml = insertTextFieldIntoKernelXml(
      buildExtensionKernelXml(EXT, []),
      { spec: { key: 'F_DEMO', caption: '演示字段' } }
    );
    expect(xml).toContain('<Top>9000</Top>');
    expect(xml).toContain('<ZOrderIndex>9999</ZOrderIndex>');
  });

  it('respects explicit top/left from spec', () => {
    const xml = insertTextFieldIntoKernelXml(
      buildExtensionKernelXml(EXT, []),
      { spec: { key: 'F_X', caption: '甲', top: 200, left: 50 } }
    );
    expect(xml).toContain('<Top>200</Top>');
    expect(xml).toContain('<Left>50</Left>');
  });
});
