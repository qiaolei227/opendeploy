import fs from 'node:fs/promises';
import path from 'node:path';
import { projectPluginsDir } from './paths';
import { validatePluginFilename } from './validator';
import type { PluginFile, PluginWriteResult } from '@shared/plugin-types';

/**
 * On-disk store for agent-produced Python plugin files, scoped per project.
 *
 * - `listPlugins` / `readPlugin`: plain FS reads, return [] / throw ENOENT
 * - `writePlugin`: validates filename, mkdir -p the plugins dir, writes the
 *   content, reports whether it was a create or an overwrite via mtime/stat
 * - `deletePlugin`: unlink with force:true (missing-file = no-op)
 */

export async function listPlugins(projectId: string): Promise<PluginFile[]> {
  const dir = projectPluginsDir(projectId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const out: PluginFile[] = [];
  for (const name of entries) {
    if (!name.endsWith('.py')) continue;
    const abs = path.join(dir, name);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isFile()) continue;
    out.push({
      name,
      path: abs,
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size
    });
  }
  out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  return out;
}

export async function readPlugin(projectId: string, name: string): Promise<string> {
  const v = validatePluginFilename(name);
  if (!v.ok) throw new Error(`invalid plugin filename: ${v.reason}`);
  const abs = path.join(projectPluginsDir(projectId), name);
  return fs.readFile(abs, 'utf8');
}

export async function writePlugin(
  projectId: string,
  name: string,
  content: string
): Promise<PluginWriteResult> {
  const v = validatePluginFilename(name);
  if (!v.ok) throw new Error(`invalid plugin filename: ${v.reason}`);

  const dir = projectPluginsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, name);

  // Stat before write to determine create vs overwrite.
  const existed = (await fs.stat(abs).catch(() => null)) != null;
  await fs.writeFile(abs, content, 'utf8');
  const stat = await fs.stat(abs);

  return {
    projectId,
    file: {
      name,
      path: abs,
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size
    },
    lines: content.split(/\r?\n/).length,
    created: !existed
  };
}

export async function deletePlugin(projectId: string, name: string): Promise<void> {
  const v = validatePluginFilename(name);
  if (!v.ok) throw new Error(`invalid plugin filename: ${v.reason}`);
  const abs = path.join(projectPluginsDir(projectId), name);
  await fs.rm(abs, { force: true });
}
