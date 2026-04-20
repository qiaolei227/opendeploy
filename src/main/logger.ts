import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { openDeployHome } from './paths';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export function getLogPath(): string {
  return join(openDeployHome(), 'logs', 'app.log');
}

async function ensureLogDir(): Promise<void> {
  await fs.mkdir(dirname(getLogPath()), { recursive: true });
}

async function writeLine(line: string): Promise<void> {
  await ensureLogDir();
  await fs.appendFile(getLogPath(), line + '\n', 'utf-8');
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
}

export function createLogger(namespace: string): Logger {
  return {
    info: (m) => writeLine(formatLine('INFO', namespace, m)),
    warn: (m) => writeLine(formatLine('WARN', namespace, m)),
    error: (m, e) => writeLine(formatLine('ERROR', namespace, m, e)),
    debug: (m) => writeLine(formatLine('DEBUG', namespace, m))
  };
}
