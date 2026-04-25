import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOllamaClient } from '../../src/main/llm/ollama-client';
import type { ChatRequest } from '../../src/shared/llm-types';

/**
 * Ollama returns ND-JSON (newline-delimited JSON), not SSE. Each line is
 * a complete JSON object; final line has `done: true` plus eval_count etc.
 */
function mockFetchNdJson(lines: string[]) {
  return vi.fn(async () => {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < lines.length) controller.enqueue(encoder.encode(lines[i++] + '\n'));
        else controller.close();
      }
    });
    return new Response(stream, { status: 200 });
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('Ollama client', () => {
  it('streams text deltas from message.content', async () => {
    const fetch = mockFetchNdJson([
      '{"message":{"content":"Hello "}}',
      '{"message":{"content":"world"}}',
      '{"done":true,"prompt_eval_count":5,"eval_count":2}'
    ]);
    const client = createOllamaClient({ baseUrl: 'http://localhost:11434', defaultModel: 'qwen', fetchImpl: fetch });
    const req: ChatRequest = {
      providerId: 'ollama', messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    };
    const events: unknown[] = [];
    for await (const e of client.stream(req)) events.push(e);

    expect(events.slice(0, 2)).toEqual([
      { type: 'delta', content: 'Hello ' },
      { type: 'delta', content: 'world' }
    ]);
  });

  it('emits usage event before done with eval_count value', async () => {
    const fetch = mockFetchNdJson([
      '{"message":{"content":"Hi"}}',
      '{"done":true,"prompt_eval_count":7,"eval_count":42}'
    ]);
    const client = createOllamaClient({ baseUrl: 'http://localhost:11434', defaultModel: 'qwen', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({
      providerId: 'ollama', messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    })) events.push(e);

    expect(events).toEqual([
      { type: 'delta', content: 'Hi' },
      { type: 'usage', outputTokens: 42 },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 7, outputTokens: 42, totalTokens: 49 } }
    ]);
  });

  it('does NOT emit standalone usage event when eval_count is missing (avoids clobbering delta estimate with 0)', async () => {
    const fetch = mockFetchNdJson([
      '{"message":{"content":"Hi"}}',
      '{"done":true}'
    ]);
    const client = createOllamaClient({ baseUrl: 'http://localhost:11434', defaultModel: 'qwen', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({
      providerId: 'ollama', messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    })) events.push(e);

    expect(events.find((e: any) => e.type === 'usage')).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop', usage: { outputTokens: 0 } });
  });

  it('emits error event on non-200 response', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"model not found"}', { status: 404 }));
    const client = createOllamaClient({ baseUrl: 'http://localhost:11434', defaultModel: 'qwen', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({ providerId: 'ollama', messages: [] })) events.push(e);
    expect(events[0]).toMatchObject({ type: 'error' });
  });
});
