import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import type { ReactElement } from 'react';

/** Top-level page identifier for the nav rail. */
export type PageKey = 'workspace' | 'projects' | 'skills' | 'settings' | 'wizard';

export interface NavRailProps {
  current: PageKey;
  onChange: (page: PageKey) => void;
}

interface NavItem {
  id: PageKey;
  icon: ReactElement;
  label: string;
}

/**
 * NavRail — left-side icon rail.
 *
 * Ported from `design/components/App.jsx` `NavRail` function.
 * Three main items on top (workspace / projects / skills), a divider,
 * a spacer, then Settings pinned to the bottom.
 */
export function NavRail({ current, onChange }: NavRailProps) {
  const { t } = useTranslation();

  const items: NavItem[] = [
    { id: 'workspace', icon: Icons.chat, label: t('nav.workspace') },
    { id: 'projects', icon: Icons.folder, label: t('nav.projects') },
    { id: 'skills', icon: Icons.sparkles, label: t('nav.skills') }
  ];

  return (
    <nav className="nav">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`nav-item ${current === it.id ? 'active' : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.icon}
          <span className="lbl">{it.label}</span>
        </button>
      ))}
      <div className="nav-rule" />
      <div className="spacer" />
      <button
        type="button"
        className={`nav-item ${current === 'settings' ? 'active' : ''}`}
        onClick={() => onChange('settings')}
      >
        {Icons.gear}
        <span className="lbl">{t('nav.settings')}</span>
      </button>
    </nav>
  );
}

export default NavRail;
