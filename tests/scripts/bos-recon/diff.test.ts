import { describe, it, expect } from 'vitest';
import {
  computeTableRowDiff,
  hashRowExcludingNoise,
  formatRowAsTable,
  renderReportMarkdown
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
