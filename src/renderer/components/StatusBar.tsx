import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import { PROVIDER_BY_ID } from '@renderer/data/providers';
import { useChatStore } from '@renderer/stores/chat-store';

export interface StatusBarProps {
  /** Currently selected LLM provider id (e.g. 'deepseek'). `undefined` means not configured. */
  llmProviderId?: string;
  /** App version, e.g. "v0.1.3". */
  appVersion?: string;
  /** Whether a product update is available. */
  updateAvailable?: boolean;
}

/** Rough mixed zh/en token estimator. 2.5 chars per token is a conservative midpoint. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.5);
}

/** Compact token formatter: 1234 → "1.2k", 1_000_000 → "1M". */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** StatusBar — bottom status bar showing app version, current LLM and context usage. */
export function StatusBar({
  llmProviderId,
  appVersion,
  updateAvailable = false
}: StatusBarProps) {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);

  const provider = llmProviderId ? PROVIDER_BY_ID[llmProviderId] : undefined;
  const providerLabel = provider ? provider.short : t('status.llmNotConfigured');

  const usedTokens = messages.reduce((sum, m) => {
    let n = estimateTokens(m.content);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        n += estimateTokens(tc.args) + estimateTokens(tc.result ?? '');
      }
    }
    return sum + n;
  }, 0);
  const maxTokens = provider?.contextWindow ?? 0;
  const pct = maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : 0;
  const fillClass = pct >= 85 ? 'hot' : pct >= 50 ? 'warm' : '';

  return (
    <footer className="statusbar">
      {appVersion ? (
        <span className="sbseg">
          {Icons.git}
          <span>
            {appVersion}
            {updateAvailable ? ` · ${t('status.updateAvailable')}` : ''}
          </span>
        </span>
      ) : null}
      <span className="spacer" />
      <span className="sbseg">
        {Icons.brain}
        <span>{providerLabel}</span>
      </span>
      {provider && (
        <span
          className="sbseg ctx-meter"
          title={t('status.contextTooltip', {
            used: usedTokens.toLocaleString('en-US'),
            max: maxTokens.toLocaleString('en-US'),
            pct: pct.toFixed(1)
          })}
        >
          <span className="ctx-bar">
            <span className={`ctx-fill ${fillClass}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="ctx-label">
            {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
          </span>
        </span>
      )}
    </footer>
  );
}

export default StatusBar;
