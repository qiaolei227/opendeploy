/// <reference types="node" />

import type { ErpConnectionState, Project } from './erp-types';
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
  /**
   * 每个 provider 当前生效的接入模式 (`'payg'` 按量 / `'plan'` 包月套餐).
   * 缺省视为 `'payg'`,完全向后兼容存量用户。只有 `PROVIDER_CONFIGS[id].tokenPlan`
   * 存在的厂家 UI 才暴露切换控件,其余 provider 这个字段不读不写。
   */
  apiAccessMode?: Record<string, 'payg' | 'plan'>;
  /**
   * Token Plan / Coding Plan 专用 API Key (例如小米 `tp-xxxx`,与按量 `sk-xxxx` 独立)。
   * 跟 `apiKeys` 平行存储,允许用户同时保留两套 key 方便切 mode 不重填。
   */
  planApiKeys?: Record<string, string>;
  /**
   * 高级:per-provider base URL 覆盖。非空时无视 `apiAccessMode` 直接打这个 URL,
   * 用于走企业代理 / 第三方网关 / 不规则厂家接入端点。优先级最高。
   */
  apiBaseUrlOverride?: Record<string, string>;
  /** Ollama 自定义模型名 (用户在 Settings 输入框填的). 缺省走 PROVIDERS.find(ollama).modelInputDefault. */
  ollamaModelInput?: string;
  /** User-configured knowledge sources (github / gitee / local). Defaults to empty. */
  knowledgeSources?: KnowledgeSource[];
  /** Projects configured by the user. Each owns its own ERP connection config. */
  projects?: Project[];
  /** Id of the project whose connection pool drives agent metadata queries. */
  activeProjectId?: string;
  /**
   * Plan 5.13 — write each LLM turn's full request body + SSE chunks to
   * `logs/raw-llm/<convId>/turn-NNN.{req,res}.{json,txt}` for postmortem.
   * Defaults to `true` (single-machine community edition: business data
   * never leaves the user's box, so dumping is fine and helps diagnosis).
   * Enterprise edition (MVP-3+) flips this default to false and adds
   * redact / audit layers. Authorization headers are always redacted to
   * `***` regardless — defense against screen-share / issue-paste leaks.
   */
  llmRawDump?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  knowledgeSources: [],
  projects: [],
  llmRawDump: true
};

export interface LlmChatRequest {
  conversationId?: string;
  providerId: string;
  apiKey?: string;
  /** Model id override. 缺省时 client 端用 PROVIDER_CONFIGS[providerId].defaultModel. */
  model?: string;
  /**
   * 'payg' (按量) / 'plan' (Token Plan 包月)。缺省 = 'payg',main 端按此切 baseUrl。
   * 渲染端从 `settings.apiAccessMode[providerId]` 读出后随请求下传,避免 main 端
   * 反查 settings 引入第二个真实来源。
   */
  accessMode?: 'payg' | 'plan';
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
  /** Frameless-window captions (rendered by the in-app TitleBar). */
  winMinimize: () => Promise<void>;
  winToggleMaximize: () => Promise<void>;
  winClose: () => Promise<void>;
  winIsMaximized: () => Promise<boolean>;
  /** Subscribe to maximize/unmaximize pushes; returns an unsubscribe fn. */
  winOnMaximized: (cb: (maximized: boolean) => void) => () => void;
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
  /**
   * Pre-login data-center discovery — given only a K/3 Cloud server URL,
   * fetch the list of account-sets the server hosts. Mirrors BOS Designer's
   * flow (URL → pick account-set → credentials). No auth required.
   */
  projectsListDataCenters: (
    baseUrl: string
  ) => Promise<Array<{ id: string; number: string; name: string }>>;
  projectsConnectionState: () => Promise<ErpConnectionState>;
  /** Subscribe to live connection-state changes. Returns an unsubscribe fn. */
  erpOnConnectionState: (cb: (s: ErpConnectionState) => void) => () => void;
  /**
   * Submit the CAPTCHA code the user typed. Only valid while the connection
   * state is `'captcha-required'`. Resolves whether the code was accepted or
   * rejected — outcomes flow back through the `erp:connection-state` event
   * (status transitions to `'connected'`, stays `'captcha-required'` with a
   * new image on wrong/expired, or transitions to `'error'`).
   */
  projectsSubmitCaptcha: (code: string) => Promise<void>;
  /** Rotate the CAPTCHA image. Only valid in `'captcha-required'` state. */
  projectsRefreshCaptcha: () => Promise<void>;

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
