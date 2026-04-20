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
});
