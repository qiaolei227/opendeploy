import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { LlmClient } from './types';
import { parseSseStream } from './sse';

interface AnthropicOpts {
  baseUrl: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

export function createAnthropicClient(opts: AnthropicOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
      // Split out system messages (Anthropic takes them separately)
      const systemParts = req.messages.filter(m => m.role === 'system').map(m => m.content);
      const conversation = req.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : m.role === 'tool' ? 'user' : 'user',
        content: m.role === 'tool'
          ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
          : m.content
      }));

      const body = {
        model: req.model ?? opts.defaultModel,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
        messages: conversation,
        ...(req.tools && req.tools.length > 0 ? {
          tools: req.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters
          }))
        } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
      };

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': req.apiKey ?? '',
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body),
          signal
        });
      } catch (err) {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      if (!response.ok) {
        const text = await response.text();
        yield { type: 'error', error: `HTTP ${response.status}: ${text}` };
        return;
      }
      if (!response.body) { yield { type: 'error', error: 'no body' }; return; }

      const reader = response.body.getReader();
      const stream: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield value;
          }
        }
      };

      let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const dataStr of parseSseStream(stream)) {
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          yield { type: 'delta', content: data.delta.text ?? '' };
        } else if (data.type === 'message_delta') {
          const sr = data.delta?.stop_reason;
          if (sr === 'tool_use') finishReason = 'tool_calls';
          else if (sr === 'max_tokens') finishReason = 'length';
          else finishReason = 'stop';
          if (data.usage?.output_tokens) outputTokens = data.usage.output_tokens;
        } else if (data.type === 'message_start') {
          inputTokens = data.message?.usage?.input_tokens ?? 0;
        } else if (data.type === 'message_stop') {
          yield {
            type: 'done',
            finishReason,
            usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
          };
          return;
        }
      }
    }
  };
}
