import { create } from 'zustand';
import type { KnowledgeSource, SkillMeta } from '@shared/skill-types';

/**
 * UpdateStatus models the hero card state machine on the Skills page.
 *
 *   idle          — nothing in flight; version badge is whatever's on disk
 *   checking      — hitting the remote manifest
 *   available     — remote has a newer version than local
 *   up-to-date    — remote version matches local; green confirmation
 *   installing    — downloading + verifying the bundle
 *   error         — last check/install failed; `error` field carries details
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'installing'
  | 'error';

interface SkillsState {
  skills: SkillMeta[];
  loading: boolean;
  error: string | null;

  updateStatus: UpdateStatus;
  remoteVersion: string | null;
  lastCheckedAt: string | null; // ISO timestamp

  load: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;

  /** Advanced: used by the hidden custom-source form / automated tests. */
  installFrom: (source: KnowledgeSource) => Promise<void>;
  removeAll: () => Promise<void>;
  clearError: () => void;
}

function currentVersionOf(skills: SkillMeta[]): string | null {
  // The registry doesn't read manifest.json directly; we read bundle version
  // lazily from the first skill's version as a rough proxy until we wire a
  // dedicated IPC. For MVP that's enough to drive badge state.
  return skills[0]?.version ?? null;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  loading: false,
  error: null,
  updateStatus: 'idle',
  remoteVersion: null,
  lastCheckedAt: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const skills = await window.opendeploy.skillsList();
      set({ skills, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  checkUpdates: async () => {
    set({ updateStatus: 'checking', error: null });
    try {
      const r = await window.opendeploy.skillsCheckUpdatesDefaults();
      const localGuess = currentVersionOf(get().skills);
      const isNewer = r.remote !== (r.local ?? localGuess);
      set({
        updateStatus: isNewer ? 'available' : 'up-to-date',
        remoteVersion: r.remote,
        lastCheckedAt: new Date().toISOString()
      });
    } catch (err) {
      set({
        updateStatus: 'error',
        error: err instanceof Error ? err.message : String(err),
        lastCheckedAt: new Date().toISOString()
      });
    }
  },

  installUpdate: async () => {
    set({ updateStatus: 'installing', error: null });
    try {
      await window.opendeploy.skillsInstallDefaults();
      const skills = await window.opendeploy.skillsList();
      set({
        skills,
        updateStatus: 'up-to-date',
        lastCheckedAt: new Date().toISOString()
      });
    } catch (err) {
      set({
        updateStatus: 'error',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  },

  installFrom: async (source) => {
    set({ updateStatus: 'installing', error: null });
    try {
      await window.opendeploy.skillsInstall(source);
      const skills = await window.opendeploy.skillsList();
      set({ skills, updateStatus: 'idle' });
    } catch (err) {
      set({
        updateStatus: 'error',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  },

  removeAll: async () => {
    set({ error: null });
    try {
      await window.opendeploy.skillsRemoveAll();
      set({ skills: [], updateStatus: 'idle', remoteVersion: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  clearError: () => set({ error: null })
}));
