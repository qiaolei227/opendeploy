import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger, getLogPath } from '../src/main/logger';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'opendeploy-log-'));
  process.env.OPENDEPLOY_HOME = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
});

describe('logger', () => {
  it('writes log line to file', async () => {
    const logger = createLogger('test');
    await logger.info('hello');
    const content = readFileSync(getLogPath(), 'utf-8');
    expect(content).toContain('hello');
    expect(content).toContain('[test]');
    expect(content).toContain('INFO');
  });

  it('includes timestamp', async () => {
    const logger = createLogger('test');
    await logger.info('world');
    const content = readFileSync(getLogPath(), 'utf-8');
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('supports error level', async () => {
    const logger = createLogger('test');
    await logger.error('oops', new Error('bad'));
    const content = readFileSync(getLogPath(), 'utf-8');
    expect(content).toContain('ERROR');
    expect(content).toContain('oops');
    expect(content).toContain('bad');
  });
});
