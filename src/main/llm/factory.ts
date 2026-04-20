import type { LlmClient } from './types';
import { PROVIDER_CONFIGS } from './types';
import { createOpenAiClient } from './openai-client';
import { createAnthropicClient } from './anthropic-client';
import { createOllamaClient } from './ollama-client';

export function createLlmClient(providerId: string): LlmClient {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) throw new Error(`Unknown provider: ${providerId}`);

  switch (cfg.format) {
    case 'openai':
      return createOpenAiClient({ baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel });
    case 'anthropic':
      return createAnthropicClient({ baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel });
    case 'ollama':
      return createOllamaClient({ baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel });
  }
}
