import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSkills } from '../../src/main/skills/registry';
import { parseSkill } from '../../src/main/skills/parser';
import { readManifest } from '../../src/main/skills/manifest';
import { verifyIntegrity } from '../../src/main/skills/integrity';

/**
 * End-to-end guard for the bundled `knowledge/` dir:
 *
 *   1. Every SKILL.md must parse under the strict parser (same one the
 *      runtime uses). A single invalid skill causes scanSkills to silently
 *      skip it — the seeder then fails integrity with `actual: null`.
 *      Catching this at test time beats catching it on a user's fresh
 *      install.
 *   2. The manifest must list every SKILL.md that parses, with matching
 *      SHA-256 — keeps `pnpm knowledge:manifest` and the parser in sync.
 *
 * This test must stay at the repo-root relative path "knowledge/" so it
 * exercises the real bundle, not a synthesized fixture.
 */
describe('bundled knowledge integrity', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundleRoot = path.resolve(here, '../../knowledge');

  it('every SKILL.md parses under the strict parser', async () => {
    const skillsDir = path.join(bundleRoot, 'skills');
    const namespaces = await fs.readdir(skillsDir);
    const failures: Array<{ id: string; error: string }> = [];

    for (const ns of namespaces) {
      const nsDir = path.join(skillsDir, ns);
      const nsStat = await fs.stat(nsDir).catch(() => null);
      if (!nsStat?.isDirectory()) continue;
      const names = await fs.readdir(nsDir);
      for (const name of names) {
        const dir = path.join(nsDir, name);
        const stat = await fs.stat(dir).catch(() => null);
        if (!stat?.isDirectory()) continue;
        const file = path.join(dir, 'SKILL.md');
        const src = await fs.readFile(file, 'utf8').catch(() => null);
        if (src == null) continue;
        try {
          parseSkill(src);
        } catch (err) {
          failures.push({
            id: `${ns}/${name}`,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }

    expect(failures, `invalid SKILL.md files:\n${failures
      .map((f) => `  - ${f.id}: ${f.error}`)
      .join('\n')}`).toEqual([]);
  });

  it('manifest + scanned skills + filesystem all line up (seed-simulation)', async () => {
    const manifest = await readManifest(path.join(bundleRoot, 'manifest.json'));
    expect(manifest, 'knowledge/manifest.json missing — run pnpm knowledge:manifest').not.toBeNull();

    const skills = await scanSkills(bundleRoot);
    const report = await verifyIntegrity(bundleRoot, manifest!, skills);

    expect(
      report.mismatches,
      `integrity mismatches (will break first-launch seed):\n${JSON.stringify(
        report.mismatches,
        null,
        2
      )}`
    ).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
