import type { ChatRequest, StreamEvent } from '@shared/llm-types';

export interface LlmClient {
  /**
   * Stream a chat completion. Caller iterates the returned AsyncIterable
   * to receive deltas, tool calls, and the final done event.
   * Throws if request preparation fails (before streaming starts).
   */
  stream(request: ChatRequest, abortSignal?: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface ProviderConfig {
  id: string;                    // e.g., 'deepseek', 'claude', 'ollama'
  baseUrl: string;
  defaultModel: string;
  /** OpenAI-compatible endpoint format vs Anthropic vs Ollama */
  format: 'openai' | 'anthropic' | 'ollama';
}

/** Map provider id → config. Each entry used by factory to build correct client. */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  deepseek: { id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', format: 'openai' },
  qwen:     { id: 'qwen',     baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max', format: 'openai' },
  glm:      { id: 'glm',      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4', format: 'openai' },
  kimi:     { id: 'kimi',     baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', format: 'openai' },
  doubao:   { id: 'doubao',   baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-pro-32k', format: 'openai' },
  hunyuan:  { id: 'hunyuan',  baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-standard', format: 'openai' },
  minimax:  { id: 'minimax',  baseUrl: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5-chat', format: 'openai' },
  baichuan: { id: 'baichuan', baseUrl: 'https://api.baichuan-ai.com/v1', defaultModel: 'Baichuan4-Turbo', format: 'openai' },
  gpt:      { id: 'gpt',      baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', format: 'openai' },
  claude:   { id: 'claude',   baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514', format: 'anthropic' },
  ollama:   { id: 'ollama',   baseUrl: 'http://localhost:11434', defaultModel: 'qwen2.5-coder', format: 'ollama' }
};
