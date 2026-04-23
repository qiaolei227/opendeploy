import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listPlans, readPlan, writePlan, validatePlanFilename } from '../../src/main/plans/store';

let tmpHome: string;
let projectId: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-plans-'));
  process.env.OPENDEPLOY_HOME = tmpHome;
  projectId = 'test-project';
});

afterEach(async () => {
  delete process.env.OPENDEPLOY_HOME;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('validatePlanFilename', () => {
  it('accepts typical plan filenames with Chinese subject', () => {
    expect(validatePlanFilename('2026-04-25-信用管控升级.md')).toEqual({ ok: true });
    expect(validatePlanFilename('credit-guard.md')).toEqual({ ok: true });
  });

  it('rejects missing extension', () => {
    expect(validatePlanFilename('no-ext')).toEqual({
      ok: false,
      reason: expect.stringContaining('.md')
    });
  });

  it('rejects path separators and traversal', () => {
    expect(validatePlanFilename('a/b.md').ok).toBe(false);
    expect(validatePlanFilename('a\\b.md').ok).toBe(false);
    expect(validatePlanFilename('../foo.md').ok).toBe(false);
  });

  it('rejects empty / whitespace / control chars', () => {
    expect(validatePlanFilename('').ok).toBe(false);
    expect(validatePlanFilename('   ').ok).toBe(false);
    expect(validatePlanFilename('a\x00b.md').ok).toBe(false);
  });
});

describe('plan store', () => {
  it('listPlans returns [] when plans dir missing', async () => {
    expect(await listPlans(projectId)).toEqual([]);
  });

  it('writePlan reports created=true first time, false on overwrite', async () => {
    const r1 = await writePlan(projectId, 'test.md', '# v1\n- [ ] step\n');
    expect(r1.created).toBe(true);
    expect(r1.lines).toBe(3);

    const r2 = await writePlan(projectId, 'test.md', '# v1\n- [x] step\n');
    expect(r2.created).toBe(false);
  });

  it('readPlan round-trips content exactly', async () => {
    const md = '# plan\n\n## 步骤\n\n- [ ] step 1\n- [x] step 2\n';
    await writePlan(projectId, 'rt.md', md);
    expect(await readPlan(projectId, 'rt.md')).toBe(md);
  });

  it('listPlans sorts by mtime descending (newest first)', async () => {
    await writePlan(projectId, 'old.md', '#a');
    // tiny delay so mtimes differ
    await new Promise((r) => setTimeout(r, 10));
    await writePlan(projectId, 'new.md', '#b');

    const plans = await listPlans(projectId);
    expect(plans.map((p) => p.name)).toEqual(['new.md', 'old.md']);
  });

  it('writePlan rejects invalid filenames before touching disk', async () => {
    await expect(writePlan(projectId, '../evil.md', 'x')).rejects.toThrow(/filename/);
  });

  it('readPlan throws for missing file', async () => {
    await expect(readPlan(projectId, 'nope.md')).rejects.toThrow();
  });

  it('checkbox sync pattern: read → mutate → write overwrites', async () => {
    const initial = '# plan\n\n- [ ] step 1\n- [ ] step 2\n';
    await writePlan(projectId, 'sync.md', initial);

    const body = await readPlan(projectId, 'sync.md');
    const flipped = body.replace('- [ ] step 1', '- [x] step 1');
    const r = await writePlan(projectId, 'sync.md', flipped);

    expect(r.created).toBe(false);
    const verify = await readPlan(projectId, 'sync.md');
    expect(verify).toContain('- [x] step 1');
    expect(verify).toContain('- [ ] step 2');
  });
});
