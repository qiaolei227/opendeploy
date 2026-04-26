import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger, getLogPath, getTracePath } from '../src/main/logger';

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

  describe('trace level (Plan 5.13)', () => {
    it('writes structured JSON line to today\'s agent-trace file', async () => {
      const logger = createLogger('agent-loop');
      await logger.trace({
        conversationId: 'c1',
        turn: 0,
        model: 'deepseek-v4',
        usage: { in: 1234, out: 567 }
      });
      const content = readFileSync(getTracePath(), 'utf-8').trim();
      const obj = JSON.parse(content);
      expect(obj.ts).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(obj.ns).toBe('agent-loop');
      expect(obj.conversationId).toBe('c1');
      expect(obj.turn).toBe(0);
      expect(obj.model).toBe('deepseek-v4');
      expect(obj.usage).toEqual({ in: 1234, out: 567 });
    });

    it('appends one line per trace call (newline-delimited)', async () => {
      const logger = createLogger('agent-loop');
      await logger.trace({ turn: 0 });
      await logger.trace({ turn: 1 });
      await logger.trace({ turn: 2 });
      const lines = readFileSync(getTracePath(), 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines.map((l) => JSON.parse(l).turn)).toEqual([0, 1, 2]);
    });

    it('keeps trace lines in their own per-day file separate from app.log', async () => {
      const logger = createLogger('agent-loop');
      await logger.info('regular log');
      await logger.trace({ event: 'turn-end' });
      // info → app.log; trace → agent-trace.{yyyy-MM-dd}.log
      expect(readFileSync(getLogPath(), 'utf-8')).toContain('regular log');
      expect(readFileSync(getLogPath(), 'utf-8')).not.toContain('"event":"turn-end"');
      expect(readFileSync(getTracePath(), 'utf-8')).toContain('"event":"turn-end"');
    });
  });
});
