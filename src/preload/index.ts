import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, IpcApi } from '@shared/types';

const api: IpcApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke('settings:save', settings),
  getPlatform: () => ipcRenderer.invoke('app:platform')
};

contextBridge.exposeInMainWorld('opendeploy', api);
