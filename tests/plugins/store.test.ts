import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  deletePlugin,
  listPlugins,
  readPlugin,
  writePlugin
} from '../../src/main/plugins/store';
import { projectPluginsDir } from '../../src/main/plugins/paths';

const PID = 'p_test';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'opendeploy-plug-store-'));
  process.env.OPENDEPLOY_HOME = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
});

describe('plugins store', () => {
  it('listPlugins returns empty when the dir does not exist', async () => {
    expect(await listPlugins(PID)).toEqual([]);
  });

  it('writePlugin creates the dir + file; listPlugins finds it', async () => {
    const r = await writePlugin(PID, 'hello.py', '# hi\nprint(1)\n');

    expect(r.created).toBe(true);
    expect(r.lines).toBe(3); // "# hi\nprint(1)\n".split(/\r?\n/) = ['# hi','print(1)','']
    expect(r.projectId).toBe(PID);

    const list = await listPlugins(PID);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('hello.py');
    expect(list[0].size).toBeGreaterThan(0);
  });

  it('writePlugin overwrite sets created=false', async () => {
    await writePlugin(PID, 'hello.py', 'v1');
    const r = await writePlugin(PID, 'hello.py', 'v2 longer');
    expect(r.created).toBe(false);

    expect(await readPlugin(PID, 'hello.py')).toBe('v2 longer');
  });

  it('writePlugin rejects invalid filenames', async () => {
    await expect(writePlugin(PID, 'foo.cs', '#')).rejects.toThrow(/\.py/);
    // "../escape.py" fails the separator check first — still rejected, which is what matters.
    await expect(writePlugin(PID, '../escape.py', '#')).rejects.toThrow(/invalid plugin filename/);
    await expect(writePlugin(PID, '', '#')).rejects.toThrow(/empty/);
  });

  it('readPlugin throws ENOENT for missing files', async () => {
    await expect(readPlugin(PID, 'ghost.py')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deletePlugin removes the file; second delete is a no-op', async () => {
    await writePlugin(PID, 'hello.py', '#');
    await deletePlugin(PID, 'hello.py');
    expect(await listPlugins(PID)).toEqual([]);
    await expect(deletePlugin(PID, 'hello.py')).resolves.toBeUndefined();
  });

  it('listPlugins ignores non-.py entries', async () => {
    const dir = projectPluginsDir(PID);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'keep.py'), '#');
    await fs.writeFile(path.join(dir, 'stray.txt'), 'ignore me');
    const list = await listPlugins(PID);
    expect(list.map((p) => p.name)).toEqual(['keep.py']);
  });

  it('listPlugins sorts most-recently-modified first', async () => {
    await writePlugin(PID, 'a.py', '#');
    await new Promise((r) => setTimeout(r, 10));
    await writePlugin(PID, 'b.py', '#');
    const list = await listPlugins(PID);
    expect(list.map((p) => p.name)).toEqual(['b.py', 'a.py']);
  });
});
