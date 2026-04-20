import { create } from 'zustand';

/**
 * A single file the agent produced in the *current* conversation. Not backed
 * by disk scans — the artifacts panel is scoped to "things this chat made",
 * so clearing the chat or starting a new conversation wipes it.
 */
export interface Artifact {
  /** Synthetic id — agent tool_call id isn't reliably surfaced to the renderer. */
  id: string;
  kind: 'plugin';
  projectId: string;
  filename: string;
  path: string;
  createdAt: string;
  lines: number;
  size: number;
  /** True for a brand-new file; false when this call overwrote an existing one. */
  created: boolean;
}

interface ArtifactsState {
  items: Artifact[];
  /** Called by chat-store at tool_result time. No-op unless the tool is one we track. */
  addFromToolResult: (toolName: string, resultJson: string) => void;
  clear: () => void;
}

function makeId(): string {
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  items: [],

  addFromToolResult: (toolName, resultJson) => {
    if (toolName !== 'write_plugin') return;
    let parsed: {
      created?: boolean;
      path?: string;
      filename?: string;
      lines?: number;
      size?: number;
      projectId?: string;
    };
    try {
      parsed = JSON.parse(resultJson);
    } catch {
      return; // malformed — silently drop rather than disrupt the chat UI
    }
    if (!parsed.filename || !parsed.path || !parsed.projectId) return;

    const items = [...get().items];
    // Replace an existing entry with the same path (agent overwrote the same file
    // mid-conversation) rather than showing the same filename twice.
    const existingIdx = items.findIndex((a) => a.path === parsed.path);
    const next: Artifact = {
      id: existingIdx >= 0 ? items[existingIdx].id : makeId(),
      kind: 'plugin',
      projectId: parsed.projectId,
      filename: parsed.filename,
      path: parsed.path,
      createdAt: new Date().toISOString(),
      lines: parsed.lines ?? 0,
      size: parsed.size ?? 0,
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
