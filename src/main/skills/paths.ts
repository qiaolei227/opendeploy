import path from 'node:path';
import { openDeployHome } from '../paths';

/**
 * Root of the local knowledge cache — `<openDeployHome>/knowledge/`.
 *
 * We keep it at `$HOME` (via `openDeployHome()`) rather than
 * `app.getPath('userData')` so the path is stable across Electron releases
 * (userData on Windows embeds the bundle id) and easy for users to browse
 * in Explorer / Finder. Routing through `openDeployHome` also means the
 * `$OPENDEPLOY_HOME` override used by tests and debug scripts applies
 * uniformly across all on-disk state.
 */
export function knowledgeDir(): string {
  return path.join(openDeployHome(), 'knowledge');
}

/** Skills tree: `<knowledgeDir>/skills/<namespace>/<skill-name>/SKILL.md`. */
export function skillsDir(root: string = knowledgeDir()): string {
  return path.join(root, 'skills');
}

/** Path to the bundle-level manifest.json. */
export function manifestPath(root: string = knowledgeDir()): string {
  return path.join(root, 'manifest.json');
}

/** Scratch directory for a single download + extract cycle. Caller must `rm -rf` it. */
export function tmpDownloadDir(root: string = knowledgeDir()): string {
  return path.join(root, '.tmp', String(Date.now()));
}
