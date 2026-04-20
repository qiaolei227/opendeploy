import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildSkillsContext } from '../../src/main/agent/skills-integration';

let root: string;

async function makeSkill(id: string, description: string, body: string): Promise<void> {
  const dir = path.join(root, 'skills', ...id.split('/'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${id.split('/').pop()}\ndescription: ${JSON.stringify(description)}\nversion: 1.0.0\n---\n${body}\n`,
    'utf8'
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-agent-skills-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('buildSkillsContext', () => {
  it('returns empty fragment and a no-op-surfacing tool when no skills exist', async () => {
    const ctx = await buildSkillsContext({ root });
    expect(ctx.systemPromptFragment).toBe('');
    expect(ctx.loadSkillTool.definition.name).toBe('load_skill');
  });

  it('builds a catalog listing id + description for each skill', async () => {
    await makeSkill('common/a', 'Use when the user asks about A.', 'A body');
    await makeSkill('common/b', 'Use when the user asks about B.', 'B body');

    const ctx = await buildSkillsContext({ root });

    expect(ctx.systemPromptFragment).toContain('common/a');
    expect(ctx.systemPromptFragment).toContain('Use when the user asks about A.');
    expect(ctx.systemPromptFragment).toContain('common/b');
    expect(ctx.systemPromptFragment).toContain('load_skill');
  });

  it('load_skill tool returns the body when given a known id', async () => {
    await makeSkill('common/a', 'desc', 'the A body line');

    const { loadSkillTool } = await buildSkillsContext({ root });
    const out = await loadSkillTool.execute({ id: 'common/a' });

    expect(out).toContain('the A body line');
  });

  it('load_skill tool throws a descriptive error for an unknown id', async () => {
    await makeSkill('common/a', 'desc', 'body');

    const { loadSkillTool } = await buildSkillsContext({ root });

    await expect(loadSkillTool.execute({ id: 'common/ghost' })).rejects.toThrow(/unknown skill/i);
  });

  it('load_skill tool validates the id argument is a string', async () => {
    const { loadSkillTool } = await buildSkillsContext({ root });

    await expect(loadSkillTool.execute({})).rejects.toThrow(/id/i);
    await expect(loadSkillTool.execute({ id: 123 } as never)).rejects.toThrow(/id/i);
  });
});
