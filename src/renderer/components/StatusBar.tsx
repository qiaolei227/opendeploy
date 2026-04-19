import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import { PROVIDER_BY_ID } from '@renderer/data/providers';

export interface StatusBarProps {
  /** Currently selected LLM provider id (e.g. 'deepseek'). `undefined` means not configured. */
  llmProviderId?: string;
  /** Whether BOS (Kingdee K/3 Cloud) is currently connected. */
  bosConnected?: boolean;
  /** BOS version string shown next to the connection state, e.g. "V9.1.0.2". */
  bosVersion?: string;
  /** Skills bundle short git hash, e.g. "@4a7f1b2". */
  skillsVersion?: string;
  /** Number of installed skill packs. `0` or missing falls back to built-in label. */
  skillsCount?: number;
  /** App version, e.g. "v0.1.3". */
  appVersion?: string;
  /** Whether a product update is available. */
  updateAvailable?: boolean;
  /** Tokens consumed this session. */
  tokensUsed?: number;
}

/**
 * StatusBar — bottom status/footer bar.
 *
 * Ported from `design/components/App.jsx` `StatusBar` function.
 *
 * MVP-0.1 reality: most props are optional/undefined — there is no real BOS
 * connection yet, skills don't exist, update channel isn't wired. The component
 * renders gracefully with missing values, showing "not connected" / "built-in"
 * / "not set" fallbacks instead of crashing.
 */
export function StatusBar({
  llmProviderId,
  bosConnected = false,
  bosVersion,
  skillsVersion,
  skillsCount = 0,
  appVersion,
  updateAvailable = false,
  tokensUsed = 0
}: StatusBarProps) {
  const { t } = useTranslation();

  const bosLabel = bosConnected
    ? `${t('status.bosConnected')}${bosVersion ? ` · ${bosVersion}` : ''}`
    : t('status.bosDisconnected');

  const skillsLabel =
    skillsCount > 0
      ? `${t('status.skillPacks', { count: skillsCount })}${skillsVersion ? ` · ${skillsVersion}` : ''}`
      : t('status.skillsBuiltin');

  const provider = llmProviderId ? PROVIDER_BY_ID[llmProviderId] : undefined;
  const providerLabel = provider
    ? `${provider.short} · user key`
    : t('status.llmNotConfigured');

  const tokensFormatted = new Intl.NumberFormat('en-US').format(tokensUsed);

  return (
    <footer className="statusbar">
      <span className={`sbseg ${bosConnected ? 'good' : ''}`.trim()}>
        <span className="sbdot" />
        {bosLabel}
      </span>
      <span className="sbseg">
        {Icons.shield}
        <span>{t('status.metadataReadonly')}</span>
      </span>
      <span className="sbseg">
        {Icons.sparkles}
        <span>{skillsLabel}</span>
      </span>
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
      <span className="sbseg">tokens {tokensFormatted}</span>
      <span className="sbseg">zh-CN · en-US</span>
    </footer>
  );
}

export default StatusBar;
