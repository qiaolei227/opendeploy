import { BrowserWindow, ipcMain } from 'electron';
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

  ipcMain.handle('app:set-window-title', (event, title: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setTitle(title);
    }
  });

  // Window controls for the frameless window (see TitleBar / WindowControls).
  ipcMain.handle('win:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('win:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle('win:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('win:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });
}
