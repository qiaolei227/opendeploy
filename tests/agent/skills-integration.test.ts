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

describe('buildSkillsContext · namespace filtering', () => {
  // Visibility model:
  //   system/*  → hidden from catalog, loadable by name
  //   common/*  → always visible
  //   <erp>/*   → visible only when activeErpProvider === '<erp>'
  it('hides system/* from the catalog but keeps it loadable by name', async () => {
    await makeSkill('system/diag', 'diagnostic only', 'diag body');
    await makeSkill('common/a', 'user-visible A', 'A body');

    const ctx = await buildSkillsContext({ root });

    expect(ctx.systemPromptFragment).toContain('common/a');
    expect(ctx.systemPromptFragment).not.toContain('system/diag');

    // Still addressable by name — this is the whole point of system/*.
    const out = await ctx.loadSkillTool.execute({ id: 'system/diag' });
    expect(out).toContain('diag body');
  });

  it('includes common/* regardless of active ERP', async () => {
    await makeSkill('common/shared', 'ERP-agnostic helper', 'x');

    const noErp = await buildSkillsContext({ root });
    const k3 = await buildSkillsContext({ root, activeErpProvider: 'k3cloud' });

    expect(noErp.systemPromptFragment).toContain('common/shared');
    expect(k3.systemPromptFragment).toContain('common/shared');
  });

  it('shows <erp>/* only when activeErpProvider matches', async () => {
    await makeSkill('common/shared', 'shared', 'x');
    await makeSkill('k3cloud/sal', 'k3 sales', 'x');
    await makeSkill('sap/fi', 'sap fi', 'x');

    const noErp = await buildSkillsContext({ root });
    expect(noErp.systemPromptFragment).toContain('common/shared');
    expect(noErp.systemPromptFragment).not.toContain('k3cloud/sal');
    expect(noErp.systemPromptFragment).not.toContain('sap/fi');

    const k3 = await buildSkillsContext({ root, activeErpProvider: 'k3cloud' });
    expect(k3.systemPromptFragment).toContain('k3cloud/sal');
    expect(k3.systemPromptFragment).toContain('common/shared');
    expect(k3.systemPromptFragment).not.toContain('sap/fi');

    const sap = await buildSkillsContext({ root, activeErpProvider: 'sap' });
    expect(sap.systemPromptFragment).toContain('sap/fi');
    expect(sap.systemPromptFragment).not.toContain('k3cloud/sal');
  });

  it('does not expose out-of-scope ERP skills via load_skill either', async () => {
    await makeSkill('k3cloud/sal', 'k3 sales', 'x');
    await makeSkill('sap/fi', 'sap fi', 'x');

    const k3 = await buildSkillsContext({ root, activeErpProvider: 'k3cloud' });
    await expect(k3.loadSkillTool.execute({ id: 'sap/fi' })).rejects.toThrow(/unknown skill/i);
  });

  it('returns an empty catalog when no skills match the filter', async () => {
    await makeSkill('sap/fi', 'sap only', 'x');
    await makeSkill('system/diag', 'hidden', 'x');

    const ctx = await buildSkillsContext({ root, activeErpProvider: 'k3cloud' });
    expect(ctx.systemPromptFragment).toBe('');
  });
});
