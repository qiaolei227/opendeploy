import { describe, it, expect } from 'vitest';
import { adapterFor } from '../../src/main/skills/remote';
import type { KnowledgeSource } from '@shared/skill-types';

const gh = (location: string): KnowledgeSource => ({ id: 's', kind: 'github', location });
const gt = (location: string): KnowledgeSource => ({ id: 's', kind: 'gitee', location });

describe('adapterFor(github)', () => {
  const a = adapterFor(gh('owner/repo'));

  it('defaults ref to main when omitted', () => {
    expect(a.tarballUrl(gh('owner/repo'))).toBe(
      'https://codeload.github.com/owner/repo/tar.gz/refs/heads/main'
    );
  });

  it('uses the explicit ref when given owner/repo@ref', () => {
    expect(a.tarballUrl(gh('owner/repo@v1'))).toBe(
      'https://codeload.github.com/owner/repo/tar.gz/refs/heads/v1'
    );
  });

  it('builds raw URLs under raw.githubusercontent.com', () => {
    expect(a.rawUrl(gh('owner/repo'), 'manifest.json')).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/manifest.json'
    );
    expect(a.rawUrl(gh('owner/repo@dev'), 'skills/common/a/SKILL.md')).toBe(
      'https://raw.githubusercontent.com/owner/repo/dev/skills/common/a/SKILL.md'
    );
  });

  it('rejects malformed locations', () => {
    expect(() => a.tarballUrl(gh('no-slash'))).toThrow(/invalid repo/);
    expect(() => a.tarballUrl(gh(''))).toThrow(/invalid repo/);
  });
});

describe('adapterFor(gitee)', () => {
  const a = adapterFor(gt('owner/repo'));

  it('builds tarball URLs under gitee.com', () => {
    expect(a.tarballUrl(gt('owner/repo'))).toBe(
      'https://gitee.com/owner/repo/repository/archive/main.tar.gz'
    );
    expect(a.tarballUrl(gt('owner/repo@v2'))).toBe(
      'https://gitee.com/owner/repo/repository/archive/v2.tar.gz'
    );
  });

  it('builds raw URLs under gitee.com/.../raw', () => {
    expect(a.rawUrl(gt('owner/repo'), 'manifest.json')).toBe(
      'https://gitee.com/owner/repo/raw/main/manifest.json'
    );
  });
});

describe('adapterFor(local)', () => {
  it('throws — local sources do not go through HTTPS', () => {
    expect(() =>
      adapterFor({ id: 's', kind: 'local', location: '/abs/path' })
    ).toThrow(/local/);
  });
});
