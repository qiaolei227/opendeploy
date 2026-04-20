import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import { LogoMark } from '@renderer/components/LogoMark';

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
        <div className="brand-mark">
          <LogoMark size={22} variant="inverse" label="开达 OpenDeploy" />
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
