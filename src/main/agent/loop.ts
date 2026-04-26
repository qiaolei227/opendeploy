import type { Message, ToolCall } from '@shared/llm-types';
import type { LlmClient } from '../llm/types';
import type { RawCapture } from '../llm/raw-dump';
import type { ToolRegistry } from './tools';
import { pruneOldToolResults } from './history-prune';
import { appendTextDelta, appendToolUse, type MessageBlock } from '@shared/blocks';
import { createLogger } from '../logger';

const logger = createLogger('agent-loop');

/**
 * Keep the last N `tool` role messages with their full content; older tool
 * results get swapped for a short placeholder before each LLM call to cap
 * per-turn context. 10 is roughly 2-3 turns of intensive tool use on a
 * typical K/3 Cloud flow (侦察 + decision skill load + design + execute),
 * leaving the agent recent detail while aging out stale 侦察 dumps.
 */
const KEEP_LAST_N_TOOL_RESULTS = 10;

export type AgentLoopEvent =
  | { type: 'delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'reasoning_signature'; signature: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; content: string; isError: boolean }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'usage'; outputTokens: number }
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
  /**
   * Plan 5.13 — opaque conversation identifier propagated into the trace log
   * so post-mortem grep can stitch turns. Optional (older callers /
   * single-shot smokes don't need it); when absent, trace records still get
   * written but lack the join key.
   */
  conversationId?: string;
  /**
   * Plan 5.13 raw layer — per-turn capture factory. The loop calls this once
   * before each `client.stream()` call; if the factory returns a capture, it
   * gets passed in so the client emits raw req body + SSE chunks. Returning
   * undefined disables capture for that turn (e.g. when settings.llmRawDump
   * is off, or for smoke / unit tests). Loop is otherwise unaware of where
   * the capture lands (file, memory, ...).
   */
  rawCaptureFactory?: (turn: number) => RawCapture | undefined;
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
    const turnStart = Date.now();

    let assistantContent = '';
    let reasoningContent = '';
    let reasoningSignature = '';
    let lastUsageOut = 0;
    const toolCalls: ToolCall[] = [];
    let blocks: MessageBlock[] = [];
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    let errored = false;
    let errorMessage: string | undefined;

    // Prune old tool results before each LLM call. The full `messages` array
    // keeps the unmangled history (so persistence / loadConversation stays
    // lossless); only the slice the model sees has old tool payloads replaced
    // with a placeholder. See agent/history-prune.ts for the rationale.
    const rawCapture = params.rawCaptureFactory?.(iter);
    for await (const ev of params.client.stream({
      providerId: params.providerId,
      apiKey: params.apiKey,
      model: params.model,
      messages: pruneOldToolResults(messages, KEEP_LAST_N_TOOL_RESULTS),
      tools: toolDefs.length > 0 ? toolDefs : undefined
    }, { abortSignal: params.signal, rawCapture })) {
      if (ev.type === 'delta') {
        assistantContent += ev.content;
        blocks = appendTextDelta(blocks, ev.content);
        emit({ type: 'delta', content: ev.content });
      } else if (ev.type === 'reasoning_delta') {
        // 累加 thinking text, 下一轮构造请求时会被 client 回传给 LLM 满足
        // DeepSeek V4 / Claude extended-thinking 的多轮契约。
        reasoningContent += ev.content;
        emit({ type: 'reasoning_delta', content: ev.content });
      } else if (ev.type === 'reasoning_signature') {
        // Claude extended-thinking 特有: 必须和 thinking 文本配对回传。
        reasoningSignature = ev.signature;
        emit({ type: 'reasoning_signature', signature: ev.signature });
      } else if (ev.type === 'tool_call') {
        toolCalls.push(ev.toolCall);
        blocks = appendToolUse(blocks, ev.toolCall.id);
        emit({ type: 'tool_call', toolCall: ev.toolCall });
      } else if (ev.type === 'usage') {
        lastUsageOut = ev.outputTokens;
        emit({ type: 'usage', outputTokens: ev.outputTokens });
      } else if (ev.type === 'done') {
        finishReason = ev.finishReason;
      } else if (ev.type === 'error') {
        errored = true;
        errorMessage = ev.error;
        assistantContent = ev.error;
        // Persist to app.log for post-mortem — LLM protocol bugs (DeepSeek V4
        // reasoning_content / Claude signature mismatch / 400 invalid tool
        // schema) all land here. The error string already contains HTTP
        // status + full body from the client, so grepping the log is enough
        // to diagnose without re-running the session.
        void logger.error(
          `LLM stream error provider=${params.providerId} iteration ${iter}: ${ev.error}`
        );
        emit({ type: 'error', error: ev.error });
        break;
      }
    }

    const llmElapsedMs = Date.now() - turnStart;

    const assistantMsg: Message = {
      id: makeId(),
      role: 'assistant',
      content: assistantContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      blocks: blocks.length > 0 ? blocks : undefined,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(reasoningSignature ? { reasoningSignature } : {}),
      createdAt: new Date().toISOString()
    };
    messages.push(assistantMsg);

    if (errored || finishReason !== 'tool_calls' || toolCalls.length === 0) {
      void writeTurnTrace({
        conversationId: params.conversationId,
        iteration: iter,
        providerId: params.providerId,
        model: params.model,
        toolDefCount: toolDefs.length,
        toolCalls: [],
        outputTokens: lastUsageOut,
        finishReason,
        errored,
        errorMessage,
        llmElapsedMs,
        totalElapsedMs: Date.now() - turnStart
      });
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

    const toolStarts: number[] = toolCalls.map(() => 0);
    const toolEnds: number[] = toolCalls.map(() => 0);
    const wrap = (idx: number, tc: ToolCall) => {
      toolStarts[idx] = Date.now();
      return params.tools.execute(tc.name, tc.arguments).then((r) => {
        toolEnds[idx] = Date.now();
        return r;
      });
    };
    const results = allSafe
      ? await Promise.all(toolCalls.map((tc, i) => wrap(i, tc)))
      : await (async () => {
          const out = [];
          for (let i = 0; i < toolCalls.length; i++) out.push(await wrap(i, toolCalls[i]));
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

    void writeTurnTrace({
      conversationId: params.conversationId,
      iteration: iter,
      providerId: params.providerId,
      model: params.model,
      toolDefCount: toolDefs.length,
      toolCalls: toolCalls.map((tc, i) => ({
        name: tc.name,
        durationMs: toolEnds[i] - toolStarts[i],
        ok: !(results[i].isError ?? false),
        parallelSafe: params.tools.get(tc.name)?.parallelSafe === true
      })),
      outputTokens: lastUsageOut,
      finishReason,
      errored: false,
      llmElapsedMs,
      totalElapsedMs: Date.now() - turnStart
    });
  }

  throw new Error(`Agent loop exceeded max iterations (${maxIter})`);
}

interface TurnTraceRecord {
  conversationId?: string;
  iteration: number;
  providerId: string;
  model?: string;
  toolDefCount: number;
  toolCalls: Array<{ name: string; durationMs: number; ok: boolean; parallelSafe: boolean }>;
  outputTokens: number;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  errored: boolean;
  errorMessage?: string;
  llmElapsedMs: number;
  totalElapsedMs: number;
}

/**
 * One JSON line per agent turn. Captures the cheap signal needed to triage
 * "why was this turn slow / why did the agent pick that tool" without
 * dumping full prompts (those go to raw-llm/ when `settings.llmRawDump` is
 * on — see Plan 5.13 raw layer). Fire-and-forget — never let trace I/O fail
 * the agent run.
 */
async function writeTurnTrace(rec: TurnTraceRecord): Promise<void> {
  try {
    await logger.trace(rec as unknown as Record<string, unknown>);
  } catch {
    // swallow — trace is diagnostics, not load-bearing
  }
}
