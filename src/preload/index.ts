import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, IpcApi, LlmChatRequest, LlmStreamEvent } from '@shared/types';
import type { KnowledgeSource } from '@shared/skill-types';
import type {
  ErpConnectionState,
  K3CloudConnectionConfig,
  Project
} from '@shared/erp-types';

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
  conversationsLoad: (id: string) => ipcRenderer.invoke('conversations:load', id),
  conversationsDelete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsLoad: (id: string) => ipcRenderer.invoke('skills:load', id),
  skillsInstall: (source: KnowledgeSource) => ipcRenderer.invoke('skills:install', source),
  skillsCheckUpdates: (source: KnowledgeSource) =>
    ipcRenderer.invoke('skills:check-updates', source),
  skillsRemoveAll: () => ipcRenderer.invoke('skills:remove-all'),
  skillsInstallDefaults: () => ipcRenderer.invoke('skills:install-defaults'),
  skillsCheckUpdatesDefaults: () => ipcRenderer.invoke('skills:check-updates-defaults'),
  skillsBundleVersion: () => ipcRenderer.invoke('skills:bundle-version'),

  projectsList: () => ipcRenderer.invoke('projects:list'),
  projectsCreate: (input: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) =>
    ipcRenderer.invoke('projects:create', input),
  projectsUpdate: (id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) =>
    ipcRenderer.invoke('projects:update', id, patch),
  projectsDelete: (id: string) => ipcRenderer.invoke('projects:delete', id),
  projectsSetActive: (id: string | null) => ipcRenderer.invoke('projects:set-active', id),
  projectsTestConnection: (config: K3CloudConnectionConfig) =>
    ipcRenderer.invoke('projects:test-connection', config),
  projectsConnectionState: () => ipcRenderer.invoke('projects:connection-state'),
  erpOnConnectionState: (cb: (s: ErpConnectionState) => void) => {
    const listener = (_event: unknown, s: ErpConnectionState) => cb(s);
    ipcRenderer.on('erp:connection-state', listener);
    return () => ipcRenderer.removeListener('erp:connection-state', listener);
  },

  pluginsList: (projectId: string) => ipcRenderer.invoke('plugins:list', projectId),
  pluginsRead: (projectId: string, name: string) =>
    ipcRenderer.invoke('plugins:read', projectId, name),
  pluginsWrite: (projectId: string, name: string, content: string) =>
    ipcRenderer.invoke('plugins:write', projectId, name, content),
  pluginsDelete: (projectId: string, name: string) =>
    ipcRenderer.invoke('plugins:delete', projectId, name)
};

contextBridge.exposeInMainWorld('opendeploy', api);
