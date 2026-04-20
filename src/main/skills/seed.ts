import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeDir } from './paths';
import { installFromSource } from './manager';
import { readManifest } from './manifest';
import type { KnowledgeManifest } from '@shared/skill-types';

/**
 * Name of the marker file the seeder drops next to `manifest.json` when a
 * cache was written from the bundled seed. Its presence means "this cache is
 * still the one the installer/dev laid down — safe to refresh from bundle".
 * Its absence means "the user pulled updates via git or modified files by
 * hand — leave them alone".
 *
 * Because adoptBundle in the manager `rm -rf`s the whole cache before copying
 * in new content, a git-pulled refresh naturally wipes the marker, so the
 * presence check alone disambiguates bundle-seeded vs externally-updated.
 */
const BUNDLE_MARKER = '.bundled-seed';

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

async function adoptFromBundle(seedDir: string): Promise<void> {
  await installFromSource({ id: 'bundled-seed', kind: 'local', location: seedDir });
  // installFromSource's adoptBundle rm -rf's the target and cp's the bundle in,
  // so the marker must be written AFTER the copy completes.
  await fs.writeFile(
    path.join(knowledgeDir(), BUNDLE_MARKER),
    JSON.stringify({ seededAt: new Date().toISOString() }) + '\n',
    'utf8'
  );
}

/** Strict equality on the (id, version, sha256) triple set. */
function manifestsDiffer(a: KnowledgeManifest, b: KnowledgeManifest): boolean {
  if (a.version !== b.version) return true;
  if (a.skills.length !== b.skills.length) return true;
  const aMap = new Map(a.skills.map((s) => [s.id, `${s.version}|${s.sha256}`]));
  for (const skill of b.skills) {
    if (aMap.get(skill.id) !== `${skill.version}|${skill.sha256}`) return true;
  }
  return false;
}

/**
 * Seed the user's knowledge cache from the bundled skills, or refresh it if
 * the bundle has changed since last seed.
 *
 * Decision table:
 *
 *   no local manifest               → seed (first launch)
 *   local exists, no marker         → skip (user installed via git / hand-edit)
 *   local exists, marker, same      → skip (already in sync)
 *   local exists, marker, differs   → refresh (installer upgrade or dev edit)
 *
 * Errors log and swallow — the app should still start if seeding fails.
 */
export async function seedOrRefreshKnowledge(): Promise<void> {
  const target = knowledgeDir();
  const seedDir = await findSeedDir();
  if (!seedDir) {
    console.warn('[skills] no bundled seed knowledge dir found; skipping');
    return;
  }

  const localManifest = await readManifest(path.join(target, 'manifest.json'));

  if (!localManifest) {
    try {
      await adoptFromBundle(seedDir);
      console.log(`[skills] seeded knowledge from ${seedDir}`);
    } catch (err) {
      console.error('[skills] first-launch seed failed:', err);
    }
    return;
  }

  const markerExists = await exists(path.join(target, BUNDLE_MARKER));
  if (!markerExists) {
    // Cache came from a non-bundle source (git pull, manual edit). Don't touch.
    return;
  }

  const bundledManifest = await readManifest(path.join(seedDir, 'manifest.json'));
  if (!bundledManifest) {
    console.warn('[skills] bundled knowledge has no manifest.json; skipping refresh');
    return;
  }
  if (!manifestsDiffer(localManifest, bundledManifest)) {
    return; // already in sync
  }

  try {
    await adoptFromBundle(seedDir);
    console.log(
      `[skills] refreshed bundled knowledge (${localManifest.version} → ${bundledManifest.version})`
    );
  } catch (err) {
    console.error('[skills] bundle refresh failed:', err);
  }
}

/**
 * @deprecated Use `seedOrRefreshKnowledge` — kept exported so callers that
 * haven't migrated yet keep compiling. Will be removed in the next breaking
 * change to the main process bootstrap.
 */
export const seedKnowledgeIfEmpty = seedOrRefreshKnowledge;
