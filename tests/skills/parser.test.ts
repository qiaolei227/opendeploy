import { describe, it, expect } from 'vitest';
import { parseSkill } from '../../src/main/skills/parser';

const makeSkill = (frontmatter: string, body = 'body') =>
  `---\n${frontmatter}\n---\n${body}\n`;

describe('parseSkill', () => {
  it('extracts frontmatter and markdown body', () => {
    const src = makeSkill(
      [
        'name: demo',
        'description: Use when demoing the parser',
        'version: 1.0.0'
      ].join('\n'),
      '# Body heading\nbody text\n'
    );

    const r = parseSkill(src);

    expect(r.name).toBe('demo');
    expect(r.description).toBe('Use when demoing the parser');
    expect(r.version).toBe('1.0.0');
    expect(r.body).toContain('Body heading');
    expect(r.body).toContain('body text');
    // Body should NOT contain the frontmatter fence.
    expect(r.body).not.toMatch(/^---/);
  });

  it('keeps optional fields when present', () => {
    const src = makeSkill(
      [
        'name: demo',
        'description: optional fields',
        'version: 0.2.0',
        'erpProvider: kingdee-cosmic-v9'
      ].join('\n')
    );
    const r = parseSkill(src);
    expect(r.erpProvider).toBe('kingdee-cosmic-v9');
  });

  it('leaves optional fields undefined when absent', () => {
    const src = makeSkill('name: demo\ndescription: no extras\nversion: 1.0.0');
    const r = parseSkill(src);
    expect(r.erpProvider).toBeUndefined();
  });

  it('supports CRLF line endings', () => {
    const src = '---\r\nname: demo\r\ndescription: crlf\r\nversion: 1.0.0\r\n---\r\nbody\r\n';
    const r = parseSkill(src);
    expect(r.name).toBe('demo');
    expect(r.body.trim()).toBe('body');
  });

  it('rejects input without a frontmatter fence', () => {
    expect(() => parseSkill('no frontmatter here')).toThrow(/frontmatter/);
  });

  it('rejects missing required fields', () => {
    const src = makeSkill('name: only-name');
    expect(() => parseSkill(src)).toThrow(/description/);
  });

  it('rejects invalid semver version', () => {
    const src = makeSkill('name: x\ndescription: y\nversion: v1');
    expect(() => parseSkill(src)).toThrow(/semver/i);
  });

  it('rejects empty description', () => {
    const src = makeSkill('name: x\ndescription: ""\nversion: 1.0.0');
    expect(() => parseSkill(src)).toThrow(/description/);
  });

  it('accepts a valid category', () => {
    const src = makeSkill('name: x\ndescription: y\nversion: 1.0.0\ncategory: sales');
    expect(parseSkill(src).category).toBe('sales');
  });

  it('leaves category undefined when absent', () => {
    const src = makeSkill('name: x\ndescription: y\nversion: 1.0.0');
    expect(parseSkill(src).category).toBeUndefined();
  });

  it('rejects an unknown category', () => {
    const src = makeSkill('name: x\ndescription: y\nversion: 1.0.0\ncategory: bogus');
    expect(() => parseSkill(src)).toThrow(/category/i);
  });

  it('parses an optional title', () => {
    const src = makeSkill('name: x\ndescription: y\nversion: 1.0.0\ntitle: 技能激活自检');
    expect(parseSkill(src).title).toBe('技能激活自检');
  });

  it('leaves title undefined when absent', () => {
    const src = makeSkill('name: x\ndescription: y\nversion: 1.0.0');
    expect(parseSkill(src).title).toBeUndefined();
  });

  it('rejects an empty title', () => {
    const src = makeSkill('name: x\ndescription: y\nversion: 1.0.0\ntitle: ""');
    expect(() => parseSkill(src)).toThrow(/title/i);
  });
});
