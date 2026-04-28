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
import { getDataCenterList } from './erp/k3cloud/rpc/data-center';
import type { ErpConnectionState, Project } from '@shared/erp-types';

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

  ipcMain.handle('projects:connection-state', async () => getConnectionState());

  // Pre-login data-center discovery — replicates BOS Designer's flow where
  // the user enters only a server URL and the client fetches available
  // account-sets before asking for credentials. Returns whatever the K/3
  // Cloud Web Server publishes (no auth needed). Errors propagate via
  // ipc rejection — renderer wraps them in a user-facing message.
  ipcMain.handle(
    'projects:list-data-centers',
    async (_e, baseUrl: string) => getDataCenterList(baseUrl)
  );
}
