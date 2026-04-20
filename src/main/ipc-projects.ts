import { ipcMain, type BrowserWindow } from 'electron';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  setActiveProjectId,
  updateProject,
  type NewProjectInput
} from './projects/store';
import {
  getConnectionState,
  setActiveProject,
  subscribe
} from './erp/active';
import { K3CloudConnector } from './erp/k3cloud/connector';
import type { ErpConnectionState, K3CloudConnectionConfig, Project } from '@shared/erp-types';

/**
 * Projects & live-connection IPC.
 *
 * Broadcasts `erp:connection-state` events to the renderer whenever the
 * active connector's state flips so the StatusBar can update without
 * polling.
 */
export function registerProjectsIpc(getMainWindow: () => BrowserWindow | null): void {
  // Fan out connection-state changes to the renderer.
  subscribe((s: ErpConnectionState) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('erp:connection-state', s);
    }
  });

  ipcMain.handle('projects:list', async () => listProjects());

  ipcMain.handle('projects:create', async (_e, input: NewProjectInput) =>
    createProject(input)
  );

  ipcMain.handle(
    'projects:update',
    async (_e, id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) =>
      updateProject(id, patch)
  );

  ipcMain.handle('projects:delete', async (_e, id: string) => {
    await deleteProject(id);
    // If the deleted project was active, tear down the connector too.
    if (getConnectionState().projectId === id) {
      await setActiveProject(null);
    }
  });

  ipcMain.handle('projects:set-active', async (_e, id: string | null) => {
    if (id === null) {
      await setActiveProjectId(null);
      await setActiveProject(null);
      return;
    }
    const project = await getProject(id);
    if (!project) throw new Error(`unknown project: ${id}`);
    await setActiveProjectId(id);
    await setActiveProject(project);
  });

  ipcMain.handle(
    'projects:test-connection',
    async (_e, config: K3CloudConnectionConfig) => {
      // Dedicated throwaway connector so we don't touch the live active one.
      const probe = new K3CloudConnector(config);
      return probe.testConnection();
    }
  );

  ipcMain.handle('projects:connection-state', async () => getConnectionState());
}
