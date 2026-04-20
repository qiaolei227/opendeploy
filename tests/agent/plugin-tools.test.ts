import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildPluginTools } from '../../src/main/agent/plugin-tools';
import { _reset, setActiveProject } from '../../src/main/erp/active';
import type { Project } from '@shared/erp-types';
import { projectPluginsDir } from '../../src/main/plugins/paths';

const project: Project = {
  id: 'p_test',
  name: 'test',
  erpProvider: 'k3cloud',
  connection: {
    server: 'localhost',
    database: 'x',
    user: 'sa',
    password: 'x',
    edition: 'standard',
    version: '9'
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'opendeploy-plug-tools-'));
  process.env.OPENDEPLOY_HOME = testDir;
  _reset();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
  _reset();
});

/**
 * setActiveProject tries to open a real mssql pool; that would fail here.
 * The active-state module exposes a listener hook but no public setter that
 * skips connect(). For these tests we're fine with status=error after the
 * pool open rejects — projectId is still set, which is what buildPluginTools
 * reads. Alternatively we could mock the module, but this is more honest:
 * the production code path runs too.
 */
async function setTestActive(): Promise<void> {
  // This will throw inside openPool since localhost:1433 in CI isn't a DB,
  // but the module still tracks projectId in the error state.
  await setActiveProject(project);
}

describe('buildPluginTools', () => {
  it('returns empty when no project is active', () => {
    expect(buildPluginTools()).toEqual([]);
  });

  it('returns 3 tools when a project is active (even if connect() failed)', async () => {
    await setTestActive();
    const tools = buildPluginTools();
    expect(tools.map((t) => t.definition.name).sort()).toEqual([
      'list_plugins',
      'read_plugin',
      'write_plugin'
    ]);
  });
});

describe('write_plugin tool', () => {
  it('writes the file to the project plugins dir and returns JSON with path + lines', async () => {
    await setTestActive();
    const tool = buildPluginTools().find((t) => t.definition.name === 'write_plugin')!;

    const raw = await tool.execute({
      filename: 'demo.py',
      content: '# demo\nprint(1)\n'
    });

    const parsed = JSON.parse(raw);
    expect(parsed.created).toBe(true);
    expect(parsed.filename).toBe('demo.py');
    expect(parsed.lines).toBe(3);
    expect(parsed.path).toContain(path.join('projects', 'p_test', 'plugins', 'demo.py'));

    const onDisk = await fs.readFile(
      path.join(projectPluginsDir('p_test'), 'demo.py'),
      'utf8'
    );
    expect(onDisk).toBe('# demo\nprint(1)\n');
  });

  it('rejects invalid filenames from the agent', async () => {
    await setTestActive();
    const tool = buildPluginTools().find((t) => t.definition.name === 'write_plugin')!;
    await expect(
      tool.execute({ filename: '../escape.py', content: '#' })
    ).rejects.toThrow(/invalid plugin filename/);
  });

  it('rejects non-string arguments', async () => {
    await setTestActive();
    const tool = buildPluginTools().find((t) => t.definition.name === 'write_plugin')!;
    await expect(tool.execute({ filename: 1, content: '#' } as never)).rejects.toThrow();
    await expect(
      tool.execute({ filename: 'x.py', content: 2 } as never)
    ).rejects.toThrow();
  });
});

describe('list_plugins tool', () => {
  it('lists files written by write_plugin', async () => {
    await setTestActive();
    const tools = buildPluginTools();
    const write = tools.find((t) => t.definition.name === 'write_plugin')!;
    const list = tools.find((t) => t.definition.name === 'list_plugins')!;

    await write.execute({ filename: 'a.py', content: '#' });
    await write.execute({ filename: 'b.py', content: '#' });
    const parsed = JSON.parse(await list.execute({}));

    expect(parsed.projectId).toBe('p_test');
    expect(parsed.count).toBe(2);
    expect(parsed.files.map((f: { name: string }) => f.name).sort()).toEqual([
      'a.py',
      'b.py'
    ]);
  });
});

describe('read_plugin tool', () => {
  it('returns the on-disk content', async () => {
    await setTestActive();
    const tools = buildPluginTools();
    const write = tools.find((t) => t.definition.name === 'write_plugin')!;
    const read = tools.find((t) => t.definition.name === 'read_plugin')!;

    await write.execute({ filename: 'hello.py', content: 'value-42' });
    const parsed = JSON.parse(await read.execute({ filename: 'hello.py' }));

    expect(parsed.filename).toBe('hello.py');
    expect(parsed.content).toBe('value-42');
  });

  it('rejects empty filename', async () => {
    await setTestActive();
    const read = buildPluginTools().find((t) => t.definition.name === 'read_plugin')!;
    await expect(read.execute({ filename: '  ' })).rejects.toThrow(/filename/);
  });
});
