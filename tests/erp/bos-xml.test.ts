import { describe, expect, it } from 'vitest';
import {
  addPluginToKernelXml,
  buildExtensionKernelXml,
  parseFormPluginsFromKernelXml,
  removePluginFromKernelXml,
  xmlEscape
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
