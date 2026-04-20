/// <reference types="node" />

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
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  knowledgeSources: []
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
  skillsList: () => Promise<SkillMeta[]>;
  skillsLoad: (id: string) => Promise<LoadedSkill>;
  skillsInstall: (source: KnowledgeSource) => Promise<void>;
  skillsCheckUpdates: (source: KnowledgeSource) => Promise<{ local: string | null; remote: string }>;
  skillsRemoveAll: () => Promise<void>;
}
