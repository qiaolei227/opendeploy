import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';

export interface TitleBarProps {
  /** Current project label shown after the brand (e.g., "川沙诚信商贸 · V9.1"). */
  currentProjectLabel?: string;
  /** Edition pill — "community" or "enterprise". */
  edition?: 'community' | 'enterprise';
  /** User display name shown in the avatar block. */
  userDisplayName?: string;
}

/**
 * TitleBar — top application bar.
 *
 * Ported from `design/components/App.jsx` `TitleBar` function.
 * Window controls (minimize/maximize/close) are placeholders; they
 * will be wired to IPC in a later task.
 */
export function TitleBar({
  currentProjectLabel,
  edition = 'community',
  userDisplayName
}: TitleBarProps) {
  const { t } = useTranslation();
  const displayName = userDisplayName ?? t('titlebar.userDefault');
  const avatarChar = displayName.slice(0, 1);

  return (
    <header className="titlebar win">
      <div className="brand">
        <div className="brand-mark" aria-label="开达 OpenDeploy">
          <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="10" fill="#3d7a5a" />
            <rect x="14" y="11" width="20" height="12" rx="2" fill="#fafaf7" />
            <path
              d="M20 27 L24 31 L28 27"
              stroke="#fafaf7"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
            <line
              x1="10"
              y1="37"
              x2="38"
              y2="37"
              stroke="#fafaf7"
              strokeWidth="2.5"
              strokeLinecap="square"
            />
          </svg>
        </div>
        <span className="brand-cn">开达</span>
        <span className="brand-en">OpenDeploy</span>
        {currentProjectLabel ? (
          <>
            <span className="brand-slash">—</span>
            <span className="brand-project">{currentProjectLabel}</span>
          </>
        ) : null}
        <span className="brand-edition">{edition}</span>
      </div>

      <div className="tb-spacer" />

      <div className="tb-search">
        {Icons.search}
        <span>{t('common.search')}</span>
        <span className="kbd">Ctrl K</span>
      </div>

      <div className="tb-actions">
        <button type="button" className="tb-btn">
          {Icons.gear}
        </button>
        <div className="tb-user" title={displayName}>
          <div className="tb-avatar">{avatarChar}</div>
          <div className="tb-uname">{displayName}</div>
        </div>
      </div>

      <div className="wincaps">
        <button type="button" className="wincap" title={t('titlebar.minimize')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button type="button" className="wincap" title={t('titlebar.maximize')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button type="button" className="wincap close" title={t('titlebar.close')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  );
}

export default TitleBar;
