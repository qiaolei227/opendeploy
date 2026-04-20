import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectDir, projectPluginsDir, projectsRoot } from '../../src/main/plugins/paths';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'opendeploy-paths-'));
  process.env.OPENDEPLOY_HOME = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
});

describe('project paths', () => {
  it('projectsRoot sits under OPENDEPLOY_HOME/projects', () => {
    expect(projectsRoot()).toBe(path.join(testDir, 'projects'));
  });

  it('projectDir nests project id under projectsRoot', () => {
    expect(projectDir('p_123')).toBe(path.join(testDir, 'projects', 'p_123'));
  });

  it('projectPluginsDir lives under the project dir', () => {
    expect(projectPluginsDir('p_123')).toBe(
      path.join(testDir, 'projects', 'p_123', 'plugins')
    );
  });
});
