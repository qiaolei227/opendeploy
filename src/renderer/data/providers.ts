/**
 * Shared LLM provider registry — ported from design/components/Providers.jsx.
 *
 * Used by settings, wizard, workspace chip, tweaks, and status bar.
 * The design prototype assigned these to `window.PROVIDERS`; here we expose
 * them as typed ES module exports instead.
 */

export type ProviderRegion = 'CN' | 'Overseas' | 'Local';

export interface LlmProvider {
  /** Stable identifier used as dictionary key and in settings payloads. */
  id: string;
  /** Design token name used to select the brand color dot. */
  dot: string;
  /** Single-character fallback glyph shown inside the brand dot. */
  letter: string;
  /** Long display name (e.g. in settings list). */
  label: string;
  /** Short display name (e.g. in chips / status bar). */
  short: string;
  /** Descriptive sub-label (model family, positioning, etc.). */
  sub: string;
  /** Typical round-trip latency, pre-formatted for display. */
  lat: string;
  /** Typical price, pre-formatted for display. */
  cost: string;
  /** Region hint used for filtering / proxy notices. */
  region: ProviderRegion;
  /** Whether to mark the provider as recommended in pickers. */
  recommended?: boolean;
}

export const PROVIDERS: LlmProvider[] = [
  { id: 'deepseek', dot: 'deepseek', letter: 'D',  label: 'DeepSeek',         short: 'DeepSeek V4',           sub: 'deepseek-v4 · 国内直连 · 代码首选', lat: '180 ms', cost: '¥1.2 / M tok', region: 'CN', recommended: true },
  { id: 'qwen',     dot: 'qwen',     letter: 'Q',  label: '通义 Qwen',         short: 'Qwen3-Max',             sub: 'qwen3-max · 阿里云百炼',            lat: '220 ms', cost: '¥1.8 / M tok', region: 'CN' },
  { id: 'glm',      dot: 'glm',      letter: '智', label: '智谱 GLM',          short: 'GLM-4.6',               sub: 'glm-4.6 · 智谱 AI BigModel',        lat: '240 ms', cost: '¥0.8 / M tok', region: 'CN' },
  { id: 'kimi',     dot: 'kimi',     letter: 'K',  label: 'Moonshot Kimi',     short: 'Kimi K2',               sub: 'kimi-k2 · 长上下文 128k+',           lat: '260 ms', cost: '¥1.5 / M tok', region: 'CN' },
  { id: 'doubao',   dot: 'doubao',   letter: '豆', label: '字节 豆包',         short: 'Doubao 1.5 Pro',        sub: 'doubao-1.5-pro · 火山引擎',         lat: '190 ms', cost: '¥0.9 / M tok', region: 'CN' },
  { id: 'hunyuan',  dot: 'hunyuan',  letter: '腾', label: '腾讯 混元',         short: 'Hunyuan Turbo',         sub: 'hunyuan-turbo-2025',                 lat: '250 ms', cost: '¥1.0 / M tok', region: 'CN' },
  { id: 'minimax',  dot: 'minimax',  letter: 'M',  label: 'MiniMax',           short: 'MiniMax abab7',         sub: 'abab7-chat · 海螺 AI',               lat: '230 ms', cost: '¥1.4 / M tok', region: 'CN' },
  { id: 'baichuan', dot: 'baichuan', letter: '百', label: '百川 Baichuan',     short: 'Baichuan4-Turbo',       sub: 'Baichuan4-Turbo · 商用首选',         lat: '280 ms', cost: '¥1.3 / M tok', region: 'CN' },
  { id: 'claude',   dot: 'claude',   letter: 'A',  label: 'Anthropic Claude',  short: 'Claude Sonnet 4.7',     sub: 'claude-sonnet-4.7 · 海外需代理',     lat: '340 ms', cost: '$3 / M tok',   region: 'Overseas' },
  { id: 'gpt',      dot: 'openai',   letter: 'G',  label: 'OpenAI GPT',        short: 'GPT-5',                 sub: 'gpt-5 · gpt-5-mini · 海外需代理',    lat: '420 ms', cost: '$2.5 / M tok', region: 'Overseas' },
  { id: 'ollama',   dot: 'ollama',   letter: 'O',  label: 'Ollama 本地',       short: 'Ollama · qwen2.5-coder', sub: 'qwen2.5-coder · 完全离线',           lat: '∞',      cost: 'free',          region: 'Local' }
];

export const PROVIDER_BY_ID: Record<string, LlmProvider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
);
