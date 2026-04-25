import { create } from 'zustand';
import type { LlmStreamEvent } from '@shared/types';
import { makeId } from '@shared/id';
import { useArtifactsStore } from './artifacts-store';
import {
  appendTextDelta,
  appendToolUse,
  reconstructBlocksFromLegacy,
  type MessageBlock
} from '@shared/blocks';

export type { MessageBlock } from '@shared/blocks';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
    result?: string;
    /** ms since epoch — set when tool_call event arrives, drives elapsed time UI. */
    startedAt?: number;
  }>;
  /**
   * Ordered stream of text and tool_use blocks as they arrived. When present,
   * the renderer iterates this instead of rendering content + toolCalls
   * separately — preserves the "said X, did tool, said Y" causal order the
   * user sees in Claude Code. Legacy messages (persisted before blocks
   * existed) have this reconstructed at load time from content + toolCalls.
   */
  blocks?: MessageBlock[];
  isStreaming?: boolean;
  /** 文字 delta 累计缓冲 — 在 tool_call / done 时 flush 成 blocks 里的 text block。
   *  Streaming 期间 UI 不渲染这段文字本身,只用 pendingTokens 显示进度。 */
  pendingText?: string;
  /** Streaming 期间累计的 output token 估算/精确数。delta 事件按 +1 估算;
   *  usage 事件到达时替换为 provider 给的精确值。 */
  pendingTokens?: number;
  /** True 表示 pendingTokens 来自 provider 的 usage event (精确), false / 缺失
   *  表示按 delta 事件估算 (UI 加 `~` 前缀)。 */
  tokensExact?: boolean;
  createdAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  currentRequestId: string | null;
  conversationId: string | null;

  sendMessage: (text: string, providerId: string, apiKey: string | undefined) => Promise<void>;
  abort: () => Promise<void>;
  clear: () => void;
  loadConversation: (id: string) => Promise<void>;
}

const makeChatId = () => makeId('c');

/**
 * Commit a streaming message's pendingText into its blocks/content as a
 * single text block, then clear the pending fields. Called on tool_call /
 * done boundaries. Returns the original message unchanged (identity) when
 * there's nothing to flush.
 *
 * NOTE: error / abort paths do NOT currently flush — pendingText is
 * discarded along with the streaming state. Acceptable for v0.1 since the
 * partial mid-stream text was never user-visible (UI shows token counter,
 * not the buffer). Revisit if we ever start surfacing partial responses.
 */
export function flushPendingText(msg: ChatMessage): ChatMessage {
  if (!msg.pendingText) return msg;
  return {
    ...msg,
    content: msg.content + msg.pendingText,
    blocks: appendTextDelta(msg.blocks ?? [], msg.pendingText),
    pendingText: undefined,
    pendingTokens: undefined,
    tokensExact: undefined
  };
}

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
      id: makeChatId(), role: 'assistant', content: '', blocks: [], isStreaming: true, createdAt: new Date().toISOString()
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
          msgs[msgs.length - 1] = {
            ...last,
            pendingText: (last.pendingText ?? '') + ev.content,
            // tokensExact frozen → don't tick estimate; provider's usage value wins
            ...(last.tokensExact ? {} : { pendingTokens: (last.pendingTokens ?? 0) + 1 })
          };
          set({ messages: msgs });
        }
      } else if (ev.type === 'tool_call') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          const flushed = flushPendingText(last);
          const callId = ev.toolCallId ?? '?';
          msgs[msgs.length - 1] = {
            ...flushed,
            toolCalls: [
              ...(flushed.toolCalls ?? []),
              {
                id: callId,
                name: ev.toolCallName ?? '?',
                args: ev.toolCallArgs ?? '',
                startedAt: Date.now()
              }
            ],
            blocks: appendToolUse(flushed.blocks ?? [], callId)
          };
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
      } else if (ev.type === 'usage') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = {
            ...last,
            pendingTokens: ev.outputTokens ?? last.pendingTokens,
            tokensExact: true
          };
          set({ messages: msgs });
        }
      } else if (ev.type === 'done') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last) {
          // flushPendingText 短路掉无 pendingText 的消息(只调工具的 turn),
          // 但 pendingTokens / tokensExact 可能因 usage 事件先到而残留 ——
          // done 时无条件清掉避免数据残留(纯卫生,UI 不显示也无害)。
          const flushed = flushPendingText(last);
          msgs[msgs.length - 1] = {
            ...flushed,
            isStreaming: false,
            pendingTokens: undefined,
            tokensExact: undefined
          };
        }
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

  abort: async () => {
    const id = get().currentRequestId;
    if (!id) return;
    await window.opendeploy.llmAbort(id);
    // We don't clear isStreaming here — the main process will emit 'done'
    // (or 'error') after the abort lands, and the existing handler picks
    // it up. That keeps the streaming-cursor / button states consistent
    // with the actual stream lifecycle.
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
        if (m.role === 'assistant') {
          const toolCalls = (m.toolCalls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: JSON.stringify(tc.arguments),
            result: toolResultById.get(tc.id)
          }));
          if (toolCalls.length > 0) base.toolCalls = toolCalls;
          // Prefer persisted stream order; fall back to "text first then
          // all tools" for conversations saved before blocks support.
          base.blocks = m.blocks && m.blocks.length > 0
            ? m.blocks
            : reconstructBlocksFromLegacy(m.content, toolCalls.map((tc) => ({ id: tc.id })));
        }
        return base;
      });
    set({ messages, conversationId: conv.id, error: null, isStreaming: false });
  }
}));
