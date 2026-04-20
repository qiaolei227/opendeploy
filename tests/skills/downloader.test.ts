import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import { downloadTarball, extractTarGz } from '../../src/main/skills/downloader';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-dl-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Make a .tar.gz on disk by packing a fixture dir. Returns path to the archive. */
async function makeFixtureTarball(): Promise<{ tarPath: string; fixtureRoot: string }> {
  const fixtureRoot = path.join(root, 'fixture');
  await fs.mkdir(path.join(fixtureRoot, 'skills', 'common', 'a'), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, 'manifest.json'), '{"schema":"1","version":"1.0.0","skills":[]}', 'utf8');
  await fs.writeFile(
    path.join(fixtureRoot, 'skills', 'common', 'a', 'SKILL.md'),
    '---\nname: a\ndescription: d\nversion: 1.0.0\n---\nbody\n',
    'utf8'
  );
  const tarPath = path.join(root, 'fixture.tar.gz');
  await tar.c({ gzip: true, file: tarPath, cwd: root }, ['fixture']);
  return { tarPath, fixtureRoot };
}

describe('extractTarGz', () => {
  it('extracts a .tar.gz archive into the destination', async () => {
    const { tarPath } = await makeFixtureTarball();
    const dest = path.join(root, 'out');

    await extractTarGz(tarPath, dest);

    const manifest = await fs.readFile(path.join(dest, 'fixture', 'manifest.json'), 'utf8');
    expect(manifest).toContain('"schema":"1"');
    const skill = await fs.readFile(
      path.join(dest, 'fixture', 'skills', 'common', 'a', 'SKILL.md'),
      'utf8'
    );
    expect(skill).toContain('name: a');
  });

  it('creates the destination dir if it is missing', async () => {
    const { tarPath } = await makeFixtureTarball();
    const dest = path.join(root, 'nested', 'dest');

    await extractTarGz(tarPath, dest);

    const stat = await fs.stat(path.join(dest, 'fixture'));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('downloadTarball', () => {
  it('streams a 200 response to the destination file', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchFn = async () =>
      new Response(payload, { status: 200, headers: { 'content-type': 'application/gzip' } });

    const dest = path.join(root, 'got.tar.gz');
    await downloadTarball('https://example.test/bundle.tar.gz', dest, { fetchFn });

    const onDisk = await fs.readFile(dest);
    expect(Array.from(onDisk)).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws on non-2xx responses', async () => {
    const fetchFn = async () => new Response('not found', { status: 404 });
    const dest = path.join(root, 'wont-exist.tar.gz');

    await expect(
      downloadTarball('https://example.test/missing', dest, { fetchFn })
    ).rejects.toThrow(/404/);
  });

  it('throws when the response has no body', async () => {
    const fetchFn = async () => new Response(null, { status: 200 });
    const dest = path.join(root, 'nobody.tar.gz');

    await expect(
      downloadTarball('https://example.test/empty', dest, { fetchFn })
    ).rejects.toThrow(/body/);
  });
});
