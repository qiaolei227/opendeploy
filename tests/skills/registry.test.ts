import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanSkills, loadSkillBody } from '../../src/main/skills/registry';

let root: string;

async function makeSkill(
  id: string,
  frontmatter: Record<string, unknown>,
  body = 'body'
): Promise<void> {
  const dir = path.join(root, 'skills', ...id.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\n${yaml}\n---\n${body}\n`, 'utf8');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-skills-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('scanSkills', () => {
  it('returns empty array when the root does not exist', async () => {
    const missing = path.join(root, 'does-not-exist');
    expect(await scanSkills(missing)).toEqual([]);
  });

  it('returns empty array when skills dir is absent', async () => {
    expect(await scanSkills(root)).toEqual([]);
  });

  it('discovers skills across namespaces', async () => {
    await makeSkill('common/a', {
      name: 'a',
      description: 'desc a',
      version: '1.0.0'
    });
    await makeSkill('kingdee-cosmic-v9/b', {
      name: 'b',
      description: 'desc b',
      version: '0.2.0'
    });

    const skills = await scanSkills(root);

    expect(skills.map((s) => s.id).sort()).toEqual(['common/a', 'kingdee-cosmic-v9/b']);
    const a = skills.find((s) => s.id === 'common/a')!;
    expect(a.name).toBe('a');
    expect(a.description).toBe('desc a');
    expect(a.version).toBe('1.0.0');
    expect(a.path.endsWith(path.join('skills', 'common', 'a'))).toBe(true);
  });

  it('skips dirs without SKILL.md', async () => {
    await fs.mkdir(path.join(root, 'skills', 'common', 'empty'), { recursive: true });
    expect(await scanSkills(root)).toEqual([]);
  });

  it('skips skills with invalid frontmatter rather than throwing', async () => {
    await makeSkill('common/bad', { name: 'x' }); // missing description/version
    await makeSkill('common/good', {
      name: 'good',
      description: 'ok',
      version: '1.0.0'
    });

    const skills = await scanSkills(root);

    expect(skills.map((s) => s.id)).toEqual(['common/good']);
  });

  it('ignores files at the namespace level', async () => {
    await fs.mkdir(path.join(root, 'skills'), { recursive: true });
    await fs.writeFile(path.join(root, 'skills', 'README.md'), '# stray', 'utf8');
    expect(await scanSkills(root)).toEqual([]);
  });
});

describe('loadSkillBody', () => {
  it('returns body text and preserves the meta', async () => {
    await makeSkill(
      'common/withbody',
      { name: 'withbody', description: 'd', version: '1.0.0' },
      '# Heading\nbody line\n'
    );
    const [meta] = await scanSkills(root);

    const loaded = await loadSkillBody(meta);

    expect(loaded.id).toBe('common/withbody');
    expect(loaded.body).toContain('Heading');
    expect(loaded.body).toContain('body line');
  });
});
