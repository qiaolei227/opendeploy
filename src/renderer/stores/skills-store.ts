import { create } from 'zustand';
import type { KnowledgeSource, SkillMeta } from '@shared/skill-types';

interface SkillsState {
  skills: SkillMeta[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  lastMessage: string | null;
  load: () => Promise<void>;
  install: (source: KnowledgeSource) => Promise<void>;
  checkUpdates: (source: KnowledgeSource) => Promise<{ local: string | null; remote: string }>;
  removeAll: () => Promise<void>;
  clearMessage: () => void;
}

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: [],
  loading: false,
  busy: false,
  error: null,
  lastMessage: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const skills = await window.opendeploy.skillsList();
      set({ skills, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  install: async (source) => {
    set({ busy: true, error: null, lastMessage: null });
    try {
      await window.opendeploy.skillsInstall(source);
      const skills = await window.opendeploy.skillsList();
      set({ skills, busy: false, lastMessage: 'installed' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), busy: false });
    }
  },

  checkUpdates: async (source) => {
    set({ busy: true, error: null, lastMessage: null });
    try {
      const r = await window.opendeploy.skillsCheckUpdates(source);
      set({ busy: false });
      return r;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), busy: false });
      throw err;
    }
  },

  removeAll: async () => {
    set({ busy: true, error: null, lastMessage: null });
    try {
      await window.opendeploy.skillsRemoveAll();
      set({ skills: [], busy: false, lastMessage: 'removed' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), busy: false });
    }
  },

  clearMessage: () => set({ lastMessage: null, error: null })
}));
