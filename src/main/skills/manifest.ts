import fs from 'node:fs/promises';
import type { KnowledgeManifest } from '@shared/skill-types';

/**
 * Read and validate a knowledge bundle's `manifest.json`.
 *
 * - Returns `null` when the file does not exist, so callers can distinguish
 *   "not yet installed" from "installed but broken".
 * - Throws on any other IO error or on an unsupported schema version —
 *   we'd rather fail loud than silently fall back to "no skills".
 */
export async function readManifest(p: string): Promise<KnowledgeManifest | null> {
  let txt: string;
  try {
    txt = await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  const parsed = JSON.parse(txt) as KnowledgeManifest;
  if (parsed.schema !== '1') {
    throw new Error(`Unsupported manifest schema: "${parsed.schema}" (this build understands "1")`);
  }
  return parsed;
}

/** Write a manifest as pretty JSON with a trailing newline (POSIX-friendly). */
export async function writeManifest(p: string, m: KnowledgeManifest): Promise<void> {
  await fs.writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf8');
}
