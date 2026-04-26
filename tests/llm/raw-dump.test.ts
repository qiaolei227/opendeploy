import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createFileRawCapture,
  redactHeaders,
  pruneOldRawConvs,
  DEFAULT_RAW_KEEP_N
} from '../../src/main/llm/raw-dump';

describe('redactHeaders', () => {
  it('replaces Authorization with ***', () => {
    expect(redactHeaders({ Authorization: 'Bearer sk-abc' })).toEqual({
      Authorization: '***'
    });
  });

  it('replaces x-api-key (Anthropic-style) regardless of case', () => {
    expect(redactHeaders({ 'X-Api-Key': 'sk-ant-xyz' })).toEqual({
      'X-Api-Key': '***'
    });
    expect(redactHeaders({ 'x-api-key': 'sk-ant-xyz' })).toEqual({
      'x-api-key': '***'
    });
  });

  it('leaves non-secret headers untouched', () => {
    expect(
      redactHeaders({ 'Content-Type': 'application/json', Authorization: 'sk' })
    ).toEqual({ 'Content-Type': 'application/json', Authorization: '***' });
  });

  it('does not mutate the input', () => {
    const input = { Authorization: 'sk-abc' };
    redactHeaders(input);
    expect(input.Authorization).toBe('sk-abc');
  });
});

describe('createFileRawCapture', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'opendeploy-raw-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes req.json + res.txt under <conv>/ on close', async () => {
    const cap = createFileRawCapture({
      conversationId: 'c-abc',
      turn: 0,
      rootOverride: tmp
    });
    cap.onRequest({ model: 'deepseek-v4', messages: [] }, { Authorization: 'Bearer sk' });
    cap.onChunk('data: {"choices":[{"delta":{"content":"hi"}}]}');
    cap.onChunk('data: [DONE]');
    await cap.onClose();

    const reqPath = join(tmp, 'c-abc', 'turn-000.req.json');
    const resPath = join(tmp, 'c-abc', 'turn-000.res.txt');
    expect(existsSync(reqPath)).toBe(true);
    expect(existsSync(resPath)).toBe(true);

    const req = JSON.parse(readFileSync(reqPath, 'utf-8'));
    expect(req.body.model).toBe('deepseek-v4');
    expect(req.headers.Authorization).toBe('***'); // redacted

    const res = readFileSync(resPath, 'utf-8');
    expect(res).toContain('"content":"hi"');
    expect(res).toContain('[DONE]');
  });

  it('zero-pads turn index so files sort lexically', async () => {
    const cap = createFileRawCapture({
      conversationId: 'c1',
      turn: 7,
      rootOverride: tmp
    });
    cap.onRequest({ x: 1 }, {});
    await cap.onClose();
    expect(existsSync(join(tmp, 'c1', 'turn-007.req.json'))).toBe(true);
  });

  it('skips res.txt when no chunks captured (e.g. fetch threw before stream)', async () => {
    const cap = createFileRawCapture({ conversationId: 'c1', turn: 0, rootOverride: tmp });
    cap.onRequest({ x: 1 }, {});
    await cap.onClose();
    expect(existsSync(join(tmp, 'c1', 'turn-000.req.json'))).toBe(true);
    expect(existsSync(join(tmp, 'c1', 'turn-000.res.txt'))).toBe(false);
  });

  it('onClose is idempotent — calling twice does not throw or duplicate', async () => {
    const cap = createFileRawCapture({ conversationId: 'c1', turn: 0, rootOverride: tmp });
    cap.onRequest({ x: 1 }, {});
    cap.onChunk('a');
    await cap.onClose();
    await cap.onClose(); // should be no-op
    expect(readFileSync(join(tmp, 'c1', 'turn-000.res.txt'), 'utf-8')).toBe('a\n');
  });
});

describe('pruneOldRawConvs', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'opendeploy-raw-prune-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function makeConv(name: string, mtimeOffsetMs: number): Promise<void> {
    const cap = createFileRawCapture({
      conversationId: name,
      turn: 0,
      rootOverride: tmp
    });
    cap.onRequest({ x: 1 }, {});
    await cap.onClose();
    // Force a deterministic mtime so the prune sort is reproducible
    const t = new Date(Date.now() + mtimeOffsetMs);
    utimesSync(join(tmp, name), t, t);
  }

  it('keeps the newest N conv dirs, removes older ones', async () => {
    await makeConv('c-old-1', -3000);
    await makeConv('c-old-2', -2000);
    await makeConv('c-mid', -1000);
    await makeConv('c-newest', 0);
    await pruneOldRawConvs(2, tmp);
    expect(existsSync(join(tmp, 'c-newest'))).toBe(true);
    expect(existsSync(join(tmp, 'c-mid'))).toBe(true);
    expect(existsSync(join(tmp, 'c-old-1'))).toBe(false);
    expect(existsSync(join(tmp, 'c-old-2'))).toBe(false);
  });

  it('does nothing when count <= keepN', async () => {
    await makeConv('c1', 0);
    await makeConv('c2', -1000);
    await pruneOldRawConvs(5, tmp);
    expect(existsSync(join(tmp, 'c1'))).toBe(true);
    expect(existsSync(join(tmp, 'c2'))).toBe(true);
  });

  it('does not throw when raw-llm root does not exist yet', async () => {
    rmSync(tmp, { recursive: true, force: true }); // delete the root entirely
    await expect(pruneOldRawConvs(20, tmp)).resolves.toBeUndefined();
  });

  it('exposes a sane default keep count (20)', () => {
    expect(DEFAULT_RAW_KEEP_N).toBe(20);
  });
});
