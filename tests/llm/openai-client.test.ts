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

  // ─── Thinking / reasoning (DeepSeek V4 / Qwen3 / GLM-5.1 / Kimi K2.6 共用协议) ───

  it('emits reasoning_delta when SSE delta carries reasoning_content field', async () => {
    // DeepSeek V4 / Qwen3 thinking / GLM 5.1 / Kimi K2.6 在 OpenAI 兼容流里
    // 都用 delta.reasoning_content 承载 思考内容 (和 delta.content 并列)。
    const fetch = mockFetchStream([
      'data: {"choices":[{"delta":{"reasoning_content":"让我想想..."}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"先列扩展。"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"先看扩展列表。"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      'data: [DONE]\n\n'
    ]);
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({
      providerId: 't', apiKey: 'k',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    })) events.push(e);
    expect(events).toContainEqual({ type: 'reasoning_delta', content: '让我想想...' });
    expect(events).toContainEqual({ type: 'reasoning_delta', content: '先列扩展。' });
    expect(events).toContainEqual({ type: 'delta', content: '先看扩展列表。' });
  });

  it('request body carries reasoning_content on assistant messages when Message.reasoningContent is set', async () => {
    // DeepSeek V4 thinking-mode 多轮调用要求把上一轮的 reasoning_content 回传,
    // 否则 HTTP 400。我们在 assistant message 里挂 reasoningContent, client
    // 负责在请求体里 append 到 messages[].reasoning_content 字段。
    let capturedBody: unknown = null;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
          );
          controller.close();
        }
      });
      return new Response(stream, { status: 200 });
    });
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const req: ChatRequest = {
      providerId: 't', apiKey: 'k',
      messages: [
        { id: 'u', role: 'user', content: 'hi', createdAt: '' },
        {
          id: 'a',
          role: 'assistant',
          content: '先列扩展',
          reasoningContent: '用户要加字段,先侦察扩展列表。',
          createdAt: ''
        }
      ]
    };
    for await (const _ of client.stream(req)) { /* drain */ }
    const body = capturedBody as { messages: Array<Record<string, unknown>> };
    const assistantMsg = body.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.reasoning_content).toBe('用户要加字段,先侦察扩展列表。');
  });

  it('assistant messages without reasoningContent omit reasoning_content from request (backward compat)', async () => {
    let capturedBody: unknown = null;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        pull(c) { c.enqueue(encoder.encode('data: [DONE]\n\n')); c.close(); }
      });
      return new Response(stream, { status: 200 });
    });
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    for await (const _ of client.stream({
      providerId: 't', apiKey: 'k',
      messages: [
        { id: 'u', role: 'user', content: 'hi', createdAt: '' },
        { id: 'a', role: 'assistant', content: 'hello', createdAt: '' }
      ]
    })) { /* drain */ }
    const body = capturedBody as { messages: Array<Record<string, unknown>> };
    const assistantMsg = body.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect('reasoning_content' in assistantMsg!).toBe(false);
  });
});
