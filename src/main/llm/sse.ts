import { createParser, type EventSourceMessage } from 'eventsource-parser';

export async function* parseSseStream(
  stream: AsyncIterable<Uint8Array>
): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8');
  const events: string[] = [];
  const parser = createParser({
    onEvent(ev: EventSourceMessage) {
      if (!ev.data || ev.data === '[DONE]') return;
      events.push(ev.data);
    }
  });
  for await (const chunk of stream) {
    parser.feed(decoder.decode(chunk, { stream: true }));
    while (events.length > 0) {
      yield events.shift()!;
    }
  }
}
