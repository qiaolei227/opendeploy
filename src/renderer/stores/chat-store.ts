import { create } from 'zustand';
import type { LlmStreamEvent } from '@shared/types';
import { makeId } from '@shared/id';
import { useArtifactsStore } from './artifacts-store';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: string; result?: string }>;
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
          const tcs = [
            ...(last.toolCalls ?? []),
            {
              id: ev.toolCallId ?? '?',
              name: ev.toolCallName ?? '?',
              args: ev.toolCallArgs ?? ''
            }
          ];
          msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
          set({ messages: msgs });
        }
      } else if (ev.type === 'tool_result') {
        // Match by toolCallId — parallel batches return out of order, so
        // "last in array" would clobber the wrong slot.
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && last.toolCalls && last.toolCalls.length > 0) {
          const tcs = [...last.toolCalls];
          const idx = ev.toolCallId
            ? tcs.findIndex((tc) => tc.id === ev.toolCallId)
            : -1;
          if (idx >= 0) {
            const matched = tcs[idx];
            tcs[idx] = { ...matched, result: ev.content ?? '' };
            msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
            set({ messages: msgs });
            useArtifactsStore.getState().addFromToolResult(matched.name, ev.content ?? '');
          }
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
    // and tool_call_id → result content map across every `tool` role message.
    // The first powers artifacts re-hydration; the second lets us inline
    // each tool call's result back onto the assistant message so the UI
    // shows tool bubbles when switching to historical conversations.
    const toolNameById = new Map<string, string>();
    const toolResultById = new Map<string, string>();
    for (const m of conv.messages) {
      if (m.role === 'assistant' && m.toolCalls) {
        for (const tc of m.toolCalls) toolNameById.set(tc.id, tc.name);
      } else if (m.role === 'tool' && m.toolCallId) {
        toolResultById.set(m.toolCallId, m.content);
      }
    }

    // Re-hydrate the artifacts panel — without this, switching conversations
    // leaves the panel showing the previous chat's files (or empty).
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
      .map((m) => {
        const base: ChatMessage = {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.createdAt
        };
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          base.toolCalls = m.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: JSON.stringify(tc.arguments),
            result: toolResultById.get(tc.id)
          }));
        }
        return base;
      });
    set({ messages, conversationId: conv.id, error: null, isStreaming: false });
  }
}));
