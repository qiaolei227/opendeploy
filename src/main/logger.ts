import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { openDeployHome } from './paths';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'TRACE';

export function getLogPath(): string {
  return join(openDeployHome(), 'logs', 'app.log');
}

/**
 * Trace log lives in its own per-day file so noisy turn-by-turn JSON doesn't
 * drown error / info entries in `app.log`. Lines are pure JSON (no prefix)
 * so they grep / `jq` cleanly.
 */
export function getTracePath(date: Date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10); // yyyy-MM-dd
  return join(openDeployHome(), 'logs', `agent-trace.${ymd}.log`);
}

async function ensureLogDir(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
}

/**
 * Per-file write queue so concurrent `appendFile` calls don't interleave.
 * fire-and-forget callers (e.g. agent loop's `void writeTurnTrace`) can
 * race two turns into the same line otherwise — node's O_APPEND atomicity
 * doesn't sequence calls that the JS runtime issued out of order. The
 * queue keeps ordering deterministic without forcing every caller to await.
 */
const writeQueues = new Map<string, Promise<void>>();

async function writeLine(filePath: string, line: string): Promise<void> {
  const tail = writeQueues.get(filePath) ?? Promise.resolve();
  const next = tail
    .catch(() => undefined) // never poison the chain on a prior failure
    .then(async () => {
      await ensureLogDir(filePath);
      await fs.appendFile(filePath, line + '\n', 'utf-8');
    });
  writeQueues.set(filePath, next);
  return next;
}

function formatLine(
  level: LogLevel,
  namespace: string,
  message: string,
  err?: Error
): string {
  const ts = new Date().toISOString();
  const base = `${ts} ${level} [${namespace}] ${message}`;
  return err ? `${base} | ${err.message}\n${err.stack}` : base;
}

export interface Logger {
  info: (message: string) => Promise<void>;
  warn: (message: string) => Promise<void>;
  error: (message: string, err?: Error) => Promise<void>;
  debug: (message: string) => Promise<void>;
  /**
   * Append one structured trace record as a single JSON line to today's
   * `agent-trace.{yyyy-MM-dd}.log`. The runtime stamps `ts` and `namespace`
   * automatically so callers only pass payload fields.
   */
  trace: (payload: Record<string, unknown>) => Promise<void>;
}

export function createLogger(namespace: string): Logger {
  return {
    info: (m) => writeLine(getLogPath(), formatLine('INFO', namespace, m)),
    warn: (m) => writeLine(getLogPath(), formatLine('WARN', namespace, m)),
    error: (m, e) => writeLine(getLogPath(), formatLine('ERROR', namespace, m, e)),
    debug: (m) => writeLine(getLogPath(), formatLine('DEBUG', namespace, m)),
    trace: (payload) =>
      writeLine(
        getTracePath(),
        JSON.stringify({ ts: new Date().toISOString(), ns: namespace, ...payload })
      )
  };
}
