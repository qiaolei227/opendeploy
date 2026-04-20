import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeDir } from './paths';
import { installFromSource } from './manager';

/**
 * Locate the bundled seed knowledge dir.
 *
 * - Packaged (electron-builder): lives at `process.resourcesPath/knowledge`
 *   (wired up via `extraResources` in Plan 6 when installer config lands).
 * - Dev / vite: walk up from the compiled main entrypoint until we find the
 *   project root that contains `knowledge/`.
 */
async function findSeedDir(): Promise<string | null> {
  if (app.isPackaged) {
    const candidate = path.join(process.resourcesPath, 'knowledge');
    return (await exists(candidate)) ? candidate : null;
  }

  // electron-vite outputs main to `out/main/index.js`; walk up to project root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(cur, 'knowledge');
    if (await exists(path.join(candidate, 'manifest.json'))) return candidate;
    cur = path.dirname(cur);
  }
  return null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed the user's knowledge cache from the bundled skills **only on first
 * launch** (i.e. when the cache is empty). Subsequent updates go through the
 * manager + a configured remote source.
 *
 * Errors are logged and swallowed — the app should still start if seeding
 * fails (e.g. running from a dev tree without a knowledge/ dir).
 */
export async function seedKnowledgeIfEmpty(): Promise<void> {
  const target = knowledgeDir();
  if (await exists(path.join(target, 'manifest.json'))) {
    return; // already initialized
  }

  const seedDir = await findSeedDir();
  if (!seedDir) {
    console.warn('[skills] no bundled seed knowledge dir found; skipping first-launch seed');
    return;
  }

  try {
    await installFromSource({ id: 'bundled-seed', kind: 'local', location: seedDir });
    console.log(`[skills] seeded knowledge from ${seedDir}`);
  } catch (err) {
    console.error('[skills] first-launch seed failed:', err);
  }
}
