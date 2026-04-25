/**
 * Shared LLM provider registry — ported from design/components/Providers.jsx.
 *
 * Used by settings, wizard, workspace chip, tweaks, and status bar.
 * The design prototype assigned these to `window.PROVIDERS`; here we expose
 * them as typed ES module exports instead.
 */

export type ProviderRegion = 'CN' | 'Overseas' | 'Local';

export interface LlmModel {
  /** Provider-side model id, sent to API as `model` param. */
  id: string;
  /** Display name. */
  label: string;
  /** Max input context in tokens. */
  contextWindow: number;
  /** Max output tokens (单轮 completion 上限). */
  maxOutput: number;
  /** "input/output" 单位 ¥ 或 $ per M tokens, 仅展示. */
  pricing: string;
  /** ≤12 字 sub-label, e.g. "1M · 极速". */
  hint: string;
  /** Mark exactly one model per provider as recommended (sets default). */
  recommended?: boolean;
}

export interface LlmProvider {
  id: string;
  dot: string;
  letter: string;
  label: string;
  /** Provider-level short name (e.g. 'DeepSeek'). 模型 short 由 LlmModel.label 承担. */
  short: string;
  /** Provider-level descriptive sub (e.g. '国内直连 · 代码首选') — 不再含模型名. */
  sub: string;
  region: ProviderRegion;
  recommended?: boolean;
  /** Available models. Empty for Ollama (free-form input). */
  models: LlmModel[];
  /** Ollama only — 默认填到 input 框的型号. */
  modelInputDefault?: string;
}

