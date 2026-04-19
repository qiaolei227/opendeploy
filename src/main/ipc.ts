import { ipcMain } from 'electron';
import { loadSettings, saveSettings } from './settings';
import type { AppSettings } from '@shared/types';

export function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', async () => {
    return await loadSettings();
  });

  ipcMain.handle(
    'settings:save',
    async (_event, settings: AppSettings) => {
      await saveSettings(settings);
    }
  );

  ipcMain.handle('app:platform', () => {
    return process.platform;
  });
}
