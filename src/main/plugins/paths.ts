import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';

/**
 * Project-scoped on-disk layout for plugin artifacts agent produces.
 *
 *   $HOME/.opendeploy/projects/<project-id>/plugins/*.py
 *
 * Kept at $HOME (not userData) for the same reason knowledge/ is —
 * stable across Electron releases and easy for consultants to browse.
 * The $OPENDEPLOY_HOME env var overrides the base for tests.
 */
function homeBase(): string {
  if (process.env.OPENDEPLOY_HOME) return process.env.OPENDEPLOY_HOME;
  if (app?.getPath) return path.join(app.getPath('home'), '.opendeploy');
  return path.join(os.homedir(), '.opendeploy');
}

export function projectsRoot(): string {
  return path.join(homeBase(), 'projects');
}

export function projectDir(projectId: string): string {
  return path.join(projectsRoot(), projectId);
}

export function projectPluginsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'plugins');
}
