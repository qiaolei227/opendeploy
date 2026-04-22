import { create } from 'zustand';
import type { LlmStreamEvent } from '@shared/types';
import { makeId } from '@shared/id';
import { useArtifactsStore } from './artifacts-store';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ name: string; args: string; result?: string }>;
  isStreaming?: boolean;
  createdAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  currentRequestId: string | null;
  conversationId: string | null;

  sendMessage: (text: string, providerId: string, apiKey: string | undefined) => Promise<void>;
  clear: () => void;
  loadConversation: (id: string) => Promise<void>;
}

const makeChatId = () => makeId('c');

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  error: null,
  currentRequestId: null,
  conversationId: null,

  sendMessage: async (text, providerId, apiKey) => {
    const userMsg: ChatMessage = {
      id: makeChatId(), role: 'user', content: text, createdAt: new Date().toISOString()
    };
    const assistantMsg: ChatMessage = {
      id: makeChatId(), role: 'assistant', content: '', isStreaming: true, createdAt: new Date().toISOString()
    };
    set({
      messages: [...get().messages, userMsg, assistantMsg],
      isStreaming: true, error: null
    });

    // Subscribe to stream events (unsubscribe when done)
    const unsubscribe = window.opendeploy.llmOnStream((ev: LlmStreamEvent) => {
      if (ev.requestId !== get().currentRequestId) return;

      if (ev.type === 'delta' && ev.content) {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: last.content + ev.content };
          set({ messages: msgs });
        }
      } else if (ev.type === 'tool_call') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          const tcs = [...(last.toolCalls ?? []), { name: ev.toolCallName ?? '?', args: ev.toolCallArgs ?? '' }];
          msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
          set({ messages: msgs });
        }
      } else if (ev.type === 'tool_result') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && last.toolCalls && last.toolCalls.length > 0) {
          const tcs = [...last.toolCalls];
          const matched = tcs[tcs.length - 1];
          tcs[tcs.length - 1] = { ...matched, result: ev.content ?? '' };
          msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
          set({ messages: msgs });
          // Let the artifacts panel pick up write_plugin results.
          useArtifactsStore.getState().addFromToolResult(matched.name, ev.content ?? '');
        }
      } else if (ev.type === 'done') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last) msgs[msgs.length - 1] = { ...last, isStreaming: false };
        set({ messages: msgs, isStreaming: false, currentRequestId: null });
        unsubscribe();
      } else if (ev.type === 'error') {
        set({ error: ev.error ?? 'Unknown error', isStreaming: false, currentRequestId: null });
        unsubscribe();
      }
    });

    try {
      const { requestId } = await window.opendeploy.llmSendMessage({
        conversationId: get().conversationId ?? undefined,
        providerId, apiKey, userMessage: text
      });
      set({ currentRequestId: requestId, conversationId: get().conversationId ?? requestId });
    } catch (err) {
      unsubscribe();
      set({ error: err instanceof Error ? err.message : String(err), isStreaming: false });
    }
  },

  clear: () => {
    useArtifactsStore.getState().clear();
    set({ messages: [], conversationId: null, error: null });
  },

  loadConversation: async (id) => {
    const conv = await window.opendeploy.conversationsLoad(id);

    // Build tool_call_id → tool name map across every assistant message,
    // then re-hydrate the artifacts panel by walking each `tool` message in
    // order and feeding its content back into addFromToolResult. Without
    // this, switching conversations leaves the artifacts panel showing the
    // PREVIOUS chat's files (or empty, if we came from a fresh session).
    const toolNameById = new Map<string, string>();
    for (const m of conv.messages) {
      if (m.role === 'assistant' && m.toolCalls) {
        for (const tc of m.toolCalls) toolNameById.set(tc.id, tc.name);
      }
    }

    const artifacts = useArtifactsStore.getState();
    artifacts.clear();
    for (const m of conv.messages) {
      if (m.role === 'tool' && m.toolCallId) {
        const name = toolNameById.get(m.toolCallId);
        if (name) artifacts.addFromToolResult(name, m.content);
      }
    }

    const messages: ChatMessage[] = conv.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt
      }));
    set({ messages, conversationId: conv.id, error: null, isStreaming: false });
  }
}));
