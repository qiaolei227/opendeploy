import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import { LogoMark } from '@renderer/components/LogoMark';
import { getModKey } from '@renderer/utils/platform';

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
  const { t, i18n } = useTranslation();

  const isZh = i18n.language.startsWith('zh');
  const editionKey =
    edition === 'enterprise' ? 'titlebar.editionEnterprise' : 'titlebar.editionCommunity';

  return (
    <header className="titlebar win">
      <div className="brand">
        <div className="brand-mark">
          <LogoMark size={22} variant="default" label={t('app.name')} />
        </div>
        <span className={isZh ? 'brand-cn' : 'brand-name-en'}>{t('app.name')}</span>
        {currentProjectLabel ? (
          <>
            <span className="brand-slash">—</span>
            <span className="brand-project">{currentProjectLabel}</span>
          </>
        ) : null}
        <span className="brand-edition">{t(editionKey)}</span>
      </div>

      <div className="tb-spacer" />

      <div className="tb-search">
        {Icons.search}
        <span>{t('common.search')}</span>
        <span className="kbd">{getModKey()} K</span>
      </div>
    </header>
  );
}

export default TitleBar;
