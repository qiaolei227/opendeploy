import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { knowledgeDir as defaultKnowledgeDir } from './paths';
import { downloadTarball, extractTarGz, type FetchFn } from './downloader';
import { adapterFor } from './remote';
import { readManifest } from './manifest';
import { scanSkills } from './registry';
import { verifyIntegrity } from './integrity';
import { DEFAULT_KNOWLEDGE_SOURCES } from './defaults';
import type { KnowledgeManifest, KnowledgeSource } from '@shared/skill-types';

/** Root + fetchFn can be overridden so the same code path works in tests and prod. */
export interface ManagerOptions {
  /** Knowledge cache root. Defaults to `paths.knowledgeDir()`. */
  root?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: FetchFn;
}

function resolveRoot(opts: ManagerOptions = {}): string {
  return opts.root ?? defaultKnowledgeDir();
}

/**
 * Install or replace the whole knowledge bundle from `source`.
 *
 * MVP strategy: **replace-all**. Per-skill diffing adds complexity (rename
 * detection, partial rollback) without winning much at the expected bundle
 * scale (<100 skills). Integrity is checked *before* the swap so a failing
 * install never corrupts an existing cache.
 */
export async function installFromSource(
  source: KnowledgeSource,
  opts: ManagerOptions = {}
): Promise<void> {
  const root = resolveRoot(opts);

  if (source.kind === 'local') {
    await adoptBundle(source.location, root);
    return;
  }

  // Scratch dir lives outside `root` on purpose: adoptBundle rm -rf's `root`,
  // which would take the in-flight download with it if we staged inside.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-install-'));
  try {
    const url = adapterFor(source).tarballUrl(source);
    const tarFile = path.join(tmp, 'bundle.tar.gz');
    await downloadTarball(url, tarFile, { fetchFn: opts.fetchFn });
    await extractTarGz(tarFile, tmp);

    const bundleRoot = await findBundleRoot(tmp);
    await adoptBundle(bundleRoot, root);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** GitHub / Gitee wrap the repo in a single top-level dir; return that if present. */
async function findBundleRoot(extractedRoot: string): Promise<string> {
  const entries = await fs.readdir(extractedRoot, { withFileTypes: true });
  const dirs = entries.filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  const hasManifestAtRoot = entries.some((d) => d.isFile() && d.name === 'manifest.json');
  if (hasManifestAtRoot) return extractedRoot;
  if (dirs.length === 1) return path.join(extractedRoot, dirs[0].name);
  throw new Error('extracted archive layout is unrecognized (no manifest.json at root or single wrapper dir)');
}

/** Validate the bundle at `bundleRoot`, then atomically replace `targetRoot`. */
async function adoptBundle(bundleRoot: string, targetRoot: string): Promise<void> {
  const manifest = await readManifest(path.join(bundleRoot, 'manifest.json'));
  if (!manifest) {
    throw new Error(`bundle is missing manifest.json (looked in ${bundleRoot})`);
  }

  const skills = await scanSkills(bundleRoot);
  const report = await verifyIntegrity(bundleRoot, manifest, skills);
  if (!report.ok) {
    throw new Error(
      `integrity check failed: ${JSON.stringify(report.mismatches)}`
    );
  }

  // Replace target atomically-ish: rm old, then cp new. Since we've already
  // verified the bundle, and verify step before this one has run, the
  // small window where target doesn't exist is acceptable for MVP.
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  await fs.cp(bundleRoot, targetRoot, { recursive: true });
}

/** Read the locally-installed bundle version, or `null` if nothing is installed. */
export async function currentVersion(opts: ManagerOptions = {}): Promise<string | null> {
  const m = await readManifest(path.join(resolveRoot(opts), 'manifest.json'));
  return m?.version ?? null;
}

/** Ask the remote for its manifest.json and compare to local. No bytes downloaded. */
export async function checkUpdates(
  source: KnowledgeSource,
  opts: ManagerOptions = {}
): Promise<{ local: string | null; remote: string }> {
  if (source.kind === 'local') {
    const m = await readManifest(path.join(source.location, 'manifest.json'));
    if (!m) throw new Error(`local bundle has no manifest.json at ${source.location}`);
    return { local: await currentVersion(opts), remote: m.version };
  }

  const url = adapterFor(source).rawUrl(source, 'manifest.json');
  const doFetch = opts.fetchFn ?? fetch;
  const res = await doFetch(url);
  if (!res.ok) {
    throw new Error(`manifest fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  const m = (await res.json()) as KnowledgeManifest;
  return { local: await currentVersion(opts), remote: m.version };
}

/** Wipe the whole local knowledge cache. No-op if the dir doesn't exist. */
export async function removeAll(opts: ManagerOptions = {}): Promise<void> {
  await fs.rm(resolveRoot(opts), { recursive: true, force: true });
}

// ─── Defaults + fallback ────────────────────────────────────────────────

export interface DefaultsOptions extends ManagerOptions {
  /** Sources to try in order. Defaults to `DEFAULT_KNOWLEDGE_SOURCES`. */
  sources?: KnowledgeSource[];
}

function resolveSources(opts: DefaultsOptions): KnowledgeSource[] {
  return opts.sources ?? DEFAULT_KNOWLEDGE_SOURCES;
}

/**
 * Install from the first reachable default source.
 *
 * Tries sources in order and returns as soon as one succeeds. Integrity is
 * checked per-source, so a tampered GitHub response doesn't poison the fallback
 * — we just move on to Gitee. If every source fails, aggregates the errors so
 * the UI can show which attempts went wrong.
 */
export async function installFromDefaults(
  opts: DefaultsOptions = {}
): Promise<{ source: KnowledgeSource }> {
  const sources = resolveSources(opts);
  const errors: Array<{ source: KnowledgeSource; error: string }> = [];
  for (const source of sources) {
    try {
      await installFromSource(source, opts);
      return { source };
    } catch (err) {
      errors.push({ source, error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw new Error(
    `all default sources failed:\n${errors
      .map((e) => `  - ${e.source.kind}:${e.source.location} → ${e.error}`)
      .join('\n')}`
  );
}

/**
 * Ask every default source for its manifest version. Returns the first
 * successful response. Used by the Skills page "check updates" button and the
 * startup silent check.
 */
export async function checkUpdatesFromDefaults(
  opts: DefaultsOptions = {}
): Promise<{ source: KnowledgeSource; local: string | null; remote: string }> {
  const sources = resolveSources(opts);
  const errors: Array<{ source: KnowledgeSource; error: string }> = [];
  for (const source of sources) {
    try {
      const r = await checkUpdates(source, opts);
      return { source, ...r };
    } catch (err) {
      errors.push({ source, error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw new Error(
    `all default sources failed:\n${errors
      .map((e) => `  - ${e.source.kind}:${e.source.location} → ${e.error}`)
      .join('\n')}`
  );
}
