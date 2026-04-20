import { create } from 'zustand';
import type {
  ErpConnectionState,
  K3CloudConnectionConfig,
  Project,
  TestConnectionResult
} from '@shared/erp-types';

export type NewProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;

interface ProjectsState {
  projects: Project[];
  connectionState: ErpConnectionState;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (input: NewProjectInput) => Promise<Project>;
  update: (id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  testConnection: (config: K3CloudConnectionConfig) => Promise<TestConnectionResult>;

  /** Wire the live erp:connection-state listener. Idempotent — call once from App.tsx. */
  subscribeConnection: () => void;
  clearError: () => void;
}

let connectionUnsub: (() => void) | null = null;

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  connectionState: { projectId: null, status: 'idle' },
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [projects, connectionState] = await Promise.all([
        window.opendeploy.projectsList(),
        window.opendeploy.projectsConnectionState()
      ]);
      set({ projects, connectionState, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  create: async (input) => {
    const project = await window.opendeploy.projectsCreate(input);
    set({ projects: [...get().projects, project] });
    return project;
  },

  update: async (id, patch) => {
    const updated = await window.opendeploy.projectsUpdate(id, patch);
    set({
      projects: get().projects.map((p) => (p.id === id ? updated : p))
    });
    return updated;
  },

  remove: async (id) => {
    await window.opendeploy.projectsDelete(id);
    set({
      projects: get().projects.filter((p) => p.id !== id)
    });
  },

  setActive: async (id) => {
    await window.opendeploy.projectsSetActive(id);
    // connectionState will update via the subscription; no need to refetch here.
  },

  testConnection: async (config) => window.opendeploy.projectsTestConnection(config),

  subscribeConnection: () => {
    if (connectionUnsub) return;
    connectionUnsub = window.opendeploy.erpOnConnectionState((s) => {
      set({ connectionState: s });
    });
  },

  clearError: () => set({ error: null })
}));
