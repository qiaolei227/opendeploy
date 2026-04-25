import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnthropicClient } from '../../src/main/llm/anthropic-client';

function mockFetchStream(chunks: string[]) {
  return vi.fn(async () => {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
        else controller.close();
      }
    });
    return new Response(stream, { status: 200 });
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('Anthropic client', () => {
  it('streams text deltas from content_block_delta events', async () => {
    const fetch = mockFetchStream([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n',
      'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);
    const client = createAnthropicClient({ baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({
      providerId: 'claude', apiKey: 'sk-ant',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    })) events.push(e);

    expect(events.slice(0, 2)).toEqual([
      { type: 'delta', content: 'Hi' },
      { type: 'delta', content: ' there' }
    ]);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('emits error on non-200', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"invalid"}}', { status: 400 }));
    const client = createAnthropicClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({ providerId: 'claude', apiKey: 'bad', messages: [] })) events.push(e);
    expect(events[0]).toMatchObject({ type: 'error' });
  });

  // ─── Extended thinking (Claude Opus 4.7 adaptive / Sonnet 4.6 extended) ───

  it('emits reasoning_delta + reasoning_signature from thinking content blocks', async () => {
    const fetch = mockFetchStream([
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"用户要加字段"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":",先列扩展。"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"先看扩展"}}\n\n',
      'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);
    const client = createAnthropicClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({
      providerId: 'claude', apiKey: 'k',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    })) events.push(e);
    expect(events).toContainEqual({ type: 'reasoning_delta', content: '用户要加字段' });
    expect(events).toContainEqual({ type: 'reasoning_delta', content: ',先列扩展。' });
    expect(events).toContainEqual({ type: 'reasoning_signature', signature: 'sig-abc' });
    expect(events).toContainEqual({ type: 'delta', content: '先看扩展' });
  });

  it('request body carries thinking block on assistant messages with reasoningContent + signature', async () => {
    let capturedBody: unknown = null;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
          c.close();
        }
      });
      return new Response(stream, { status: 200 });
    });
    const client = createAnthropicClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    for await (const _ of client.stream({
      providerId: 'claude', apiKey: 'k',
      messages: [
        { id: 'u', role: 'user', content: 'hi', createdAt: '' },
        {
          id: 'a',
          role: 'assistant',
          content: '先列扩展',
          reasoningContent: '用户要加字段,先侦察。',
          reasoningSignature: 'sig-xyz',
          createdAt: ''
        }
      ]
    })) { /* drain */ }
    const body = capturedBody as { messages: Array<{ role: string; content: unknown }> };
    const assistantMsg = body.messages.find((m) => m.role === 'assistant');
    expect(Array.isArray(assistantMsg?.content)).toBe(true);
    const blocks = assistantMsg!.content as Array<Record<string, unknown>>;
    const thinkingBlock = blocks.find((b) => b.type === 'thinking');
    expect(thinkingBlock).toEqual({
      type: 'thinking',
      thinking: '用户要加字段,先侦察。',
      signature: 'sig-xyz'
    });
    const textBlock = blocks.find((b) => b.type === 'text');
    expect(textBlock).toEqual({ type: 'text', text: '先列扩展' });
  });

  it('emits usage event whenever message_delta carries cumulative output_tokens', async () => {
    const fetch = mockFetchStream([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":null},"usage":{"output_tokens":7}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);
    const client = createAnthropicClient({ baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({
      providerId: 'claude', apiKey: 'sk-ant',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    })) events.push(e);

    // Expect 2 usage events with cumulative outputTokens, in order
    const usageEvents = events.filter((e: any) => e.type === 'usage');
    expect(usageEvents).toEqual([
      { type: 'usage', outputTokens: 7 },
      { type: 'usage', outputTokens: 15 }
    ]);
    // Done still carries total in usage (existing contract preserved)
    const doneEvent = events.find((e: any) => e.type === 'done') as any;
    expect(doneEvent).toBeDefined();
    expect(doneEvent.usage.outputTokens).toBe(15);
  });

  it('assistant message without reasoningContent keeps content as plain string (backward compat)', async () => {
    let capturedBody: unknown = null;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        pull(c) { c.enqueue(encoder.encode('event: message_stop\ndata: {}\n\n')); c.close(); }
      });
      return new Response(stream, { status: 200 });
    });
    const client = createAnthropicClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    for await (const _ of client.stream({
      providerId: 'claude', apiKey: 'k',
      messages: [
        { id: 'u', role: 'user', content: 'hi', createdAt: '' },
        { id: 'a', role: 'assistant', content: 'plain reply', createdAt: '' }
      ]
    })) { /* drain */ }
    const body = capturedBody as { messages: Array<{ role: string; content: unknown }> };
    const assistantMsg = body.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('plain reply');
  });
});
