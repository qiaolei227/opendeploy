import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { LlmClient } from './types';
import { resolveStreamOpts } from './types';

interface OllamaOpts {
  baseUrl: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

export function createOllamaClient(opts: OllamaOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, optsOrSignal?): AsyncIterable<StreamEvent> {
      const { abortSignal: signal, rawCapture } = resolveStreamOpts(optsOrSignal);
      const body = {
        model: req.model ?? opts.defaultModel,
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        options: req.temperature !== undefined ? { temperature: req.temperature } : {}
      };

      const headers = { 'Content-Type': 'application/json' };
      rawCapture?.onRequest(body, headers);

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal
        });
      } catch (err) {
        await rawCapture?.onClose();
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      if (!response.ok) {
        const text = await response.text();
        rawCapture?.onChunk(`HTTP ${response.status}\n${text}`);
        await rawCapture?.onClose();
        yield { type: 'error', error: `HTTP ${response.status}: ${text}` };
        return;
      }
      if (!response.body) {
        await rawCapture?.onClose();
        yield { type: 'error', error: 'no body' };
        return;
      }

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
          rawCapture?.onChunk(line);
          let obj: any;
          try { obj = JSON.parse(line); } catch { continue; }

          if (obj.message?.content) {
            yield { type: 'delta', content: obj.message.content };
          }
          if (obj.done) {
            const outputTokens = obj.eval_count ?? 0;
            // Skip standalone usage emit when eval_count is missing/zero — the chat-store
            // would otherwise replace its delta-based estimate with 0 and stamp it as exact.
            if (typeof obj.eval_count === 'number' && obj.eval_count > 0) {
              yield { type: 'usage', outputTokens };
            }
            yield {
              type: 'done',
              finishReason: 'stop',
              usage: {
                inputTokens: obj.prompt_eval_count ?? 0,
                outputTokens,
                totalTokens: (obj.prompt_eval_count ?? 0) + outputTokens
              }
            };
            await rawCapture?.onClose();
            return;
          }
        }
      }
      await rawCapture?.onClose();
    }
  };
}
