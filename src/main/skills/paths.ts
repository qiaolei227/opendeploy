import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';

/**
 * Root of the local knowledge cache — `<home>/.opendeploy/knowledge/`.
 *
 * We keep it at `$HOME` rather than `app.getPath('userData')` so the path is
 * stable across Electron releases (userData on Windows embeds the bundle id)
 * and easy for users to browse in Explorer / Finder.
 */
export function knowledgeDir(): string {
  const home = app?.getPath ? app.getPath('home') : os.homedir();
  return path.join(home, '.opendeploy', 'knowledge');
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
