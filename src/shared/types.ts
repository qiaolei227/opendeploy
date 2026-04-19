/// <reference types="node" />

export type Language = 'zh-CN' | 'en-US';
export type Theme = 'light' | 'dark' | 'system';

export interface AppSettings {
  language: Language;
  theme: Theme;
  llmProvider?: string;
  apiKeys?: Record<string, string>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'system'
};

export interface IpcApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getPlatform: () => Promise<NodeJS.Platform>;
}
