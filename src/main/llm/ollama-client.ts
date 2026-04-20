import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { LlmClient } from './types';

interface OllamaOpts {
  baseUrl: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

export function createOllamaClient(opts: OllamaOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
      const body = {
        model: req.model ?? opts.defaultModel,
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        options: req.temperature !== undefined ? { temperature: req.temperature } : {}
      };

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal
        });
      } catch (err) {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      if (!response.ok) {
        yield { type: 'error', error: `HTTP ${response.status}: ${await response.text()}` };
        return;
      }
      if (!response.body) { yield { type: 'error', error: 'no body' }; return; }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Ollama sends newline-delimited JSON
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let obj: any;
          try { obj = JSON.parse(line); } catch { continue; }

          if (obj.message?.content) {
            yield { type: 'delta', content: obj.message.content };
          }
          if (obj.done) {
            yield {
              type: 'done',
              finishReason: 'stop',
              usage: {
                inputTokens: obj.prompt_eval_count ?? 0,
                outputTokens: obj.eval_count ?? 0,
                totalTokens: (obj.prompt_eval_count ?? 0) + (obj.eval_count ?? 0)
              }
            };
            return;
          }
        }
      }
    }
  };
}
