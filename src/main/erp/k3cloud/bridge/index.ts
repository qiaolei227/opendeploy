import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BridgeClient, type BridgeOptions } from './client';

export { BridgeClient, BridgeError } from './client';
export type { BridgeOptions } from './client';

let instance: BridgeClient | null = null;
let startingPromise: Promise<BridgeClient> | null = null;

/**
 * Locate the bos-bridge executable. In dev we look at the build output
 * (`bos-bridge/bin/Release/net48/`); in packaged builds (Plan 6) the
 * executable will sit next to the Electron app. Override with the
 * `BOS_BRIDGE_EXE` env var for one-off tests / CI.
 */
export function resolveBridgeExePath(opts: { projectRoot?: string; appRoot?: string } = {}): string {
  const fromEnv = process.env.BOS_BRIDGE_EXE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const projectRoot = opts.projectRoot ?? process.cwd();
  const devPath = join(projectRoot, 'bos-bridge', 'bin', 'Release', 'net48', 'opendeploy-bos-serializer.exe');
  if (existsSync(devPath)) return resolve(devPath);

  if (opts.appRoot) {
    const prodPath = join(opts.appRoot, 'bos-bridge', 'opendeploy-bos-serializer.exe');
    if (existsSync(prodPath)) return resolve(prodPath);
  }

  throw new Error(
    `bos-bridge executable not found. Build with 'dotnet build bos-bridge -c Release', or set BOS_BRIDGE_EXE.`,
  );
}

/**
 * Lazily-spawned process-wide singleton. Schema build is expensive so we
 * keep the bridge alive for the lifetime of the app and serve all requests
 * through it. Crashes are surfaced as rejected promises; the next call
 * after a crash re-spawns automatically.
 */
export async function getBridge(options: Partial<BridgeOptions> = {}): Promise<BridgeClient> {
  if (instance) return instance;
  // Guard against concurrent callers both seeing instance===null and each
  // spawning their own bridge process — the second would be orphaned.
  if (startingPromise) return startingPromise;
  startingPromise = (async () => {
    const exePath = options.exePath ?? resolveBridgeExePath();
    const client = new BridgeClient({ exePath, ...options });
    try {
      await client.start();
    } catch (err) {
      startingPromise = null;
      throw err;
    }
    instance = client;
    startingPromise = null;
    return client;
  })();
  return startingPromise;
}

export async function stopBridge(): Promise<void> {
  if (instance) {
    const target = instance;
    instance = null;
    await target.stop();
  }
}

export function _resetBridgeForTests(): void {
  instance = null;
  startingPromise = null;
}
