import { knowledgeDir } from '../skills/paths';
import { loadSkillBody, readSkillResource, scanSkills } from '../skills/registry';
import type { ToolHandler } from './tools';
import type { SkillMeta, SkillResourceKind } from '@shared/skill-types';
import catalogIntroRaw from './prompts/skills-catalog-intro.md?raw';

export interface SkillsContext {
  /**
   * Human-readable catalog of installed skills. Empty string when no skills
   * are installed — append it into the system prompt only when non-empty.
   */
  systemPromptFragment: string;
  /**
   * Agent tools bound to this scan: `load_skill` (reads SKILL.md body) and
   * `load_skill_file` (reads a specific `prompts/*.md` or `references/*.md`).
   * Always returned so the ToolRegistry has a stable shape.
   */
  loadSkillTool: ToolHandler;
  loadSkillFileTool: ToolHandler;
}

export interface BuildOptions {
  /** Override the knowledge-cache root. Defaults to `paths.knowledgeDir()`. */
  root?: string;
  /**
   * ERP of the currently active project (e.g. `'k3cloud'`), used to filter
   * which namespace buckets the agent sees. `undefined` means no project is
   * active — only `common/*` skills are exposed.
   *
   * The top-level skill namespace is authoritative:
   * - `system/*` — internal (diagnostics, bootstrap). Never in the catalog,
   *   but still loadable by name so other skills can reference them.
   * - `common/*` — ERP-agnostic, always visible.
   * - `<erp>/*` — visible only when `activeErpProvider` matches exactly.
   */
  activeErpProvider?: string;
}

/** Namespace-based visibility in the agent-facing catalog. */
function isCatalogVisible(skillId: string, activeErpProvider: string | undefined): boolean {
  const ns = skillId.split('/', 1)[0];
  if (ns === 'system') return false;
  if (ns === 'common') return true;
  return ns === activeErpProvider;
}

/**
 * Snapshot the local skills registry once per agent request and return both
 * the system-prompt description catalog and the skill-loading tools bound
 * to that same snapshot.
 *
 * Snapshotting keeps the agent's view consistent for the duration of a single
 * run even if the filesystem changes mid-run (user installing a skill while a
 * streaming response is in flight).
 */
export async function buildSkillsContext(opts: BuildOptions = {}): Promise<SkillsContext> {
  const root = opts.root ?? knowledgeDir();
  const all = await scanSkills(root);

  // Catalog shows only visible skills. The loader tools accept visible
  // skills plus anything in `system/*` — those are addressable by name so
  // e.g. a future k3cloud skill can tell the agent to load system diagnostics
  // without having to appear in the top-level catalog.
  const visible = all.filter((s) => isCatalogVisible(s.id, opts.activeErpProvider));
  const loadable = all.filter((s) => {
    const ns = s.id.split('/', 1)[0];
    return ns === 'system' || isCatalogVisible(s.id, opts.activeErpProvider);
  });
  const byId = new Map(loadable.map((s) => [s.id, s]));

  return {
    systemPromptFragment: renderCatalog(visible),
    loadSkillTool: makeLoadSkillTool(byId),
    loadSkillFileTool: makeLoadSkillFileTool(byId)
  };
}

/**
 * Catalog intro text — the fixed "You have access to the following skills…"
 * paragraph — lives in `prompts/skills-catalog-intro.md` so product /
 * consulting leads can edit it without TypeScript. Per-skill bullet lines
 * stay here because they're data-driven.
 */
const CATALOG_INTRO = catalogIntroRaw.trim();

function renderCatalog(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';
  const lines: string[] = [CATALOG_INTRO, ''];
  for (const s of skills) {
    const label = s.title ? `${s.title} · \`${s.id}\`` : `\`${s.id}\``;
    lines.push(`- ${label}: ${s.description}`);
    if (s.resources.length > 0) {
      const pathList = s.resources.map((r) => `\`${r.kind}/${r.name}\``).join(', ');
      lines.push(`  files: ${pathList}`);
    }
  }
  return lines.join('\n');
}

function makeLoadSkillTool(byId: Map<string, SkillMeta>): ToolHandler {
  return {
    definition: {
      name: 'load_skill',
      description:
        'Load the full instruction body of a skill by its id (format: "<namespace>/<name>"). Call this when a skill from the system-prompt catalog matches the task, then follow the returned instructions verbatim. For skill supporting files (prompts/ or references/), use `load_skill_file` instead.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The skill id, e.g. "k3cloud/solution-decision-framework".'
          }
        },
        required: ['id']
      }
    },
    async execute(args): Promise<string> {
      const id = args.id;
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('load_skill requires a non-empty string `id` argument');
      }
      const meta = byId.get(id);
      if (!meta) {
        const known = [...byId.keys()].sort().join(', ') || '(none installed)';
        throw new Error(`unknown skill: "${id}". Known ids: ${known}`);
      }
      const loaded = await loadSkillBody(meta);
      return loaded.body;
    }
  };
}

function makeLoadSkillFileTool(byId: Map<string, SkillMeta>): ToolHandler {
  return {
    definition: {
      name: 'load_skill_file',
      description:
        'Load a supporting file from a skill — either a prompts/*.md (procedural guidance) or references/*.md (lookup material). Use the `files:` list from the skill catalog to know what\'s available. Each call costs tokens; only fetch the file you actually need, not the whole skill.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The skill id, e.g. "k3cloud/python-plugin-index".'
          },
          path: {
            type: 'string',
            description:
              'Resource path inside the skill, either "prompts/<name>" or "references/<name>" — without the .md suffix, e.g. "references/events-reference".'
          }
        },
        required: ['id', 'path']
      }
    },
    async execute(args): Promise<string> {
      const id = args.id;
      const p = args.path;
      if (typeof id !== 'string' || typeof p !== 'string') {
        throw new Error('load_skill_file requires string `id` and `path` arguments');
      }
      const meta = byId.get(id);
      if (!meta) {
        const known = [...byId.keys()].sort().join(', ') || '(none installed)';
        throw new Error(`unknown skill: "${id}". Known ids: ${known}`);
      }
      const slash = p.indexOf('/');
      if (slash < 0) {
        throw new Error(
          `invalid path "${p}" — must be "prompts/<name>" or "references/<name>"`
        );
      }
      const kind = p.slice(0, slash);
      const name = p.slice(slash + 1);
      if (kind !== 'prompts' && kind !== 'references') {
        throw new Error(
          `invalid path kind "${kind}" — must be "prompts" or "references"`
        );
      }
      return readSkillResource(meta, kind as SkillResourceKind, name);
    }
  };
}
