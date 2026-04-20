import { useTranslation } from 'react-i18next';
import type { PageKey } from '@renderer/components/NavRail';

/** Minimal project shape used by the secondary rail in MVP-0.1. */
export interface ProjectSummary {
  id: string;
  name: string;
  /** Environment tag: 'prod' | 'uat' | 'dev' (free-form for forward compat). */
  env?: string;
  /** Connection state: 'live' (green), 'conn' (amber/connecting), 'idle' (dim). */
  state?: 'live' | 'conn' | 'idle';
}

/** Minimal conversation shape used by the secondary rail in MVP-0.1. */
export interface ConversationSummary {
  id: string;
  title: string;
  /** Display text only, e.g. "今天 14:32" or "4月15日". */
  date: string;
  /** Optional chip label, e.g. "SAL" or "STK→AP". */
  tag?: string;
  /** Chip color token — matches design-system.css `.chip.{variant}`. */
  tagColor?: 'accent' | 'info' | 'good' | 'warn';
}

export interface SecondarySideProps {
  /** Current top-level page; drives which sections render. */
  page: PageKey;
  /** Project list. Defaults to `[]` in MVP-0.1 where no projects exist yet. */
  projects?: ProjectSummary[];
  /** Conversation list. Defaults to `[]` in MVP-0.1. */
  conversations?: ConversationSummary[];
  activeProjectId?: string;
  activeConversationId?: string;
  onProjectSelect?: (id: string) => void;
  onConversationSelect?: (id: string) => void;
  /** Called when the user hits the "new chat" button in the workspace rail. */
  onNewConversation?: () => void;
}

/**
 * SecondarySide — secondary rail shown between the nav rail and main content.
 *
 * Ported from `design/components/Side.jsx` `SecondarySide` function.
 *
 * MVP-0.1 simplification: the design prototype's hardcoded mock data
 * (`PROJECTS`, `CONVS`, etc.) is NOT ported. Projects and conversations come
 * in via props and default to empty arrays; each section renders a friendly
 * placeholder when empty.
 *
 * Behavior by page:
 *   - `workspace` — projects (top, capped at 4) + conversations (bottom, scrolls).
 *   - `projects`  — full projects list, scrollable.
 *   - `settings`  — returns `null` (settings page has its own sub-nav).
 *   - `skills`    — returns `null` (skills page has its own built-in rail).
 *   - `wizard`    — returns `null` (first-run wizard is chromeless).
 */
export function SecondarySide({
  page,
  projects = [],
  conversations = [],
  activeProjectId,
  activeConversationId,
  onProjectSelect,
  onConversationSelect,
  onNewConversation
}: SecondarySideProps) {
  const { t } = useTranslation();

  // Skills, wizard, and settings hide the secondary rail entirely.
  // Settings has its own sub-nav, so the global rail would be redundant.
  if (page === 'skills' || page === 'wizard' || page === 'settings') {
    return null;
  }

  const renderProjectItem = (p: ProjectSummary) => {
    const dotState = p.state === 'live' ? 'live' : p.state === 'conn' ? 'conn' : '';
    return (
      <div
        key={p.id}
        className={`proj-item ${p.id === activeProjectId ? 'active' : ''}`}
        onClick={() => onProjectSelect?.(p.id)}
      >
        <span className={`proj-dot ${dotState}`} />
        <span>{p.name}</span>
        {p.env ? <span className="proj-meta">{p.env}</span> : null}
      </div>
    );
  };

  const emptyProjects = (
    <div className="muted small" style={{ padding: '12px 14px' }}>
      {t('side.noProjects')}
    </div>
  );

  const emptyConversations = (
    <div className="muted small" style={{ padding: '12px 14px' }}>
      {t('side.noConversations')}
    </div>
  );

  if (page === 'projects') {
    return (
      <aside className="side">
        <div className="side-head">
          <h2>{t('nav.projects')}</h2>
          <span className="sub">{projects.length}</span>
        </div>
        <div className="side-sec" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <div className="side-label">{t('nav.projects')}</div>
          {projects.length === 0 ? emptyProjects : projects.map(renderProjectItem)}
        </div>
      </aside>
    );
  }

  // page === 'workspace'
  const workspaceProjects = projects.slice(0, 4);
  return (
    <aside className="side">
      <div className="side-head">
        <h2>{t('nav.workspace')}</h2>
      </div>
      <div className="side-sec">
        <div className="side-label">
          <span>{t('nav.projects')}</span>
          <span className="count">{projects.length}</span>
        </div>
        {workspaceProjects.length === 0
          ? emptyProjects
          : workspaceProjects.map(renderProjectItem)}
      </div>
      <div className="side-sec" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <div className="side-label">
          <span>{t('side.conversations')}</span>
          <span className="count">{conversations.length}</span>
          {onNewConversation && (
            <button
              type="button"
              onClick={onNewConversation}
              className="side-action"
              title={t('side.newConversation')}
              aria-label={t('side.newConversation')}
            >
              +
            </button>
          )}
        </div>
        {conversations.length === 0
          ? emptyConversations
          : conversations.map((c) => (
              <div
                key={c.id}
                className={`conv-item ${c.id === activeConversationId ? 'active' : ''}`}
                onClick={() => onConversationSelect?.(c.id)}
              >
                <div className="conv-title">{c.title}</div>
                <div className="conv-meta">
                  <span>{c.date}</span>
                  {c.tag ? <span className={`chip ${c.tagColor ?? ''}`}>{c.tag}</span> : null}
                </div>
              </div>
            ))}
      </div>
    </aside>
  );
}

export default SecondarySide;
