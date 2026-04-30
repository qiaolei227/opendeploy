import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BridgeClient, BridgeError, type BridgeOptions } from '../../../src/main/erp/k3cloud/bridge/client';

const here = dirname(fileURLToPath(import.meta.url));
const fakeBridge = join(here, 'fake-bridge.cjs');

let lastClient: BridgeClient | null = null;

function newClient(extra: Partial<BridgeOptions> = {}): BridgeClient {
  const c = new BridgeClient({
    exePath: process.execPath,
    args: [fakeBridge],
    timeoutMs: 2_000,
    ...extra,
  });
  lastClient = c;
  return c;
}

afterEach(async () => {
  if (lastClient) {
    await lastClient.stop();
    lastClient = null;
  }
});

describe('BridgeClient', () => {
  it('returns pong for ping after start', async () => {
    const c = newClient();
    expect(await c.send('ping')).toBe('pong');
  });

  it('routes concurrent sends back to the right callers', async () => {
    const c = newClient();
    await c.start();
    const [a, b, e] = await Promise.all([
      c.send('echo', { value: 'a' }),
      c.send('echo', { value: 'b' }),
      c.send('echo', { value: 'e' }),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(e).toBe('e');
  });

  it('throws BridgeError carrying the bridge code/message on failure', async () => {
    const c = newClient();
    await expect(c.send('fail')).rejects.toBeInstanceOf(BridgeError);
    try {
      await c.send('fail');
    } catch (err) {
      const be = err as BridgeError;
      expect(be.code).toBe('TestError');
      expect(be.message).toContain('fail requested');
    }
  });

  it('rejects pending requests when timeoutMs elapses', async () => {
    const c = newClient({ timeoutMs: 80 });
    await expect(c.send('slow', { ms: 400 })).rejects.toThrow(/timed out/);
  });

  it('forwards stderr lines via onLog', async () => {
    const logs: string[] = [];
    const c = newClient({ onLog: (l) => logs.push(l) });
    await c.send('log', { message: 'hello-world' });
    // stderr drain is independent of stdout — give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(logs.some((l) => l.includes('hello-world'))).toBe(true);
  });

  it('survives an orphan stdout line and still resolves the request', async () => {
    const orphans: string[] = [];
    const c = newClient({ onLog: (l) => orphans.push(l) });
    expect(await c.send('bad-line')).toBe('after-bad');
    expect(orphans.some((l) => l.includes('not json at all'))).toBe(true);
  });

  it('start() is idempotent', async () => {
    const c = newClient();
    const a = c.start();
    const b = c.start();
    await Promise.all([a, b]);
    expect(await c.send('ping')).toBe('pong');
  });

  it('rejects pending requests when the bridge process dies', async () => {
    const c = newClient();
    await c.start();
    // Issue a slow request so it's pending when we kill the process.
    const pending = c.send('slow', { ms: 5_000 });
    // Reach into the proc to kill it. Stopping via stop() would resolve cleanly.
    // We simulate a crash via SIGKILL instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (c as any).proc as { kill: (sig: string) => void };
    proc.kill('SIGKILL');
    await expect(pending).rejects.toThrow(/exited/);
    lastClient = null; // already dead
  });
});
