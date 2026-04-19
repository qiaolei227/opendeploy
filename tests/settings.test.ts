import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSettings, saveSettings, getSettingsPath } from '../src/main/settings';
import { DEFAULT_SETTINGS } from '../src/shared/types';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'opendeploy-test-'));
  process.env.OPENDEPLOY_HOME = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
});

describe('settings', () => {
  it('returns defaults when no file exists', async () => {
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('creates settings file when saving', async () => {
    await saveSettings({ language: 'en-US', theme: 'dark' });
    expect(existsSync(getSettingsPath())).toBe(true);
  });

  it('persists and reloads settings', async () => {
    const input = { language: 'en-US' as const, theme: 'dark' as const };
    await saveSettings(input);
    const loaded = await loadSettings();
    expect(loaded).toEqual(input);
  });

  it('merges with defaults when file is partial', async () => {
    writeFileSync(
      getSettingsPath(),
      JSON.stringify({ language: 'en-US' }),
      'utf-8'
    );
    const loaded = await loadSettings();
    expect(loaded.language).toBe('en-US');
    expect(loaded.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('returns defaults when JSON is invalid', async () => {
    writeFileSync(getSettingsPath(), '{invalid', 'utf-8');
    const loaded = await loadSettings();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });
});
