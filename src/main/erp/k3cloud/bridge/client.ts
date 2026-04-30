import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

/**
 * Long-lived child process that wraps the .NET DcxmlSerializer. One instance
 * per Node process — schema build is ~hundreds of ms one-shot, every request
 * after that reuses the same in-memory binder.
 *
 * Protocol (NDJSON, one JSON object per line):
 *   request:  {"id": <int>, "op": "<name>", ...args}
 *   ok:       {"id": <echoed>, "ok": true,  "result": <any>}
 *   err:      {"id": <echoed>, "ok": false, "code": "<exception>", "message": "..."}
 *
 * stderr is reserved for diagnostic logs (forwarded to the caller-supplied
 * `onLog` callback if any) and never parsed as a response.
 */
export interface BridgeOptions {
  /** Absolute path to opendeploy-bos-serializer.exe (or any executable for tests). */
  exePath: string;
  /** Process args. Defaults to ['serve']; tests pass a fake-bridge script here. */
  args?: string[];
  /** Override the K/3 Cloud DeskClient install dir if the bridge can't auto-detect it. */
  installPath?: string;
  /** Per-request timeout in milliseconds. Default 30 000. */
  timeoutMs?: number;
  /** Receive each line the bridge writes to stderr. Default = swallow. */
  onLog?: (line: string) => void;
}

export class BridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'BridgeError';
  }
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const STARTUP_TIMEOUT_MS = 60_000;

export class BridgeClient {
  private proc: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private fatalError: Error | null = null;

  constructor(private readonly options: BridgeOptions) {}

  /** Idempotent — returns the same promise on repeated calls until stop(). */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._startInternal();
    return this.startPromise;
  }

  /**
   * Send a request and wait for the matching response. Multiple concurrent
   * sends are safe — each request gets a unique id and responses are routed
   * back via the pending map.
   */
  async send<T = unknown>(
    op: string,
    args: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    await this.start();
    return this._sendInternal<T>(op, args, timeoutMs);
  }

  /**
   * Same as send() but does not await start(). Used inside _startInternal
   * for the readiness ping — calling the public send() there would deadlock
   * because start() returns its own (unresolved) startPromise.
   */
  private _sendInternal<T = unknown>(
    op: string,
    args: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    if (this.fatalError) return Promise.reject(this.fatalError);
    const proc = this.proc;
    if (!proc || !proc.stdin) return Promise.reject(new Error('bridge process not available'));

    const id = this.nextId++;
    const effectiveTimeout = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`bridge op '${op}' timed out after ${effectiveTimeout}ms`));
        }
      }, effectiveTimeout);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      const line = JSON.stringify({ id, op, ...args }) + '\n';
      proc.stdin!.write(line, (err) => {
        if (err && this.pending.delete(id)) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /** Convenience wrapper for `normalize_convert_rule`. */
  async normalizeConvertRule(xml: string): Promise<string> {
    const result = await this.send<{ xml: string }>('normalize_convert_rule', { xml });
    return result.xml;
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    return new Promise<void>((resolve) => {
      const onExit = () => {
        this.cleanup();
        resolve();
      };
      proc.once('exit', onExit);
      proc.stdin?.end();
      // Force-kill after 5s if it didn't exit cleanly.
      setTimeout(() => {
        if (this.proc) proc.kill('SIGKILL');
      }, 5_000).unref();
    });
  }

  // ── internals ──────────────────────────────────────────────────────

  private async _startInternal(): Promise<void> {
    const env = { ...process.env };
    if (this.options.installPath) env.BOS_BRIDGE_DESKCLIENT = this.options.installPath;

    const proc = spawn(this.options.exePath, this.options.args ?? ['serve'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });

    this.proc = proc;

    proc.on('error', (err) => this.failAll(err));
    proc.on('exit', (code, signal) => {
      const reason = code != null ? `code=${code}` : `signal=${signal}`;
      this.failAll(new Error(`bos-bridge exited (${reason})`));
    });

    this.readline = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
    this.readline.on('line', (line) => this.handleResponseLine(line));

    proc.stderr!.setEncoding('utf8');
    let stderrBuf = '';
    proc.stderr!.on('data', (chunk: string) => {
      stderrBuf += chunk;
      let nl: number;
      while ((nl = stderrBuf.indexOf('\n')) >= 0) {
        const line = stderrBuf.slice(0, nl).replace(/\r$/, '');
        stderrBuf = stderrBuf.slice(nl + 1);
        if (line.length) this.options.onLog?.(line);
      }
    });

    // Confirm liveness — first ping doubles as schema-build wait. Use
    // _sendInternal because send() would await this.start(), which is the
    // promise we're currently resolving (deadlock).
    try {
      const pong = await this._sendInternal<string>('ping', {}, STARTUP_TIMEOUT_MS);
      if (pong !== 'pong') throw new Error(`unexpected ping response: ${JSON.stringify(pong)}`);
    } catch (err) {
      this.cleanup();
      this.startPromise = null;
      throw err;
    }
  }

  private handleResponseLine(line: string): void {
    if (!line) return;
    let msg: { id?: unknown; ok?: unknown; result?: unknown; code?: unknown; message?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      // Malformed — likely the bridge wrote to stdout outside the protocol.
      // Surface to log channel so it isn't silently lost.
      this.options.onLog?.(`<unparseable stdout> ${line}`);
      return;
    }
    if (typeof msg.id !== 'number') {
      this.options.onLog?.(`<orphan response> ${line}`);
      return;
    }
    const handler = this.pending.get(msg.id);
    if (!handler) return;
    this.pending.delete(msg.id);
    if (msg.ok === true) {
      handler.resolve(msg.result);
    } else {
      handler.reject(new BridgeError(String(msg.code ?? 'BridgeError'), String(msg.message ?? '')));
    }
  }

  private failAll(err: Error): void {
    if (!this.fatalError) this.fatalError = err;
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
    this.cleanup();
  }

  private cleanup(): void {
    this.readline?.close();
    this.readline = null;
    this.proc = null;
  }
}
