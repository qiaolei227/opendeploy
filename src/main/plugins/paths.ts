import path from 'node:path';
import { openDeployHome } from '../paths';

/**
 * Project-scoped on-disk layout for plugin artifacts agent produces.
 *
 *   $OPENDEPLOY_HOME/projects/<project-id>/plugins/*.py
 *
 * Defaults to ~/.opendeploy when the env var isn't set — see
 * src/main/paths.ts `openDeployHome`.
 */
export function projectsRoot(): string {
  return path.join(openDeployHome(), 'projects');
}

export function projectDir(projectId: string): string {
  return path.join(projectsRoot(), projectId);
}

export function projectPluginsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'plugins');
}
