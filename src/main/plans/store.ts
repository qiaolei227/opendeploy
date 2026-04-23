import fs from 'node:fs/promises';
import path from 'node:path';
import { projectPlansDir } from '../plugins/paths';

/**
 * On-disk store for implementation plan markdown files, scoped per project.
 *
 * Plans are human-readable deliverable docs (the consultant keeps them across
 * sessions, may even hand them to the client), not throwaway agent state.
 * That's why they live in the same `~/.opendeploy/projects/<id>/` tree as
 * plugins and bos-backups — all user-visible artifacts stay together.
 *
 * API mirrors plugins/store.ts intentionally. Overwriting an existing plan
 * (same filename) is the expected path for checkbox sync after each step —
 * so `writePlan` reports `created: true|false` so the agent can surface the
 * right language to the user ("plan 已更新" vs "新 plan 已创建").
 */

export interface PlanFile {
  name: string;
  path: string;
  modifiedAt: string;
  size: number;
}

export interface PlanWriteResult {
  created: boolean;
  file: PlanFile;
  lines: number;
  projectId: string;
}

/**
 * Accept Chinese plan filenames (human-readable topics), but forbid any path
 * separator, `..` traversal, NUL / control chars, and require a `.md`
 * extension so non-plan files can't be targeted.
 */
export function validatePlanFilename(name: string): { ok: true } | { ok: false; reason: string } {
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, reason: 'filename is empty' };
  }
  if (!name.endsWith('.md')) return { ok: false, reason: 'filename must end with .md' };
  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, reason: 'filename may not contain path separators' };
  }
  if (name.includes('..')) return { ok: false, reason: 'filename may not contain ".."' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) {
    return { ok: false, reason: 'filename may not contain control characters' };
  }
  if (name.length > 120) return { ok: false, reason: 'filename too long (>120 chars)' };
  return { ok: true };
}

export async function listPlans(projectId: string): Promise<PlanFile[]> {
  const dir = projectPlansDir(projectId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const candidates = entries.filter((n) => n.endsWith('.md'));
  const stats = await Promise.all(
    candidates.map((name) => {
      const abs = path.join(dir, name);
      return fs.stat(abs).then(
        (stat) => ({ name, abs, stat }),
        () => null
      );
    })
  );

  const out: PlanFile[] = [];
  for (const row of stats) {
    if (!row?.stat.isFile()) continue;
    out.push({
      name: row.name,
      path: row.abs,
      modifiedAt: row.stat.mtime.toISOString(),
      size: row.stat.size
    });
  }
  out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  return out;
}

export async function readPlan(projectId: string, name: string): Promise<string> {
  const v = validatePlanFilename(name);
  if (!v.ok) throw new Error(`invalid plan filename: ${v.reason}`);
  const abs = path.join(projectPlansDir(projectId), name);
  return fs.readFile(abs, 'utf8');
}

export async function writePlan(
  projectId: string,
  name: string,
  content: string
): Promise<PlanWriteResult> {
  const v = validatePlanFilename(name);
  if (!v.ok) throw new Error(`invalid plan filename: ${v.reason}`);
  if (typeof content !== 'string') throw new Error('plan content must be a string');

  const dir = projectPlansDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, name);
  let created = true;
  try {
    await fs.access(abs);
    created = false;
  } catch {
    /* doesn't exist yet — stays created=true */
  }
  await fs.writeFile(abs, content, 'utf8');
  const stat = await fs.stat(abs);
  return {
    created,
    file: {
      name,
      path: abs,
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size
    },
    lines: content.split('\n').length,
    projectId
  };
}
