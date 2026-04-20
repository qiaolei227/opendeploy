import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface DownloadOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: FetchFn;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

/**
 * Stream a remote file to `destFile`. Parent directory is created if missing.
 * Throws on non-2xx responses or a body-less 200 (some proxies strip bodies on
 * cached/HEAD-converted responses — we'd rather surface that than write an
 * empty file that fails integrity check later).
 */
export async function downloadTarball(
  url: string,
  destFile: string,
  opts: DownloadOptions = {}
): Promise<void> {
  const doFetch = opts.fetchFn ?? fetch;
  const res = await doFetch(url, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText} (${url})`);
  }
  if (!res.body) {
    throw new Error(`download failed: empty response body (${url})`);
  }

  await fs.mkdir(path.dirname(destFile), { recursive: true });
  // Node 18+: Response.body is a WHATWG ReadableStream; Readable.fromWeb converts
  // it into a Node stream that `pipeline` can pump.
  const nodeReadable = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeReadable, createWriteStream(destFile));
}

/** Extract a `.tar.gz` into `destDir`. `destDir` is created if missing. */
export async function extractTarGz(file: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await pipeline(createReadStream(file), tar.x({ cwd: destDir }));
}
