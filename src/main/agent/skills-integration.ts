import { knowledgeDir } from '../skills/paths';
import { loadSkillBody, scanSkills } from '../skills/registry';
import type { ToolHandler } from './tools';
import type { SkillMeta } from '@shared/skill-types';

export interface SkillsContext {
  /**
   * Human-readable catalog of installed skills. Empty string when no skills
   * are installed — append it into the system prompt only when non-empty.
   */
  systemPromptFragment: string;
  /**
   * The `load_skill` tool. Always returned (even with zero skills) so the
   * ToolRegistry has a stable shape and prompts can reliably reference it.
   */
  loadSkillTool: ToolHandler;
}

export interface BuildOptions {
  /** Override the knowledge-cache root. Defaults to `paths.knowledgeDir()`. */
  root?: string;
}

/**
 * Snapshot the local skills registry once per agent request and return both
 * the system-prompt description catalog and the `load_skill` tool bound to
 * that same snapshot.
 *
 * Snapshotting keeps the agent's view consistent for the duration of a single
 * run even if the filesystem changes mid-run (user installing a skill while a
 * streaming response is in flight).
 */
export async function buildSkillsContext(opts: BuildOptions = {}): Promise<SkillsContext> {
  const root = opts.root ?? knowledgeDir();
  const skills = await scanSkills(root);
  const byId = new Map(skills.map((s) => [s.id, s]));

  return {
    systemPromptFragment: renderCatalog(skills),
    loadSkillTool: makeLoadSkillTool(byId)
  };
}

function renderCatalog(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';
  const lines = [
    'You have access to the following skills. Each skill is a set of specialist instructions for a specific situation. When a skill description matches the task in front of you, call the `load_skill` tool with its id *before* responding, then follow the returned instructions.',
    '',
    ...skills.map((s) => `- \`${s.id}\`: ${s.description}`)
  ];
  return lines.join('\n');
}

function makeLoadSkillTool(byId: Map<string, SkillMeta>): ToolHandler {
  return {
    definition: {
      name: 'load_skill',
      description:
        'Load the full instruction body of a skill by its id (format: "<namespace>/<name>"). Call this when a skill from the system-prompt catalog matches the task, then follow the returned instructions verbatim.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The skill id, e.g. "common/requirements-clarification".'
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
