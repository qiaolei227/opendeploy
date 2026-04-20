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
 *   content, reports whether it was a create or an overwrite
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

  const candidates = entries.filter((n) => n.endsWith('.py'));
  const stats = await Promise.all(
    candidates.map((name) => {
      const abs = path.join(dir, name);
      return fs.stat(abs).then(
        (stat) => ({ name, abs, stat }),
        () => null
      );
    })
  );

  const out: PluginFile[] = [];
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

  // Pre-stat only to distinguish create vs overwrite. The post-write mtime
  // and size are deterministic from the write we just did — no second stat.
  const existed = (await fs.stat(abs).catch(() => null)) != null;
  await fs.writeFile(abs, content, 'utf8');

  return {
    projectId,
    file: {
      name,
      path: abs,
      modifiedAt: new Date().toISOString(),
      size: Buffer.byteLength(content, 'utf8')
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
