import { getConnectionState } from '../erp/active';
import { listPlans, readPlan, writePlan } from '../plans/store';
import type { ToolHandler } from './tools';

/**
 * Agent tool trio for implementation-plan markdown files, scoped per project.
 * Mirror of plugin-tools.ts — same shape, different directory. Only
 * registered when a K/3 Cloud project is active; plan writes without a
 * target project have nowhere sensible to go.
 *
 * Usage pattern (`common/implementation-planning` skill enforces this):
 *   1. Draft a plan → `write_plan("2026-04-25-credit-guard.md", <markdown>)`
 *     — the checklist ships with `[ ]` boxes
 *   2. After each step the agent owns completes → `read_plan` + edit →
 *     `write_plan` (same filename) with the box flipped to `[x]`.
 *     The consultant reopens the app later to see where things stand.
 */
export function buildPlanTools(): ToolHandler[] {
  if (!getConnectionState().projectId) return [];
  return [writePlanTool(), listPlansTool(), readPlanTool()];
}

function requireActiveProject(): string {
  const id = getConnectionState().projectId;
  if (!id) throw new Error('no active project — set one on the Projects page first');
  return id;
}

function writePlanTool(): ToolHandler {
  return {
    definition: {
      name: 'write_plan',
      description:
        '把一份实施 plan markdown 写到当前项目的 plans 目录。同名会覆盖——这是**刻意**的:每完成一步把对应 checkbox 从 `[ ]` 改成 `[x]` 后再 write_plan 回去,plan md 即交付档案。filename 必须以 .md 结尾,不含路径分隔符,常用 `YYYY-MM-DD-<短主题>.md`(见 `common/implementation-planning` skill 模板)。',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Plan 文件名,以 .md 结尾。允许中文,不允许 / \\ .. 控制字符。'
          },
          content: {
            type: 'string',
            description: '完整 plan md 内容(frontmatter + 模板),UTF-8。'
          }
        },
        required: ['filename', 'content']
      }
    },
    async execute(args) {
      const projectId = requireActiveProject();
      const filename = args.filename;
      const content = args.content;
      if (typeof filename !== 'string') throw new Error('filename must be a string');
      if (typeof content !== 'string') throw new Error('content must be a string');
      const r = await writePlan(projectId, filename, content);
      return JSON.stringify(
        {
          created: r.created,
          path: r.file.path,
          filename: r.file.name,
          lines: r.lines,
          size: r.file.size,
          projectId: r.projectId
        },
        null,
        2
      );
    }
  };
}

function listPlansTool(): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'list_plans',
      description:
        '列出当前项目 plans 目录下已有的 plan md。顾问跨天回来时用这个找"上次做到哪"。',
      parameters: { type: 'object', properties: {} }
    },
    async execute() {
      const projectId = requireActiveProject();
      const files = await listPlans(projectId);
      return JSON.stringify({ projectId, count: files.length, files }, null, 2);
    }
  };
}

function readPlanTool(): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'read_plan',
      description:
        '读取已有 plan 的完整 md 内容。更新 checkbox 前必读(先 read 再 edit 再 write)。filename 来自 list_plans 的结果。',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Plan 文件名(来自 list_plans)。'
          }
        },
        required: ['filename']
      }
    },
    async execute(args) {
      const projectId = requireActiveProject();
      const filename = args.filename;
      if (typeof filename !== 'string' || !filename.trim()) {
        throw new Error('filename must be a non-empty string');
      }
      const content = await readPlan(projectId, filename);
      return JSON.stringify({ projectId, filename, content }, null, 2);
    }
  };
}
