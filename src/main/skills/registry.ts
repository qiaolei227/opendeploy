import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkill } from './parser';
import type {
  LoadedSkill,
  SkillMeta,
  SkillResource,
  SkillResourceKind
} from '@shared/skill-types';

/**
 * Discover every valid skill under `<root>/skills/<namespace>/<skill-name>/SKILL.md`.
 *
 * Each skill may also carry supporting files under `prompts/*.md` and
 * `references/*.md` — both one level deep, no recursion — which are indexed
 * here so the agent's skills catalog can advertise them. Content is loaded
 * lazily via `readSkillResource`, NOT at scan time.
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
        const resources = await scanResources(dir);
        out.push({ ...fm, id: `${ns}/${name}`, path: dir, resources });
      } catch {
        // Invalid frontmatter — skip for MVP; TODO wire up diagnostics channel.
      }
    }
  }

  return out;
}

/** List `.md` files under prompts/ and references/ (one level deep only). */
async function scanResources(skillDir: string): Promise<SkillResource[]> {
  const out: SkillResource[] = [];
  for (const kind of ['prompts', 'references'] as const) {
    const sub = path.join(skillDir, kind);
    const stat = await fs.stat(sub).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const files = await fs.readdir(sub);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      out.push({ kind, name: f.slice(0, -'.md'.length) });
    }
  }
  // Stable order: prompts before references, each alphabetical. Keeps
  // catalog rendering deterministic across scans.
  out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
  return out;
}

/** Re-read a discovered skill from disk and return it with its body attached. */
export async function loadSkillBody(meta: SkillMeta): Promise<LoadedSkill> {
  const src = await fs.readFile(path.join(meta.path, 'SKILL.md'), 'utf8');
  const parsed = parseSkill(src);
  return { ...meta, body: parsed.body };
}

/**
 * Read the body of a supporting file under `<skill-dir>/<kind>/<name>.md`.
 * Validates the path stays inside the skill directory — defense in depth
 * against an LLM (or malicious skill author) trying to escape via `..`.
 */
export async function readSkillResource(
  meta: SkillMeta,
  kind: SkillResourceKind,
  name: string
): Promise<string> {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) {
    throw new Error(
      `invalid resource name "${name}" — only letters, digits, dashes, underscores, dots allowed`
    );
  }
  const target = path.join(meta.path, kind, `${name}.md`);
  const resolved = path.resolve(target);
  const skillRoot = path.resolve(meta.path);
  if (!resolved.startsWith(skillRoot + path.sep)) {
    throw new Error(`resource path escaped the skill directory: ${resolved}`);
  }
  const exists = meta.resources.some((r) => r.kind === kind && r.name === name);
  if (!exists) {
    throw new Error(
      `skill "${meta.id}" has no ${kind}/${name}.md; available: ${
        meta.resources.map((r) => `${r.kind}/${r.name}`).join(', ') || '(none)'
      }`
    );
  }
  return fs.readFile(resolved, 'utf8');
}
