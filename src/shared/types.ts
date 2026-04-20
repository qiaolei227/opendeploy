/// <reference types="node" />

import type {
  ErpConnectionState,
  K3CloudConnectionConfig,
  Project,
  TestConnectionResult
} from './erp-types';
import type { PluginFile, PluginWriteResult } from './plugin-types';
import type { KnowledgeSource, LoadedSkill, SkillMeta } from './skill-types';

export type Language = 'zh-CN' | 'en-US';
export type Theme = 'light' | 'dark' | 'system';

export interface AppSettings {
  language: Language;
  theme: Theme;
  llmProvider?: string;
  apiKeys?: Record<string, string>;
  /** User-configured knowledge sources (github / gitee / local). Defaults to empty. */
  knowledgeSources?: KnowledgeSource[];
  /** Projects configured by the user. Each owns its own ERP connection config. */
  projects?: Project[];
  /** Id of the project whose connection pool drives agent metadata queries. */
  activeProjectId?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  knowledgeSources: [],
  projects: []
};

export interface LlmChatRequest {
  conversationId?: string;
  providerId: string;
  apiKey?: string;
  userMessage: string;
}

export interface LlmStreamEvent {
  requestId: string;
  type: 'delta' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  toolCallName?: string;
  toolCallArgs?: string;
  error?: string;
}

export interface IpcApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getPlatform: () => Promise<NodeJS.Platform>;
  setWindowTitle: (title: string) => Promise<void>;
  llmSendMessage: (req: LlmChatRequest) => Promise<{ requestId: string }>;
  llmOnStream: (cb: (ev: LlmStreamEvent) => void) => () => void;
  conversationsList: () => Promise<Array<{ id: string; title: string; savedAt: string; messageCount: number }>>;
  conversationsLoad: (id: string) => Promise<{ id: string; title: string; messages: Array<{ id: string; role: string; content: string; createdAt: string }> }>;
  conversationsDelete: (id: string) => Promise<void>;
  skillsList: () => Promise<SkillMeta[]>;
  skillsLoad: (id: string) => Promise<LoadedSkill>;
  skillsInstall: (source: KnowledgeSource) => Promise<void>;
  skillsCheckUpdates: (source: KnowledgeSource) => Promise<{ local: string | null; remote: string }>;
  skillsRemoveAll: () => Promise<void>;
  skillsInstallDefaults: () => Promise<{ sourceId: string }>;
  skillsCheckUpdatesDefaults: () => Promise<{
    sourceId: string;
    local: string | null;
    remote: string;
  }>;
  /** Returns the bundle-level version from the local manifest.json, or null when nothing is installed. */
  skillsBundleVersion: () => Promise<string | null>;

  // ─── Projects & ERP connection ─────────────────────────────────────
  projectsList: () => Promise<Project[]>;
  projectsCreate: (input: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Project>;
  projectsUpdate: (
    id: string,
    patch: Partial<Omit<Project, 'id' | 'createdAt'>>
  ) => Promise<Project>;
  projectsDelete: (id: string) => Promise<void>;
  projectsSetActive: (id: string | null) => Promise<void>;
  projectsTestConnection: (config: K3CloudConnectionConfig) => Promise<TestConnectionResult>;
  projectsConnectionState: () => Promise<ErpConnectionState>;
  /** Subscribe to live connection-state changes. Returns an unsubscribe fn. */
  erpOnConnectionState: (cb: (s: ErpConnectionState) => void) => () => void;

  // ─── Plugin artifacts ──────────────────────────────────────────────
  pluginsList: (projectId: string) => Promise<PluginFile[]>;
  pluginsRead: (projectId: string, name: string) => Promise<string>;
  pluginsWrite: (
    projectId: string,
    name: string,
    content: string
  ) => Promise<PluginWriteResult>;
  pluginsDelete: (projectId: string, name: string) => Promise<void>;
}
