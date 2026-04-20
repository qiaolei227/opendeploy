import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOpenAiClient } from '../../src/main/llm/openai-client';
import type { ChatRequest } from '../../src/shared/llm-types';

// Minimal fetch mock returning streaming SSE
function mockFetchStream(chunks: string[]) {
  return vi.fn(async (_url: string, _init: RequestInit) => {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i++]));
        } else {
          controller.close();
        }
      }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('OpenAI-compatible client', () => {
  it('streams text deltas', async () => {
    const fetch = mockFetchStream([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n'
    ]);
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const req: ChatRequest = {
      providerId: 'test', apiKey: 'sk-test',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    };
    const events: unknown[] = [];
    for await (const e of client.stream(req)) events.push(e);

    expect(events).toEqual([
      { type: 'delta', content: 'Hello ' },
      { type: 'delta', content: 'world' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }
    ]);
  });

  it('emits tool_call event', async () => {
    const fetch = mockFetchStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_time","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ]);
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const req: ChatRequest = {
      providerId: 'test', apiKey: 'sk',
      messages: [{ id: '1', role: 'user', content: 'what time', createdAt: '' }]
    };
    const events: unknown[] = [];
    for await (const e of client.stream(req)) events.push(e);

    expect(events[0]).toEqual({
      type: 'tool_call',
      toolCall: { id: 'c1', name: 'get_time', arguments: {} }
    });
  });

  it('emits error event on non-200 response', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({ providerId: 't', apiKey: 'bad', messages: [] })) events.push(e);
    expect(events[0]).toMatchObject({ type: 'error' });
  });
});
