import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../../src/main/llm/sse';

async function* chunkStream(chunks: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for (const c of chunks) yield encoder.encode(c);
}

describe('parseSseStream', () => {
  it('parses single SSE event', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream(['data: {"text":"hi"}\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"text":"hi"}']);
  });

  it('handles split events across chunks', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream(['data: {"te', 'xt":"ok"}\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"text":"ok"}']);
  });

  it('ignores [DONE] sentinel', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream(['data: {"a":1}\n\ndata: [DONE]\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"a":1}']);
  });

  it('skips non-data SSE lines', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream([': keep-alive\n\ndata: {"ok":true}\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"ok":true}']);
  });
});
