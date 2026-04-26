/**
 * Plan 5.13 raw 层 — verbatim dump of each LLM turn's request body and SSE
 * chunk stream. Off by default in Enterprise; on by default in Community
 * Edition (single-machine local tool, business data already lives on the
 * user's box). The flag is `settings.llmRawDump`.
 *
 * Files land at:
 *   logs/raw-llm/<convId>/turn-NNN.req.json   ← request body + redacted headers
 *   logs/raw-llm/<convId>/turn-NNN.res.txt    ← SSE chunks joined with separators
 *
 * `<convId>` mirrors the conversation file in `~/.opendeploy/conversations/`,
 * so a consultant chasing a weird turn can `ls logs/raw-llm/<convId>/` and
 * read the same chronology.
 *
 * `pruneOldRawConvs(keepN)` runs after every turn so the directory caps at
 * `keepN` newest conversations — no manual cleanup needed for normal use,
 * but the user can still `rm -rf logs/raw-llm/<convId>/` to wipe one
 * conversation's raw history without touching the markdown.
 *
 * Authorization / x-api-key headers are scrubbed to `***` before write —
 * not because the local FS is hostile, but because users will eventually
 * paste these files into GitHub issues or screen-share them.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { openDeployHome } from '../paths';

export interface RawCapture {
  /** Called once before the HTTP request goes out. */
  onRequest(body: unknown, headers: Record<string, string>): void;
  /** Called for every SSE `data:` payload (already decoded as string). */
  onChunk(chunk: string): void;
  /** Called when the stream terminates (success / error / abort). Idempotent. */
  onClose(): Promise<void>;
}

interface FileRawCaptureOpts {
  conversationId: string;
  turn: number;
  /** Only used by tests — overrides the resolved logs/ root. */
  rootOverride?: string;
}

/**
 * Build a RawCapture that buffers in memory and flushes to disk on close.
 * Buffering means the SSE consumption loop isn't blocked on FS I/O during
 * streaming — important for low-latency token rendering. The trade-off:
 * a hard crash mid-stream loses that turn's raw — acceptable for diagnostics.
 */
export function createFileRawCapture(opts: FileRawCaptureOpts): RawCapture {
  const chunks: string[] = [];
  let req: { body: unknown; headers: Record<string, string> } | null = null;
  let closed = false;

  return {
    onRequest(body, headers) {
      req = { body, headers: redactHeaders(headers) };
    },
    onChunk(chunk) {
      chunks.push(chunk);
    },
    async onClose() {
      if (closed) return;
      closed = true;

      const root = opts.rootOverride ?? join(openDeployHome(), 'logs', 'raw-llm');
      const dir = join(root, opts.conversationId);
      await fs.mkdir(dir, { recursive: true });
      const turnPad = String(opts.turn).padStart(3, '0');

      if (req) {
        await fs.writeFile(
          join(dir, `turn-${turnPad}.req.json`),
          JSON.stringify(req, null, 2),
          'utf-8'
        );
      }
      if (chunks.length > 0) {
        // Separator must be a string the SSE protocol can't produce on its own
        // so a future "split this back into chunks" step is unambiguous.
        await fs.writeFile(
          join(dir, `turn-${turnPad}.res.txt`),
          chunks.join('\n---chunk---\n') + '\n',
          'utf-8'
        );
      }
    }
  };
}

/**
 * Redact known credential headers. Case-insensitive — providers are
 * inconsistent (`Authorization` vs `authorization` vs Anthropic's `x-api-key`).
 * Returns a new map; never mutates the input.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const SECRET_HEADERS = new Set(['authorization', 'x-api-key', 'api-key']);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

/**
 * Keep only the `keepN` most-recently-modified conversation directories
 * under `logs/raw-llm/`; recursively delete the rest. Bounded retention
 * means raw dumps don't pile up to GBs over months of usage. We sort by
 * directory mtime (which mtime-bumps every time we write a new turn into
 * it) so "active" conversations stay no matter how old they are.
 */
export async function pruneOldRawConvs(
  keepN: number,
  rootOverride?: string
): Promise<void> {
  const root = rootOverride ?? join(openDeployHome(), 'logs', 'raw-llm');
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return; // root never created — nothing to prune
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length <= keepN) return;

  const stats = await Promise.all(
    dirs.map(async (name) => ({
      name,
      mtimeMs: (await fs.stat(join(root, name))).mtimeMs
    }))
  );
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  const victims = stats.slice(keepN);
  await Promise.all(
    victims.map((v) => fs.rm(join(root, v.name), { recursive: true, force: true }))
  );
}

/** Default retention — 20 conversations is ~1-2 weeks of typical use. */
export const DEFAULT_RAW_KEEP_N = 20;
