import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readManifest, writeManifest } from '../../src/main/skills/manifest';
import type { KnowledgeManifest } from '@shared/skill-types';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-manifest-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('readManifest', () => {
  it('returns null when the file does not exist', async () => {
    expect(await readManifest(path.join(root, 'manifest.json'))).toBeNull();
  });

  it('parses a valid manifest', async () => {
    const m: KnowledgeManifest = {
      schema: '1',
      version: '1.2.3',
      skills: [{ id: 'common/a', version: '1.0.0', sha256: 'abc' }]
    };
    const p = path.join(root, 'manifest.json');
    await fs.writeFile(p, JSON.stringify(m), 'utf8');

    const loaded = await readManifest(p);

    expect(loaded).toEqual(m);
  });

  it('rejects an unsupported schema version', async () => {
    const p = path.join(root, 'manifest.json');
    await fs.writeFile(p, JSON.stringify({ schema: '2', version: '1.0.0', skills: [] }), 'utf8');

    await expect(readManifest(p)).rejects.toThrow(/schema/);
  });

  it('propagates non-ENOENT filesystem errors', async () => {
    await expect(readManifest(root /* a dir, not a file */)).rejects.toThrow();
  });
});

describe('writeManifest', () => {
  it('round-trips through readManifest', async () => {
    const m: KnowledgeManifest = {
      schema: '1',
      version: '0.1.0',
      sourceRef: 'abc1234',
      skills: [
        { id: 'common/a', version: '1.0.0', sha256: 'h1' },
        { id: 'common/b', version: '2.0.0', sha256: 'h2' }
      ]
    };
    const p = path.join(root, 'manifest.json');

    await writeManifest(p, m);

    expect(await readManifest(p)).toEqual(m);
  });

  it('writes pretty JSON terminated by a newline', async () => {
    const p = path.join(root, 'manifest.json');
    await writeManifest(p, { schema: '1', version: '0.1.0', skills: [] });
    const txt = await fs.readFile(p, 'utf8');
    expect(txt.endsWith('\n')).toBe(true);
    expect(txt).toContain('  "schema"');
  });
});
