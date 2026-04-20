import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import {
  installFromSource,
  removeAll,
  currentVersion,
  checkUpdates
} from '../../src/main/skills/manager';
import type { KnowledgeSource } from '@shared/skill-types';

let root: string;
let scratch: string;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Build a bundle dir (manifest.json + skills/common/a/SKILL.md) on disk. */
async function makeBundleDir(
  baseDir: string,
  skillBody: string,
  manifestOverrides: Partial<{ sha256: string; version: string }> = {}
): Promise<string> {
  const bundle = path.join(baseDir, 'bundle');
  const skillFile = path.join(bundle, 'skills', 'common', 'a', 'SKILL.md');
  const skillSrc = `---\nname: a\ndescription: d\nversion: 1.0.0\n---\n${skillBody}\n`;
  await fs.mkdir(path.dirname(skillFile), { recursive: true });
  await fs.writeFile(skillFile, skillSrc, 'utf8');
  const manifest = {
    schema: '1',
    version: manifestOverrides.version ?? '1.0.0',
    skills: [
      {
        id: 'common/a',
        version: '1.0.0',
        sha256: manifestOverrides.sha256 ?? sha256(skillSrc)
      }
    ]
  };
  await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return bundle;
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-mgr-'));
  root = path.join(scratch, 'knowledge');
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('installFromSource (local)', () => {
  it('copies a valid bundle into the knowledge dir', async () => {
    const bundle = await makeBundleDir(scratch, 'body text');
    const source: KnowledgeSource = { id: 's', kind: 'local', location: bundle };

    await installFromSource(source, { root });

    const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe('1.0.0');
    const skill = await fs.readFile(
      path.join(root, 'skills', 'common', 'a', 'SKILL.md'),
      'utf8'
    );
    expect(skill).toContain('body text');
  });

  it('replaces an existing bundle', async () => {
    await installFromSource(
      { id: 's', kind: 'local', location: await makeBundleDir(scratch, 'old') },
      { root }
    );

    const newScratch = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-mgr2-'));
    try {
      const bundle2 = await makeBundleDir(newScratch, 'new body', { version: '1.1.0' });
      await installFromSource(
        { id: 's', kind: 'local', location: bundle2 },
        { root }
      );

      const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
      expect(manifest.version).toBe('1.1.0');
      const skill = await fs.readFile(
        path.join(root, 'skills', 'common', 'a', 'SKILL.md'),
        'utf8'
      );
      expect(skill).toContain('new body');
    } finally {
      await fs.rm(newScratch, { recursive: true, force: true });
    }
  });

  it('rejects a bundle with no manifest.json', async () => {
    const bundle = path.join(scratch, 'no-manifest');
    await fs.mkdir(path.join(bundle, 'skills', 'common', 'a'), { recursive: true });
    await fs.writeFile(
      path.join(bundle, 'skills', 'common', 'a', 'SKILL.md'),
      '---\nname: a\ndescription: d\nversion: 1.0.0\n---\nbody\n',
      'utf8'
    );

    await expect(
      installFromSource({ id: 's', kind: 'local', location: bundle }, { root })
    ).rejects.toThrow(/manifest\.json/);
  });

  it('rejects a bundle whose hashes do not match the manifest', async () => {
    const bundle = await makeBundleDir(scratch, 'body', { sha256: 'deadbeef' });

    await expect(
      installFromSource({ id: 's', kind: 'local', location: bundle }, { root })
    ).rejects.toThrow(/integrity/);
  });

  it('leaves the existing cache untouched when a new install fails integrity', async () => {
    const good = await makeBundleDir(scratch, 'good');
    await installFromSource({ id: 's', kind: 'local', location: good }, { root });

    const badScratch = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-mgr3-'));
    try {
      const bad = await makeBundleDir(badScratch, 'bad', { sha256: 'nope' });
      await expect(
        installFromSource({ id: 's', kind: 'local', location: bad }, { root })
      ).rejects.toThrow(/integrity/);
    } finally {
      await fs.rm(badScratch, { recursive: true, force: true });
    }

    const skill = await fs.readFile(
      path.join(root, 'skills', 'common', 'a', 'SKILL.md'),
      'utf8'
    );
    expect(skill).toContain('good');
  });
});

describe('installFromSource (github)', () => {
  it('downloads, extracts, verifies, then adopts', async () => {
    // Build a real tarball wrapped in a top-level dir (github tarballs do this).
    const fixture = await makeBundleDir(scratch, 'from github');
    const wrapped = path.join(scratch, 'wrapped', 'opendeploy-knowledge-main');
    await fs.mkdir(path.dirname(wrapped), { recursive: true });
    await fs.cp(fixture, wrapped, { recursive: true });
    const tarPath = path.join(scratch, 'repo.tar.gz');
    await tar.c({ gzip: true, file: tarPath, cwd: path.dirname(wrapped) }, [
      'opendeploy-knowledge-main'
    ]);
    const tarBuf = await fs.readFile(tarPath);

    const fetchFn = async () =>
      new Response(tarBuf, { status: 200, headers: { 'content-type': 'application/gzip' } });

    await installFromSource(
      { id: 's', kind: 'github', location: 'owner/opendeploy-knowledge' },
      { root, fetchFn }
    );

    const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe('1.0.0');
  });
});

describe('currentVersion', () => {
  it('returns null when nothing is installed', async () => {
    expect(await currentVersion({ root })).toBeNull();
  });

  it('returns the version from the local manifest', async () => {
    const bundle = await makeBundleDir(scratch, 'x', { version: '2.3.4' });
    await installFromSource({ id: 's', kind: 'local', location: bundle }, { root });

    expect(await currentVersion({ root })).toBe('2.3.4');
  });
});

describe('checkUpdates', () => {
  it('returns local and remote versions', async () => {
    const bundle = await makeBundleDir(scratch, 'x', { version: '1.0.0' });
    await installFromSource({ id: 's', kind: 'local', location: bundle }, { root });

    const fetchFn = async () =>
      new Response(
        JSON.stringify({ schema: '1', version: '1.1.0', skills: [] }),
        { status: 200 }
      );

    const r = await checkUpdates(
      { id: 's', kind: 'github', location: 'owner/repo' },
      { root, fetchFn }
    );

    expect(r).toEqual({ local: '1.0.0', remote: '1.1.0' });
  });

  it('surfaces fetch failures', async () => {
    const fetchFn = async () => new Response('boom', { status: 500 });

    await expect(
      checkUpdates(
        { id: 's', kind: 'github', location: 'owner/repo' },
        { root, fetchFn }
      )
    ).rejects.toThrow(/500/);
  });
});

describe('removeAll', () => {
  it('wipes the knowledge dir', async () => {
    const bundle = await makeBundleDir(scratch, 'x');
    await installFromSource({ id: 's', kind: 'local', location: bundle }, { root });

    await removeAll({ root });

    await expect(fs.stat(root)).rejects.toThrow();
  });

  it('is a no-op when nothing is installed', async () => {
    await expect(removeAll({ root })).resolves.toBeUndefined();
  });
});
