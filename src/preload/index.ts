import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, IpcApi, LlmChatRequest, LlmStreamEvent } from '@shared/types';

const api: IpcApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  setWindowTitle: (title: string) => ipcRenderer.invoke('app:set-window-title', title),
  llmSendMessage: (req: LlmChatRequest) => ipcRenderer.invoke('llm:send', req),
  llmOnStream: (cb: (ev: LlmStreamEvent) => void) => {
    const listener = (_event: unknown, ev: LlmStreamEvent) => cb(ev);
    ipcRenderer.on('llm:stream', listener);
    return () => ipcRenderer.removeListener('llm:stream', listener);
  },
  conversationsList: () => ipcRenderer.invoke('conversations:list'),
  conversationsLoad: (id: string) => ipcRenderer.invoke('conversations:load', id)
};

contextBridge.exposeInMainWorld('opendeploy', api);
