import type { ChatRequest, StreamEvent, ToolCall } from '@shared/llm-types';
import type { LlmClient } from './types';
import { parseSseStream } from './sse';

interface OpenAiClientOpts {
  baseUrl: string;
  defaultModel: string;
  /** Override for tests */
  fetchImpl?: typeof fetch;
}

export function createOpenAiClient(opts: OpenAiClientOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
      const body = {
        model: req.model ?? opts.defaultModel,
        messages: req.messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
          }
          const base: Record<string, unknown> = { role: m.role, content: m.content };
          if (m.toolCalls && m.toolCalls.length > 0) {
            base.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
            }));
          }
          return base;
        }),
        stream: true,
        ...(req.tools && req.tools.length > 0 ? {
          tools: req.tools.map((t) => ({ type: 'function', function: t }))
        } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})
      };

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${req.apiKey ?? ''}`
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
      if (!response.body) {
        yield { type: 'error', error: 'Response has no body' };
        return;
      }

      // Accumulate tool call fragments across deltas
      const toolCallAcc = new Map<number, { id: string; name: string; argsText: string }>();

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

      for await (const dataStr of parseSseStream(stream)) {
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        const choice = data.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { type: 'delta', content: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallAcc.get(idx) ?? { id: '', name: '', argsText: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.argsText += tc.function.arguments;
            toolCallAcc.set(idx, existing);
          }
        }

        if (choice.finish_reason) {
          // Emit any accumulated tool calls
          for (const acc of toolCallAcc.values()) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(acc.argsText || '{}'); } catch { args = {}; }
            const toolCall: ToolCall = { id: acc.id, name: acc.name, arguments: args };
            yield { type: 'tool_call', toolCall };
          }
          const finishReason = (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls' || choice.finish_reason === 'length')
            ? choice.finish_reason : 'stop';
          const usage = data.usage ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0
          } : undefined;
          yield { type: 'done', finishReason, usage };
          return;
        }
      }
    }
  };
}
