import type { Message, ToolCall } from '@shared/llm-types';
import type { LlmClient } from '../llm/types';
import type { ToolRegistry } from './tools';

export type AgentLoopEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; content: string; isError: boolean }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'error'; error: string }
  | { type: 'done' };

interface RunAgentLoopParams {
  client: LlmClient;
  tools: ToolRegistry;
  initialMessages: Message[];
  providerId: string;
  apiKey?: string;
  model?: string;
  /**
   * Optional system prompt prepended as a `system` role message. Only added
   * when the initial messages don't already start with a system message, so
   * resuming a conversation doesn't duplicate the prompt.
   */
  systemPrompt?: string;
  onEvent?: (e: AgentLoopEvent) => void;
  maxIterations?: number;
  signal?: AbortSignal;
}

function makeId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAgentLoop(params: RunAgentLoopParams): Promise<Message[]> {
  const maxIter = params.maxIterations ?? 10;
  const messages: Message[] = [...params.initialMessages];
  if (params.systemPrompt && params.systemPrompt.trim() !== '' && messages[0]?.role !== 'system') {
    messages.unshift({
      id: makeId(),
      role: 'system',
      content: params.systemPrompt,
      createdAt: new Date().toISOString()
    });
  }
  const emit = params.onEvent ?? (() => {});
  const toolDefs = params.tools.definitions();

  for (let iter = 0; iter < maxIter; iter++) {
    emit({ type: 'iteration_start', iteration: iter });

    let assistantContent = '';
    const toolCalls: ToolCall[] = [];
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    let errored = false;

    for await (const ev of params.client.stream({
      providerId: params.providerId,
      apiKey: params.apiKey,
      model: params.model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined
    }, params.signal)) {
      if (ev.type === 'delta') {
        assistantContent += ev.content;
        emit({ type: 'delta', content: ev.content });
      } else if (ev.type === 'tool_call') {
        toolCalls.push(ev.toolCall);
        emit({ type: 'tool_call', toolCall: ev.toolCall });
      } else if (ev.type === 'done') {
        finishReason = ev.finishReason;
      } else if (ev.type === 'error') {
        errored = true;
        assistantContent = ev.error;
        emit({ type: 'error', error: ev.error });
        break;
      }
    }

    const assistantMsg: Message = {
      id: makeId(),
      role: 'assistant',
      content: assistantContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: new Date().toISOString()
    };
    messages.push(assistantMsg);

    if (errored || finishReason !== 'tool_calls' || toolCalls.length === 0) {
      emit({ type: 'done' });
      return messages;
    }

    // Execute tools, append tool result messages, loop again.
    // Batch is parallelized only when every call in it is parallelSafe;
    // any writer in the batch forces serial execution so ordering and
    // backup-timestamp uniqueness are preserved.
    const allSafe =
      toolCalls.length > 1 &&
      toolCalls.every((tc) => params.tools.get(tc.name)?.parallelSafe === true);

    const results = allSafe
      ? await Promise.all(toolCalls.map((tc) => params.tools.execute(tc.name, tc.arguments)))
      : await (async () => {
          const out = [];
          for (const tc of toolCalls) out.push(await params.tools.execute(tc.name, tc.arguments));
          return out;
        })();

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const result = results[i];
      emit({
        type: 'tool_result',
        toolCallId: tc.id,
        content: result.content,
        isError: result.isError ?? false
      });
      messages.push({
        id: makeId(),
        role: 'tool',
        content: result.content,
        toolCallId: tc.id,
        createdAt: new Date().toISOString()
      });
    }
  }

  throw new Error(`Agent loop exceeded max iterations (${maxIter})`);
}
