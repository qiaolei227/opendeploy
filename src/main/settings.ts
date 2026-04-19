import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { AppSettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';

export function getSettingsPath(): string {
  const home = process.env.OPENDEPLOY_HOME ?? join(homedir(), '.opendeploy');
  return join(home, 'settings.json');
}

export async function loadSettings(): Promise<AppSettings> {
  const path = getSettingsPath();
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const path = getSettingsPath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(settings, null, 2), 'utf-8');
}
