import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';

export interface TitleBarProps {
  /** Current project label shown after the brand (e.g., "川沙诚信商贸 · V9.1"). */
  currentProjectLabel?: string;
  /** Edition pill — "community" or "enterprise". */
  edition?: 'community' | 'enterprise';
}

/**
 * TitleBar — top application bar.
 *
 * Ported from `design/components/App.jsx` `TitleBar` function.
 */
export function TitleBar({
  currentProjectLabel,
  edition = 'community'
}: TitleBarProps) {
  const { t } = useTranslation();

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

    </header>
  );
}

export default TitleBar;
