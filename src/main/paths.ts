import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Base directory for all opendeploy state on the user's machine.
 *
 *   $OPENDEPLOY_HOME               (tests / power users)
 *   ~/.opendeploy                  (default)
 *
 * Every main-process module that lays down files under the user's home
 * calls this so a single env-var override reroutes *everything* to a
 * tmpdir during tests. Subdirectory helpers (settings.json,
 * conversations/, projects/, knowledge/) compose on top of it.
 */
export function openDeployHome(): string {
  return process.env.OPENDEPLOY_HOME ?? join(homedir(), '.opendeploy');
}
