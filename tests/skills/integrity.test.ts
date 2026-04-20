import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { hashFile, verifyIntegrity } from '../../src/main/skills/integrity';
import type { KnowledgeManifest, SkillMeta } from '@shared/skill-types';

let root: string;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function seedSkill(id: string, content: string): Promise<SkillMeta> {
  const dir = path.join(root, 'skills', ...id.split('/'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf8');
  return {
    id,
    name: id.split('/').pop()!,
    description: 'x',
    version: '1.0.0',
    path: dir
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-integrity-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('hashFile', () => {
  it('returns the SHA-256 of the file contents', async () => {
    const p = path.join(root, 'f.txt');
    const body = 'hello world';
    await fs.writeFile(p, body, 'utf8');

    expect(await hashFile(p)).toBe(sha256(body));
  });
});

describe('verifyIntegrity', () => {
  it('passes when every skill hash matches the manifest', async () => {
    const content = '---\nname: a\ndescription: d\nversion: 1.0.0\n---\nbody\n';
    const meta = await seedSkill('common/a', content);
    const manifest: KnowledgeManifest = {
      schema: '1',
      version: '1.0.0',
      skills: [{ id: 'common/a', version: '1.0.0', sha256: sha256(content) }]
    };

    const r = await verifyIntegrity(root, manifest, [meta]);

    expect(r.ok).toBe(true);
    expect(r.mismatches).toEqual([]);
  });

  it('reports tampered skills', async () => {
    const content = 'original content';
    const meta = await seedSkill('common/a', content);
    const manifest: KnowledgeManifest = {
      schema: '1',
      version: '1.0.0',
      skills: [
        { id: 'common/a', version: '1.0.0', sha256: sha256('expected different content') }
      ]
    };

    const r = await verifyIntegrity(root, manifest, [meta]);

    expect(r.ok).toBe(false);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({
      id: 'common/a',
      expected: sha256('expected different content')
    });
    expect(r.mismatches[0].actual).toBe(sha256(content));
  });

  it('reports skills listed in the manifest but missing on disk', async () => {
    const manifest: KnowledgeManifest = {
      schema: '1',
      version: '1.0.0',
      skills: [{ id: 'common/ghost', version: '1.0.0', sha256: 'whatever' }]
    };

    const r = await verifyIntegrity(root, manifest, []);

    expect(r.ok).toBe(false);
    expect(r.mismatches[0]).toMatchObject({ id: 'common/ghost', actual: null });
  });

  it('ignores on-disk skills that are not in the manifest', async () => {
    const content = '---\nname: a\ndescription: d\nversion: 1.0.0\n---\nbody\n';
    const meta = await seedSkill('common/extra', content);

    const r = await verifyIntegrity(
      root,
      { schema: '1', version: '1.0.0', skills: [] },
      [meta]
    );

    expect(r.ok).toBe(true);
  });
});
