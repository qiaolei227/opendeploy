import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushPendingText,
  useChatStore,
  type ChatMessage
} from '../../src/renderer/stores/chat-store';
import type { LlmStreamEvent } from '@shared/types';

// ─── (A) Pure helper tests ─────────────────────────────────────────────

function streamingMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    blocks: [],
    isStreaming: true,
    createdAt: '2026-04-25T00:00:00Z',
    ...overrides
  };
}

describe('flushPendingText', () => {
  it('returns message unchanged when no pendingText', () => {
    const msg = streamingMsg();
    expect(flushPendingText(msg)).toBe(msg); // identity check
  });

  it('appends pendingText to content + blocks then clears pending fields', () => {
    const msg = streamingMsg({
      content: 'hi ',
      pendingText: 'there',
      pendingTokens: 5,
      tokensExact: false
    });
    const out = flushPendingText(msg);
    expect(out.content).toBe('hi there');
    expect(out.blocks).toEqual([{ type: 'text', text: 'there' }]);
    expect(out.pendingText).toBeUndefined();
    expect(out.pendingTokens).toBeUndefined();
    expect(out.tokensExact).toBeUndefined();
  });

  it('preserves existing blocks when flushing', () => {
    const msg = streamingMsg({
      blocks: [{ type: 'tool_use', callId: 'c1' }],
      pendingText: 'after tool'
    });
    const out = flushPendingText(msg);
    expect(out.blocks).toEqual([
      { type: 'tool_use', callId: 'c1' },
      { type: 'text', text: 'after tool' }
    ]);
  });
});

// ─── (B) Stream-handler integration tests ──────────────────────────────

let streamCallbacks: Array<(ev: LlmStreamEvent) => void> = [];

beforeEach(() => {
  streamCallbacks = [];
  // Stub window.opendeploy on globalThis (renderer code reads window.*)
  (globalThis as any).window = {
    opendeploy: {
      llmOnStream: (cb: (ev: LlmStreamEvent) => void) => {
        streamCallbacks.push(cb);
        return () => {
          streamCallbacks = streamCallbacks.filter((c) => c !== cb);
        };
      },
      llmSendMessage: vi.fn(async () => ({ requestId: 'req-1' })),
      llmAbort: vi.fn()
    }
  };
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    error: null,
    currentRequestId: null,
    conversationId: null
  });
});

afterEach(() => {
  delete (globalThis as any).window;
});

function emit(ev: Omit<LlmStreamEvent, 'requestId'>) {
  for (const cb of streamCallbacks) cb({ requestId: 'req-1', ...ev } as LlmStreamEvent);
}

async function sendAndCaptureStream() {
  const promise = useChatStore.getState().sendMessage('hi', 'claude', 'sk-x');
  // sendMessage subscribes to stream then awaits llmSendMessage. Wait one
  // microtask so the subscribe has registered + currentRequestId set.
  await promise;
}

describe('chat-store text batching', () => {
  it('buffers text deltas in pendingText, does NOT push to blocks/content yet', async () => {
    await sendAndCaptureStream();
    emit({ type: 'delta', content: 'Hi ' });
    emit({ type: 'delta', content: 'there' });
    const last = useChatStore.getState().messages.at(-1)!;
    expect(last.pendingText).toBe('Hi there');
    expect(last.pendingTokens).toBe(2);
    expect(last.tokensExact).toBeFalsy();
    expect(last.content).toBe('');
    expect(last.blocks).toEqual([]);
  });

  it('flushes pendingText to text block on tool_call event AND records startedAt on the call', async () => {
    await sendAndCaptureStream();
    emit({ type: 'delta', content: 'thinking…' });
    const before = Date.now();
    emit({ type: 'tool_call', toolCallId: 'c1', toolCallName: 'kingdee_list_extensions', toolCallArgs: '{}' });
    const after = Date.now();
    const last = useChatStore.getState().messages.at(-1)!;
    expect(last.pendingText).toBeUndefined();
    expect(last.pendingTokens).toBeUndefined();
    expect(last.content).toBe('thinking…');
    expect(last.blocks).toEqual([
      { type: 'text', text: 'thinking…' },
      { type: 'tool_use', callId: 'c1' }
    ]);
    expect(last.toolCalls?.[0].startedAt).toBeGreaterThanOrEqual(before);
    expect(last.toolCalls?.[0].startedAt).toBeLessThanOrEqual(after);
  });

  it('flushes pendingText to text block on done event and stops streaming', async () => {
    await sendAndCaptureStream();
    emit({ type: 'delta', content: 'final answer' });
    emit({ type: 'done' });
    const last = useChatStore.getState().messages.at(-1)!;
    expect(last.pendingText).toBeUndefined();
    expect(last.content).toBe('final answer');
    expect(last.blocks).toEqual([{ type: 'text', text: 'final answer' }]);
    expect(last.isStreaming).toBe(false);
  });

  it('replaces pendingTokens with precise value on usage event; sets tokensExact=true; subsequent deltas no longer increment', async () => {
    await sendAndCaptureStream();
    emit({ type: 'delta', content: 'a' });
    emit({ type: 'delta', content: 'b' });
    emit({ type: 'delta', content: 'c' }); // pendingTokens = 3
    emit({ type: 'usage', outputTokens: 23 });
    const after = useChatStore.getState().messages.at(-1)!;
    expect(after.pendingTokens).toBe(23);
    expect(after.tokensExact).toBe(true);

    emit({ type: 'delta', content: 'd' });
    const later = useChatStore.getState().messages.at(-1)!;
    // tokensExact frozen → don't tick pending estimate; UI keeps showing 23
    // until the next provider usage event (or done), which is the right UX.
    expect(later.pendingTokens).toBe(23);
    expect(later.tokensExact).toBe(true);
  });

  it('ignores usage event with outputTokens=0 (defends against e.g. Ollama with no eval_count)', async () => {
    await sendAndCaptureStream();
    emit({ type: 'delta', content: 'a' });
    emit({ type: 'delta', content: 'b' });
    emit({ type: 'delta', content: 'c' }); // pendingTokens = 3, tokensExact = undefined
    emit({ type: 'usage', outputTokens: 0 });
    const after = useChatStore.getState().messages.at(-1)!;
    // Should NOT clobber the delta estimate, NOT mark exact
    expect(after.pendingTokens).toBe(3);
    expect(after.tokensExact).toBeFalsy();
  });
});
