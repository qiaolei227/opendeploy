import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkill } from './parser';
import type { LoadedSkill, SkillMeta } from '@shared/skill-types';

/**
 * Discover every valid skill under `<root>/skills/<namespace>/<skill-name>/SKILL.md`.
 *
 * - Missing root, missing `skills/` dir, or empty tree → returns `[]`.
 * - Skills whose frontmatter fails validation are silently skipped; the
 *   Skills UI can surface diagnostics separately once we have a reporting
 *   channel — for MVP we'd rather under-report than crash the whole list.
 */
export async function scanSkills(root: string): Promise<SkillMeta[]> {
  const skillsRoot = path.join(root, 'skills');

  let namespaces: string[];
  try {
    namespaces = await fs.readdir(skillsRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const out: SkillMeta[] = [];

  for (const ns of namespaces) {
    const nsDir = path.join(skillsRoot, ns);
    const nsStat = await fs.stat(nsDir).catch(() => null);
    if (!nsStat?.isDirectory()) continue;

    const entries = await fs.readdir(nsDir);
    for (const name of entries) {
      const dir = path.join(nsDir, name);
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const file = path.join(dir, 'SKILL.md');
      const src = await fs.readFile(file, 'utf8').catch(() => null);
      if (src == null) continue;

      try {
        const parsed = parseSkill(src);
        const { body: _body, ...fm } = parsed;
        out.push({ ...fm, id: `${ns}/${name}`, path: dir });
      } catch {
        // Invalid frontmatter — skip for MVP; TODO wire up diagnostics channel.
      }
    }
  }

  return out;
}

/** Re-read a discovered skill from disk and return it with its body attached. */
export async function loadSkillBody(meta: SkillMeta): Promise<LoadedSkill> {
  const src = await fs.readFile(path.join(meta.path, 'SKILL.md'), 'utf8');
  const parsed = parseSkill(src);
  return { ...meta, body: parsed.body };
}
