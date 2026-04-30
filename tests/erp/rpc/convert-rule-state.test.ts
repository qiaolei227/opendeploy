import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveConvertRuleExtState,
  loadConvertRuleExtState,
  convertRuleExtStatePath,
  type ConvertRuleExtState,
} from '../../../src/main/erp/k3cloud/rpc/convert-rule-state';

// Redirect openDeployHome to a temp dir so tests don't touch ~/.opendeploy
let tmpHome: string;
beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'opd-test-'));
  process.env.OPENDEPLOY_HOME = tmpHome;
});
afterEach(() => {
  delete process.env.OPENDEPLOY_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const SAMPLE: ConvertRuleExtState = {
  extId: 'abc123',
  originRuleId: 'SaleOrder-OutStock',
  xml: '<?xml version="1.0"?><ConvertRuleMetaData/>',
  inheritPath: ',SaleOrder-OutStock,',
  version: null,
  mainVersion: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('convert-rule-state', () => {
  it('saves and reloads state round-trip', async () => {
    await saveConvertRuleExtState('proj1', SAMPLE);
    const loaded = await loadConvertRuleExtState('proj1', 'abc123');
    expect(loaded).toEqual(SAMPLE);
  });

  it('creates parent directories automatically', async () => {
    await saveConvertRuleExtState('deep/nested/proj', SAMPLE);
    const loaded = await loadConvertRuleExtState('deep/nested/proj', 'abc123');
    expect(loaded.extId).toBe('abc123');
  });

  it('overwrites existing state on second save', async () => {
    await saveConvertRuleExtState('proj1', SAMPLE);
    const updated: ConvertRuleExtState = { ...SAMPLE, xml: '<updated/>', updatedAt: '2026-02-01T00:00:00.000Z' };
    await saveConvertRuleExtState('proj1', updated);
    const loaded = await loadConvertRuleExtState('proj1', 'abc123');
    expect(loaded.xml).toBe('<updated/>');
    expect(loaded.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('throws with helpful message when state file not found', async () => {
    await expect(loadConvertRuleExtState('proj1', 'missing-ext')).rejects.toThrow(
      /未找到本地状态/,
    );
  });

  it('statePath encodes projectId and extId in the path', () => {
    const p = convertRuleExtStatePath('myProject', 'myExtId');
    expect(p).toContain('myProject');
    expect(p).toContain('myExtId.json');
    expect(p).toContain('convert-rule-ext');
  });
});
