import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { registerLlmIpc } from './ipc-llm';
import { registerSkillIpc } from './ipc-skills';
import { registerProjectsIpc } from './ipc-projects';
import { registerPluginsIpc } from './ipc-plugins';
import { seedOrRefreshKnowledge } from './skills/seed';

// Must run before app `ready` so Electron's userData path uses this name.
app.setName('OpenDeploy');

let mainWin: BrowserWindow | null = null;

app.whenReady().then(async () => {
  registerIpcHandlers();
  registerLlmIpc(() => mainWin);
  registerSkillIpc();
  registerProjectsIpc(() => mainWin);
  registerPluginsIpc();
  await seedOrRefreshKnowledge();
  mainWin = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWin = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
