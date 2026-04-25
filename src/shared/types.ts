/// <reference types="node" />

import type {
  ErpConnectionState,
  K3CloudDiscoveryConfig,
  ListDatabasesResult,
  Project
} from './erp-types';
import type { PluginFile, PluginWriteResult } from './plugin-types';
import type { KnowledgeSource, LoadedSkill, SkillMeta } from './skill-types';
import type { MessageBlock } from './blocks';

export type Language = 'zh-CN' | 'en-US';
export type Theme = 'light' | 'dark' | 'system';

export interface AppSettings {
  language: Language;
  theme: Theme;
  llmProvider?: string;
  apiKeys?: Record<string, string>;
  /**
   * 用户在每个 LLM 厂商下选择的具体模型 id (e.g. {deepseek: 'deepseek-v4-pro'}).
   * 缺省时通过 resolveActiveModel 回退到该 provider 的 recommended 模型.
   * Ollama 走 ollamaModelInput 而不是这里 (因为 Ollama 是自由文本).
   */
  modelByProvider?: Record<string, string>;
  /** Ollama 自定义模型名 (用户在 Settings 输入框填的). 缺省走 PROVIDERS.find(ollama).modelInputDefault. */
  ollamaModelInput?: string;
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
  /** Model id override. 缺省时 client 端用 PROVIDER_CONFIGS[providerId].defaultModel. */
  model?: string;
  userMessage: string;
}

export interface LlmStreamEvent {
  requestId: string;
  type:
    | 'delta'
    | 'reasoning_delta'
    | 'reasoning_signature'
    | 'tool_call'
    | 'tool_result'
    | 'usage'
    | 'done'
    | 'error';
  content?: string;
  /** Present on `reasoning_signature` — Anthropic thinking block signature. */
  signature?: string;
  /**
   * Identifies which tool call an event belongs to. REQUIRED on `tool_call`
   * (so the renderer can register a slot) and on `tool_result` (so the
   * renderer can fill the matching slot). Without this, parallel tool batches
   * can't bind results to calls — they all clobber the last call's slot.
   */
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgs?: string;
  /** Present on `usage` events — provider-reported cumulative output tokens. */
  outputTokens?: number;
  error?: string;
}

export interface IpcApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getPlatform: () => Promise<NodeJS.Platform>;
  setWindowTitle: (title: string) => Promise<void>;
  llmSendMessage: (req: LlmChatRequest) => Promise<{ requestId: string }>;
  llmAbort: (requestId: string) => Promise<void>;
  llmOnStream: (cb: (ev: LlmStreamEvent) => void) => () => void;
  conversationsList: () => Promise<Array<{ id: string; title: string; savedAt: string; messageCount: number }>>;
  conversationsLoad: (id: string) => Promise<{
    id: string;
    title: string;
    /** Project this conversation was started under. Absent on legacy files. */
    projectId?: string;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
      /** Present on `tool` role messages: the id of the tool call this is responding to. */
      toolCallId?: string;
      /** Present on assistant messages that invoked tools; order matches invocation order. */
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      /** Present on assistant messages saved after blocks support — ordered stream of text / tool_use. */
      blocks?: MessageBlock[];
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
