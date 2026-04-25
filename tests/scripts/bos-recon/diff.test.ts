import { describe, it, expect } from 'vitest';
import {
  computeTableRowDiff,
  hashRowExcludingNoise,
  formatRowAsTable,
  renderReportMarkdown,
  buildXmlDelta
} from '../../../scripts/bos-recon/diff';

describe('hashRowExcludingNoise', () => {
  it('ignores noise columns so only semantic change bumps hash', () => {
    const h1 = hashRowExcludingNoise({ FID: 'x', FNAME: 'A', FMODIFYDATE: '2026-01-01' });
    const h2 = hashRowExcludingNoise({ FID: 'x', FNAME: 'A', FMODIFYDATE: '2026-99-99' });
    expect(h1).toBe(h2);
  });

  it('detects semantic change', () => {
    const h1 = hashRowExcludingNoise({ FID: 'x', FNAME: 'A' });
    const h2 = hashRowExcludingNoise({ FID: 'x', FNAME: 'B' });
    expect(h1).not.toBe(h2);
  });
});

describe('computeTableRowDiff', () => {
  it('classifies added / removed / modified / unchanged', () => {
    const before = [{ FID: 'a', FNAME: 'X' }, { FID: 'b', FNAME: 'Y' }];
    const after = [
      { FID: 'a', FNAME: 'X' },    // unchanged
      { FID: 'b', FNAME: 'Y2' },   // modified
      { FID: 'c', FNAME: 'Z' }     // added
    ];
    // Add 'd' to before that disappears in after.
    const before2 = [...before, { FID: 'd', FNAME: 'W' }];
    const diff = computeTableRowDiff(before2, after, 'FID');
    expect(diff.added.map((r) => r.FID)).toEqual(['c']);
    expect(diff.removed.map((r) => r.FID)).toEqual(['d']);
    expect(diff.modified.map((r) => r.after.FID)).toEqual(['b']);
    expect(diff.unchanged).toHaveLength(1);
  });

  it('empty before + empty after = no changes', () => {
    const diff = computeTableRowDiff([], [], 'FID');
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it('missing key column in a row -> row listed as unidentifiable', () => {
    const diff = computeTableRowDiff([{ FID: 'a' }], [{ FOTHER: 'b' }], 'FID');
    expect(diff.unidentifiable).toHaveLength(1);
  });

  it('handles 1:N child table via composite key (foreign key + inner PK)', () => {
    // 场景: T_META_OBJECTTYPEREF — 扩展 FID (FOBJECTTYPEID) 对 77 行都相同,
    // 真正区分行的是 FID。单列 keyColumn='FOBJECTTYPEID' 会让 Map 后写覆盖,
    // 导致 76 行被错误标 modified。复合键 ['FOBJECTTYPEID', 'FID'] 让每行有
    // 唯一身份, diff 恢复准确。
    const before = [
      { FOBJECTTYPEID: 'ext-1', FID: 'r1', FREFOBJECT: 'A' },
      { FOBJECTTYPEID: 'ext-1', FID: 'r2', FREFOBJECT: 'B' },
      { FOBJECTTYPEID: 'ext-1', FID: 'r3', FREFOBJECT: 'C' }
    ];
    const after = [
      { FOBJECTTYPEID: 'ext-1', FID: 'r1', FREFOBJECT: 'A' }, // unchanged
      { FOBJECTTYPEID: 'ext-1', FID: 'r2', FREFOBJECT: 'B2' }, // modified
      { FOBJECTTYPEID: 'ext-1', FID: 'r3', FREFOBJECT: 'C' } // unchanged
    ];
    const diff = computeTableRowDiff(before, after, ['FOBJECTTYPEID', 'FID']);
    expect(diff.unchanged).toHaveLength(2);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].after.FID).toBe('r2');
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('composite key detects row added / removed on shared foreign key', () => {
    const before = [
      { FOBJECTTYPEID: 'ext-1', FID: 'r1' },
      { FOBJECTTYPEID: 'ext-1', FID: 'r2' }
    ];
    const after = [
      { FOBJECTTYPEID: 'ext-1', FID: 'r1' }, // unchanged
      { FOBJECTTYPEID: 'ext-1', FID: 'r3' } // r2 removed, r3 added
    ];
    const diff = computeTableRowDiff(before, after, ['FOBJECTTYPEID', 'FID']);
    expect(diff.removed.map((r) => r.FID)).toEqual(['r2']);
    expect(diff.added.map((r) => r.FID)).toEqual(['r3']);
    expect(diff.modified).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });

  it('composite key with one missing column -> unidentifiable', () => {
    // 复合键里任一列缺失都应标 unidentifiable,不能 silently 用空串当 key 匹配错。
    const before = [{ FOBJECTTYPEID: 'ext-1', FID: 'r1' }];
    const after = [{ FOBJECTTYPEID: 'ext-1' /* FID missing */ }];
    const diff = computeTableRowDiff(before, after, ['FOBJECTTYPEID', 'FID']);
    expect(diff.unidentifiable).toHaveLength(1);
  });
});

describe('buildXmlDelta (FKERNELXML 字段级 diff)', () => {
  it('抽带属性的 open-tag 作签名, 能区分 <TextField Key="F1"> vs <TextField Key="F2">', () => {
    const before = '<Root><Form action="edit"/></Root>';
    const after = '<Root><Form action="edit"/><TextField Key="F1"/></Root>';
    const d = buildXmlDelta(before, after);
    expect(d.addedElements).toContain('<TextField Key="F1">');
    expect(d.removedElements).toHaveLength(0);
  });

  it('属性值变化 → 新签名 added + 旧签名 removed', () => {
    const before = '<R><Tag a="1"/></R>';
    const after = '<R><Tag a="2"/></R>';
    const d = buildXmlDelta(before, after);
    expect(d.addedElements).toContain('<Tag a="2">');
    expect(d.removedElements).toContain('<Tag a="1">');
  });

  it('多重集计数: before 两份同 tag, after 一份 → 1 removed', () => {
    const before = '<R><A/><A/></R>';
    const after = '<R><A/></R>';
    const d = buildXmlDelta(before, after);
    expect(d.removedElements.filter((e) => e === '<A>')).toHaveLength(1);
    expect(d.addedElements).toHaveLength(0);
  });

  it('XML 完全相同 → empty delta', () => {
    const xml = '<R><A attr="v"/><B/></R>';
    const d = buildXmlDelta(xml, xml);
    expect(d.addedElements).toHaveLength(0);
    expect(d.removedElements).toHaveLength(0);
  });

  it('属性顺序被规范化 (排序) → 不会误报 added/removed', () => {
    // XML 本身 attribute 顺序无语义, diff 算法不该因顺序不同算成两个不同签名
    const before = '<R><T b="2" a="1"/></R>';
    const after = '<R><T a="1" b="2"/></R>';
    const d = buildXmlDelta(before, after);
    expect(d.addedElements).toHaveLength(0);
    expect(d.removedElements).toHaveLength(0);
  });

  it('自闭合 vs 有 innerContent 的 tag 签名一致 (仅比 open 部分)', () => {
    // <A/> 和 <A>...</A> 的 open-tag 签名都是 <A>, 内容差异在多重集里由
    // 内部子 token 覆盖, 顶层 A 的 count 相同
    const before = '<R><A/></R>';
    const after = '<R><A><B/></A></R>';
    const d = buildXmlDelta(before, after);
    expect(d.addedElements).toContain('<B>');
    expect(d.addedElements).not.toContain('<A>');
    expect(d.removedElements).not.toContain('<A>');
  });
});

describe('renderReportMarkdown', () => {
  it('includes sections: overview / changed tables / XE trace / unexplained', () => {
    const md = renderReportMarkdown({
      label: 'add-text-field',
      extId: 'ext-123',
      beforeJsonPath: 'add-text-field-before.json',
      afterJsonPath: 'add-text-field-after.json',
      xelPath: 'add-text-field-trace.xel',
      tableChanges: [
        { tableName: 'T_META_FIELD', added: 1, removed: 0, modified: 0 }
      ],
      xmlChanges: [
        { table: 'T_META_OBJECTTYPE', column: 'FKERNELXML', addedElements: ['<Field>...'], removedElements: [] }
      ],
      xeEvents: 7,
      unexplained: []
    });
    expect(md).toMatch(/# Recon report:/);
    expect(md).toMatch(/## Changed tables/);
    expect(md).toMatch(/T_META_FIELD/);
    expect(md).toMatch(/## FKERNELXML diff/);
    expect(md).toMatch(/## XE SQL trace/);
    expect(md).toMatch(/7 events/);
  });

  it('surfaces unexplained diffs prominently', () => {
    const md = renderReportMarkdown({
      label: 'x',
      extId: 'e',
      beforeJsonPath: '',
      afterJsonPath: '',
      xelPath: '',
      tableChanges: [],
      xmlChanges: [],
      xeEvents: 0,
      unexplained: ['T_META_CACHE: 1 row added but no XE INSERT found']
    });
    expect(md).toMatch(/⚠.*unexplained/i);
    expect(md).toMatch(/T_META_CACHE/);
  });
});

describe('formatRowAsTable', () => {
  it('renders a row as a markdown table', () => {
    const md = formatRowAsTable({ FID: 'x', FNAME: 'Test' });
    expect(md).toMatch(/\| column \| value \|/);
    expect(md).toMatch(/\| FID \| x \|/);
    expect(md).toMatch(/\| FNAME \| Test \|/);
  });

  it('escapes newlines so multi-line values (FKERNELXML) do not break the table', () => {
    const md = formatRowAsTable({ FID: 'x', FKERNELXML: '<FormMetadata>\n  <Form/>\n</FormMetadata>' });
    // Each column should be one line in the markdown output.
    expect(md.split('\n').filter((l) => l.startsWith('| FKERNELXML'))).toHaveLength(1);
    expect(md).toMatch(/<br>/);
  });

  it('escapes pipes in values', () => {
    const md = formatRowAsTable({ FID: 'x', FNAME: 'a|b' });
    expect(md).toMatch(/\| FNAME \| a\\\|b \|/);
  });
});

describe('renderReportMarkdown extras', () => {
  it('surfaces unidentifiableCount when > 0', () => {
    const md = renderReportMarkdown({
      label: 'x',
      extId: 'e',
      beforeJsonPath: '',
      afterJsonPath: '',
      xelPath: '',
      tableChanges: [],
      xmlChanges: [],
      xeEvents: 0,
      unexplained: [],
      unidentifiableCount: 3
    });
    expect(md).toMatch(/3 row\(s\) had no resolvable key/);
  });

  it('omits unidentifiable warning when 0 or absent', () => {
    const md = renderReportMarkdown({
      label: 'x',
      extId: 'e',
      beforeJsonPath: '',
      afterJsonPath: '',
      xelPath: '',
      tableChanges: [],
      xmlChanges: [],
      xeEvents: 0,
      unexplained: []
    });
    expect(md).not.toMatch(/no resolvable key/);
  });
});
