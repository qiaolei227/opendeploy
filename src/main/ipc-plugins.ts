import { ipcMain } from 'electron';
import {
  deletePlugin,
  listPlugins,
  readPlugin,
  writePlugin
} from './plugins/store';

/**
 * Plugin-file IPC. `plugins:write` is registered for completeness (future
 * manual-edit flows) but renderer code today only calls list / read / delete
 * — writes go through the agent's `write_plugin` tool, which runs in the
 * main process already.
 */
export function registerPluginsIpc(): void {
  ipcMain.handle('plugins:list', async (_e, projectId: string) =>
    listPlugins(projectId)
  );
  ipcMain.handle('plugins:read', async (_e, projectId: string, name: string) =>
    readPlugin(projectId, name)
  );
  ipcMain.handle(
    'plugins:write',
    async (_e, projectId: string, name: string, content: string) =>
      writePlugin(projectId, name, content)
  );
  ipcMain.handle(
    'plugins:delete',
    async (_e, projectId: string, name: string) => deletePlugin(projectId, name)
  );
}
