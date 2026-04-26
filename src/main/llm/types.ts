import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { RawCapture } from './raw-dump';

export interface StreamOptions {
  abortSignal?: AbortSignal;
  /**
   * Plan 5.13 — when present, the client emits the raw request body + each
   * SSE chunk into the capture. Caller (`ipc-llm.ts`) builds one capture
   * per turn when `settings.llmRawDump` is on; passes `undefined` otherwise
   * so the client incurs no overhead.
   */
  rawCapture?: RawCapture;
}

export interface LlmClient {
  /**
   * Stream a chat completion. Caller iterates the returned AsyncIterable
   * to receive deltas, tool calls, and the final done event.
   * Throws if request preparation fails (before streaming starts).
   *
   * The legacy `(request, abortSignal)` shape is preserved by accepting
   * either an AbortSignal or a StreamOptions bag for back-compat with
   * existing callers / tests.
   */
  stream(
    request: ChatRequest,
    optsOrSignal?: AbortSignal | StreamOptions
  ): AsyncIterable<StreamEvent>;
}

/** Resolve the legacy 2-arg call site to a normalized opts object. */
export function resolveStreamOpts(
  optsOrSignal?: AbortSignal | StreamOptions
): StreamOptions {
  if (!optsOrSignal) return {};
  if (optsOrSignal instanceof AbortSignal) {
    return { abortSignal: optsOrSignal };
  }
  return optsOrSignal;
}

export interface ProviderConfig {
  id: string;                    // e.g., 'deepseek', 'claude', 'ollama'
  baseUrl: string;
  defaultModel: string;
  /** OpenAI-compatible endpoint format vs Anthropic vs Ollama */
  format: 'openai' | 'anthropic' | 'ollama';
}

/**
 * Map provider id → config. Each entry used by factory to build correct client.
 *
 * `defaultModel` is the backend fallback used when `LlmChatRequest.model` is
 * undefined (old renderer / tests / partial settings). It MUST stay aligned
 * with the `recommended: true` model id in `src/renderer/data/providers.ts`,
 * otherwise the LLM will respond as a different model than what the StatusBar
 * displays — and worse, the id may not exist on the provider at all.
 */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  deepseek: { id: 'deepseek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-v4-flash', format: 'openai' },
  qwen:     { id: 'qwen',     baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.6-flash', format: 'openai' },
  glm:      { id: 'glm',      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.7-flashx', format: 'openai' },
  kimi:     { id: 'kimi',     baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.6', format: 'openai' },
  doubao:   { id: 'doubao',   baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-2-0-pro-260215', format: 'openai' },
  hunyuan:  { id: 'hunyuan',  baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest', format: 'openai' },
  minimax:  { id: 'minimax',  baseUrl: 'https://api.minimax.chat/v1', defaultModel: 'MiniMax-M2.7', format: 'openai' },
  gpt:      { id: 'gpt',      baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.5', format: 'openai' },
  claude:   { id: 'claude',   baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-haiku-4-5-20251001', format: 'anthropic' },
  ollama:   { id: 'ollama',   baseUrl: 'http://localhost:11434', defaultModel: 'qwen2.5-coder', format: 'ollama' }
};
