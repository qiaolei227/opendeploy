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
  /** Bundle-level version read from `manifest.json`. Distinct from any individual skill's version. */
  bundleVersion: string | null;
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

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: [],
  bundleVersion: null,
  loading: false,
  error: null,
  updateStatus: 'idle',
  remoteVersion: null,
  lastCheckedAt: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [skills, bundleVersion] = await Promise.all([
        window.opendeploy.skillsList(),
        window.opendeploy.skillsBundleVersion()
      ]);
      set({ skills, bundleVersion, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  checkUpdates: async () => {
    set({ updateStatus: 'checking', error: null });
    try {
      const r = await window.opendeploy.skillsCheckUpdatesDefaults();
      // r.local comes straight from manifest.json — trust it and mirror into state
      // so the hero card uses the same value for both sides of the comparison.
      const isNewer = r.remote !== r.local;
      set({
        updateStatus: isNewer ? 'available' : 'up-to-date',
        bundleVersion: r.local,
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
      const [skills, bundleVersion] = await Promise.all([
        window.opendeploy.skillsList(),
        window.opendeploy.skillsBundleVersion()
      ]);
      set({
        skills,
        bundleVersion,
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
      const [skills, bundleVersion] = await Promise.all([
        window.opendeploy.skillsList(),
        window.opendeploy.skillsBundleVersion()
      ]);
      set({ skills, bundleVersion, updateStatus: 'idle' });
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
      set({
        skills: [],
        bundleVersion: null,
        updateStatus: 'idle',
        remoteVersion: null
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  clearError: () => set({ error: null })
}));
