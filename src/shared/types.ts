/// <reference types="node" />

import type {
  ErpConnectionState,
  K3CloudDiscoveryConfig,
  ListDatabasesResult,
  Project
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
  /**
   * Identifies which tool call an event belongs to. REQUIRED on `tool_call`
   * (so the renderer can register a slot) and on `tool_result` (so the
   * renderer can fill the matching slot). Without this, parallel tool batches
   * can't bind results to calls — they all clobber the last call's slot.
   */
  toolCallId?: string;
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
  conversationsLoad: (id: string) => Promise<{
    id: string;
    title: string;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
      /** Present on `tool` role messages: the id of the tool call this is responding to. */
      toolCallId?: string;
      /** Present on assistant messages that invoked tools; order matches invocation order. */
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    }>;
  }>;
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
  projectsListDatabases: (config: K3CloudDiscoveryConfig) => Promise<ListDatabasesResult>;
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
