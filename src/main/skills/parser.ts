import yaml from 'js-yaml';
import type { SkillCategory, SkillFrontmatter } from '@shared/skill-types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

const VALID_CATEGORIES: readonly SkillCategory[] = [
  'workflow',
  'plugin-dev',
  'product-features',
  'bos-features',
  'sales',
  'purchase',
  'inventory',
  'finance',
  'basedata',
  'metadata',
  'debugging'
];

export interface ParsedSkill extends SkillFrontmatter {
  body: string;
}

/**
 * Parse the full text of a `SKILL.md` file.
 *
 * Throws a descriptive `Error` on any validation failure. Errors thrown here
 * surface to the user in the Skills UI (and to the agent as tool errors), so
 * messages are written to be actionable — name the offending field.
 */
export function parseSkill(src: string): ParsedSkill {
  const m = FRONTMATTER_RE.exec(src);
  if (!m) throw new Error('SKILL.md must start with a YAML frontmatter block fenced by `---`');

  let fm: unknown;
  try {
    fm = yaml.load(m[1]);
  } catch (err) {
    throw new Error(`Invalid YAML frontmatter: ${(err as Error).message}`);
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }
  const obj = fm as Record<string, unknown>;

  const name = requireString(obj, 'name');
  const description = requireString(obj, 'description');
  const version = requireString(obj, 'version');
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Invalid semver version: "${version}" (expected e.g. "1.0.0")`);
  }

  const title = obj.title === undefined ? undefined : requireString(obj, 'title');
  const erpProvider =
    obj.erpProvider === undefined ? undefined : requireString(obj, 'erpProvider');
  const category =
    obj.category === undefined ? undefined : asCategory(obj.category);

  return { name, title, description, version, category, erpProvider, body: m[2] };
}

function asCategory(v: unknown): SkillCategory {
  if (typeof v !== 'string' || !VALID_CATEGORIES.includes(v as SkillCategory)) {
    throw new Error(
      `Invalid category: "${String(v)}" (expected one of ${VALID_CATEGORIES.join(', ')})`
    );
  }
  return v as SkillCategory;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Missing or empty frontmatter field: ${key}`);
  }
  return v;
}

