import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeManifest, SkillMeta } from '@shared/skill-types';

/** SHA-256 hex digest of the file at `p`. Throws if the file is unreadable. */
export async function hashFile(p: string): Promise<string> {
  const buf = await fs.readFile(p);
  return createHash('sha256').update(buf).digest('hex');
}

/** One mismatch between a manifest entry and what's on disk. */
export interface IntegrityMismatch {
  id: string;
  /** SHA-256 the manifest promised. */
  expected: string;
  /** SHA-256 on disk, or `null` if the skill is missing entirely. */
  actual: string | null;
}

export interface IntegrityReport {
  ok: boolean;
  mismatches: IntegrityMismatch[];
}

/**
 * Verify that every skill listed in `manifest` exists in `skills` and hashes
 * to the expected SHA-256. On-disk skills that aren't in the manifest are
 * ignored (they may be user-authored additions); the manager decides what to
 * do about those separately.
 *
 * `root` is accepted for future use (e.g. hashing aux files beyond SKILL.md)
 * and to keep the signature consistent across bundle-level operations.
 */
export async function verifyIntegrity(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  root: string,
  manifest: KnowledgeManifest,
  skills: SkillMeta[]
): Promise<IntegrityReport> {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const mismatches: IntegrityMismatch[] = [];

  for (const entry of manifest.skills) {
    const meta = byId.get(entry.id);
    if (!meta) {
      mismatches.push({ id: entry.id, expected: entry.sha256, actual: null });
      continue;
    }
    const actual = await hashFile(path.join(meta.path, 'SKILL.md'));
    if (actual !== entry.sha256) {
      mismatches.push({ id: entry.id, expected: entry.sha256, actual });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}
