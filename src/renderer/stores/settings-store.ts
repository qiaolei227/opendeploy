import { create } from 'zustand';
import type { AppSettings, Language, Theme } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setApiKey: (provider: string, key: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await window.opendeploy.getSettings();
    set({ settings, loaded: true });
  },

  setLanguage: async (language) => {
    const next = { ...get().settings, language };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setTheme: async (theme) => {
    const next = { ...get().settings, theme };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setApiKey: async (provider, key) => {
    const current = get().settings;
    const apiKeys = { ...(current.apiKeys ?? {}), [provider]: key };
    const next = { ...current, apiKeys };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  }
}));