export const PROVIDERS: LlmProvider[] = [
  {
    id: 'deepseek', dot: 'deepseek', letter: 'D',
    label: 'DeepSeek', short: 'DeepSeek', sub: '国内直连 · 代码首选',
    region: 'CN', recommended: true,
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1_000_000, maxOutput: 16_384, pricing: '¥1.0 / 2.0', hint: '1M · 极速', recommended: true },
      { id: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro',   contextWindow: 1_000_000, maxOutput: 16_384, pricing: '¥12 / 24',  hint: '1M · 代码首选' }
    ]
  },
  {
    id: 'qwen', dot: 'qwen', letter: 'Q',
    label: '通义 Qwen', short: '通义 Qwen', sub: '阿里 DashScope · 1M 上下文',
    region: 'CN',
    models: [
      { id: 'qwen3.6-flash', label: 'Qwen3.6 Flash', contextWindow: 1_000_000, maxOutput: 8_192, pricing: '¥0.5 / 1.0', hint: '1M · 极速 (待校准)', recommended: true },
      { id: 'qwen3.6-plus',  label: 'Qwen3.6 Plus',  contextWindow: 1_000_000, maxOutput: 8_192, pricing: '¥1.8 / 6.0', hint: '1M · 主力 (待校准)' },
      { id: 'qwen3-max',     label: 'Qwen3 Max',     contextWindow: 256_000,   maxOutput: 8_192, pricing: '¥20 / 60',   hint: '256K · 顶配 (待校准)' },
      { id: 'qwen3-coder',   label: 'Qwen3 Coder',   contextWindow: 256_000,   maxOutput: 8_192, pricing: '¥4 / 16',    hint: '256K · 代码 (待校准)' }
    ]
  },
  {
    id: 'glm', dot: 'glm', letter: '智',
    label: '智谱 GLM', short: '智谱 GLM', sub: '智谱 BigModel · 性价比高',
    region: 'CN',
    models: [
      { id: 'glm-4.7-flashx', label: 'GLM-4.7 FlashX', contextWindow: 200_000,   maxOutput: 32_000,  pricing: '¥0.5 / 1.5', hint: '200K · 性价比', recommended: true },
      { id: 'glm-4.7',        label: 'GLM-4.7',        contextWindow: 200_000,   maxOutput: 64_000,  pricing: '¥4 / 16',    hint: '200K · 通用' },
      { id: 'glm-5.1',        label: 'GLM-5.1',        contextWindow: 200_000,   maxOutput: 128_000, pricing: '¥8 / 32',    hint: '200K · 长输出' },
      { id: 'glm-4-long',     label: 'GLM-4 Long',     contextWindow: 1_000_000, maxOutput: 8_192,   pricing: '¥1 / 8',     hint: '1M · 长文本' }
    ]
  },
  {
    id: 'kimi', dot: 'kimi', letter: 'K',
    label: 'Moonshot Kimi', short: 'Kimi', sub: 'Moonshot · 长上下文 + 代码',
    region: 'CN',
    models: [
      { id: 'kimi-k2.6', label: 'Kimi K2.6', contextWindow: 256_000, maxOutput: 16_384, pricing: '¥5.2 / 32.6', hint: '256K · 主力', recommended: true },
      { id: 'kimi-k2.5', label: 'Kimi K2.5', contextWindow: 262_144, maxOutput: 16_384, pricing: '¥4.2 / 17.5', hint: '262K · 经济' }
    ]
  },
  {
    id: 'doubao', dot: 'doubao', letter: '豆',
    label: '字节 豆包', short: '豆包', sub: '火山方舟 · 国内直连',
    region: 'CN',
    models: [
      { id: 'doubao-seed-2-0-pro-260215',  label: 'Doubao Seed 2.0 Pro',  contextWindow: 256_000, maxOutput: 16_384, pricing: '¥0.9 / 9.0', hint: '256K · 主力', recommended: true },
      { id: 'doubao-seed-2-0-lite-260215', label: 'Doubao Seed 2.0 Lite', contextWindow: 128_000, maxOutput: 16_384, pricing: '¥0.3 / 3.0', hint: '128K · 经济' },
      { id: 'doubao-seed-1-6-260215',      label: 'Doubao Seed 1.6',      contextWindow: 256_000, maxOutput: 16_384, pricing: '¥0.8 / 8.0', hint: '256K · 上一代' }
    ]
  },
  {
    id: 'hunyuan', dot: 'hunyuan', letter: '腾',
    label: '腾讯 混元', short: '混元', sub: '腾讯云 · 多模态',
    region: 'CN',
    models: [
      { id: 'hunyuan-turbos-latest',         label: 'Hunyuan TurboS',       contextWindow: 224_000, maxOutput: 8_192,  pricing: '¥0.8 / 2.0', hint: '224K · 主力 (待校准)', recommended: true },
      { id: 'hunyuan-2.0-thinking-20251109', label: 'Hunyuan 2.0 Thinking', contextWindow: 256_000, maxOutput: 16_384, pricing: '¥3 / 9',     hint: '256K · 推理 (待校准)' },
      { id: 'hunyuan-large',                  label: 'Hunyuan Large',        contextWindow: 200_000, maxOutput: 8_192,  pricing: '¥4 / 12',    hint: '200K · 通用 (待校准)' },
      { id: 'hunyuan-lite',                   label: 'Hunyuan Lite',         contextWindow: 128_000, maxOutput: 8_192,  pricing: 'free',       hint: '128K · 免费 (待校准)' }
    ]
  },
  {
    id: 'minimax', dot: 'minimax', letter: 'M',
    label: 'MiniMax', short: 'MiniMax', sub: '海螺 AI · 长输出',
    region: 'CN',
    models: [
      { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', contextWindow: 196_608, maxOutput: 8_192, pricing: '¥2.1 / 8.4', hint: '192K · 主力', recommended: true }
    ]
  },
  {
    id: 'claude', dot: 'claude', letter: 'A',
    label: 'Anthropic Claude', short: 'Claude', sub: '海外需代理 · 推理强',
    region: 'Overseas',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  contextWindow: 200_000,   maxOutput: 64_000,  pricing: '$1 / 5',  hint: '200K · 速度', recommended: true },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', contextWindow: 1_000_000, maxOutput: 64_000,  pricing: '$3 / 15', hint: '1M · 主力' },
      { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7',   contextWindow: 1_000_000, maxOutput: 128_000, pricing: '$5 / 25', hint: '1M · 顶配' }
    ]
  },
  {
    id: 'gpt', dot: 'openai', letter: 'G',
    label: 'OpenAI GPT', short: 'GPT', sub: '海外需代理 · 通用强',
    region: 'Overseas',
    models: [
      { id: 'gpt-5.5',      label: 'GPT-5.5',      contextWindow: 1_050_000, maxOutput: 100_000, pricing: '$5 / 25',    hint: '1M · 主力 (待校准)', recommended: true },
      { id: 'gpt-5.5-pro',  label: 'GPT-5.5 Pro',  contextWindow: 1_050_000, maxOutput: 100_000, pricing: '$15 / 75',   hint: '1M · 顶配 (待校准)' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', contextWindow: 200_000,   maxOutput: 16_384,  pricing: '$0.3 / 1.2', hint: '200K · 经济 (待校准)' }
    ]
  },
  {
    id: 'ollama', dot: 'ollama', letter: 'O',
    label: 'Ollama 本地', short: 'Ollama', sub: '完全离线 · 自定义模型',
    region: 'Local',
    models: [],
    modelInputDefault: 'qwen2.5-coder'
  }
];

export const PROVIDER_BY_ID: Record<string, LlmProvider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
);

/**
 * Pick the active model for a provider given the user's stored selection.
 * Falls back to recommended → first-in-list → null.
 * Returns null for Ollama (caller uses provider.modelInputDefault + free-form input).
 */
export function resolveActiveModel(
  providerId: string,
  modelByProvider: Record<string, string> | undefined
): LlmModel | null {
  const provider = PROVIDER_BY_ID[providerId];
  if (!provider || provider.models.length === 0) return null;
  const stored = modelByProvider?.[providerId];
  if (stored) {
    const found = provider.models.find((m) => m.id === stored);
    if (found) return found;
  }
  return provider.models.find((m) => m.recommended) ?? provider.models[0];
}
