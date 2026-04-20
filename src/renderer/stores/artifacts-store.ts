import { create } from 'zustand';
import { makeId } from '@shared/id';
import { WRITE_PLUGIN_TOOL_NAME } from '@shared/plugin-types';

/**
 * A single file the agent produced in the *current* conversation. Not backed
 * by disk scans — the artifacts panel is scoped to "things this chat made",
 * so clearing the chat or starting a new conversation wipes it.
 */
export interface Artifact {
  id: string;
  kind: 'plugin';
  projectId: string;
  filename: string;
  path: string;
  createdAt: string;
  lines: number;
  /** True for a brand-new file; false when this call overwrote an existing one. */
  created: boolean;
}

interface ArtifactsState {
  items: Artifact[];
  /** Called by chat-store at tool_result time. No-op unless the tool is one we track. */
  addFromToolResult: (toolName: string, resultJson: string) => void;
  clear: () => void;
}

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  items: [],

  addFromToolResult: (toolName, resultJson) => {
    if (toolName !== WRITE_PLUGIN_TOOL_NAME) return;
    let parsed: {
      created?: boolean;
      path?: string;
      filename?: string;
      lines?: number;
      projectId?: string;
    };
    try {
      parsed = JSON.parse(resultJson);
    } catch {
      return; // malformed — silently drop rather than disrupt the chat UI
    }
    if (!parsed.filename || !parsed.path || !parsed.projectId) return;

    const items = [...get().items];
    // Replace same-path entries so repeated writes to one file show a single
    // row, not duplicates.
    const existingIdx = items.findIndex((a) => a.path === parsed.path);
    const next: Artifact = {
      id: existingIdx >= 0 ? items[existingIdx].id : makeId('a'),
      kind: 'plugin',
      projectId: parsed.projectId,
      filename: parsed.filename,
      path: parsed.path,
      createdAt: new Date().toISOString(),
      lines: parsed.lines ?? 0,
      created: parsed.created ?? true
    };
    if (existingIdx >= 0) {
      items[existingIdx] = next;
    } else {
      items.push(next);
    }
    set({ items });
  },

  clear: () => set({ items: [] })
}));
