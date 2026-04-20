/**
 * Rebuild `knowledge/manifest.json` from the on-disk skills tree.
 *
 * Run via `node --experimental-strip-types scripts/gen-knowledge-manifest.ts`
 * (Node 22+) or `pnpm tsx scripts/gen-knowledge-manifest.ts` if tsx is added.
 * Emits a manifest with per-skill SHA-256 of each SKILL.md.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
const BUNDLE_VERSION = process.env.BUNDLE_VERSION ?? '0.1.0';

async function main(): Promise<void> {
  const skillsRoot = path.join(ROOT, 'skills');
  const namespaces = await fs.readdir(skillsRoot);
  const entries: Array<{ id: string; version: string; sha256: string }> = [];

  for (const ns of namespaces) {
    const nsDir = path.join(skillsRoot, ns);
    if (!(await fs.stat(nsDir)).isDirectory()) continue;

    for (const name of await fs.readdir(nsDir)) {
      const skillDir = path.join(nsDir, name);
      const stat = await fs.stat(skillDir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const file = path.join(skillDir, 'SKILL.md');
      const src = await fs.readFile(file, 'utf8').catch(() => null);
      if (src == null) continue;

      const version = /^version:\s*(\S+)$/m.exec(src)?.[1]?.replace(/['"]/g, '') ?? '0.0.0';
      const sha256 = createHash('sha256').update(await fs.readFile(file)).digest('hex');
      entries.push({ id: `${ns}/${name}`, version, sha256 });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  const manifest = {
    schema: '1' as const,
    version: BUNDLE_VERSION,
    skills: entries
  };
  const out = path.join(ROOT, 'manifest.json');
  await fs.writeFile(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`wrote ${out} with ${entries.length} skill(s), bundle version ${BUNDLE_VERSION}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
