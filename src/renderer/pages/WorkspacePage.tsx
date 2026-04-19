import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Composer } from '@renderer/components/Composer';
import { Icons } from '@renderer/components/icons';

export interface WorkspacePageProps {
  /** Currently selected LLM provider id, forwarded to the Composer chip. */
  llmProviderId?: string;
}

interface PromptCard {
  tag: string;
  titleKey: string;
  descKey: string;
}

const PROMPTS: PromptCard[] = [
  { tag: 'SAL', titleKey: 'workspace.prompt1Title', descKey: 'workspace.prompt1Desc' },
  { tag: 'BD', titleKey: 'workspace.prompt2Title', descKey: 'workspace.prompt2Desc' },
  { tag: 'STK', titleKey: 'workspace.prompt3Title', descKey: 'workspace.prompt3Desc' },
  { tag: 'AP', titleKey: 'workspace.prompt4Title', descKey: 'workspace.prompt4Desc' }
];

/**
 * EmptyState — initial workspace view shown when there is no active
 * conversation yet (the only view wired up in MVP-0.1).
 *
 * Ported from `design/components/Workspace.jsx` `EmptyState` function.
 * Renders a heading, description, four sample prompt cards (2x2 grid), and
 * a security reassurance card about the SQL whitelist.
 *
 * `onPick(promptText)` is invoked with the card's localized title when a
 * prompt card is clicked. The parent uses this to pre-fill the Composer.
 */
function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();

  return (
    <div style={{ padding: '40px 0' }}>
      <h1 style={{ fontSize: 28, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 500 }}>
          {t('workspace.emptyHeading')}
        </span>
      </h1>
      <p className="muted" style={{ margin: '0 0 24px' }}>
        {t('workspace.emptyDesc')}
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 24
        }}
      >
        {PROMPTS.map((p) => {
          const title = t(p.titleKey);
          return (
            <button
              key={p.tag}
              type="button"
              className="card"
              style={{ textAlign: 'left', padding: '14px 16px', margin: 0, cursor: 'pointer' }}
              onClick={() => onPick(title)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="chip accent">{p.tag}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t(p.descKey)}
              </div>
            </button>
          );
        })}
      </div>
      <div
        className="card"
        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: 0, padding: 12 }}
      >
        <span style={{ color: 'var(--accent-deep)', marginTop: 2 }}>{Icons.shield}</span>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {t('workspace.securityReassurance')}
        </div>
      </div>
    </div>
  );
}

/**
 * WorkspacePage — main chat surface of OpenDeploy.
 *
 * MVP-0.1 scope: always renders the EmptyState (no conversation concept yet)
 * plus a non-functional Composer shell. Clicking a prompt card pre-fills the
 * Composer textarea as a UI affordance only — there is no backend wired.
 *
 * Full multi-stage chat (clarify / tools / code) and Inspector panels
 * (metadata, whitelist, artifacts) come in later milestones.
 */
export function WorkspacePage({ llmProviderId }: WorkspacePageProps) {
  const [presetText, setPresetText] = useState<string | undefined>(undefined);

  return (
    <div className="ws">
      <div className="chat-col">
        <div className="chat-scroll">
          <div className="chat-inner">
            <EmptyState onPick={setPresetText} />
          </div>
        </div>
        <Composer llmProviderId={llmProviderId} presetText={presetText} />
      </div>
    </div>
  );
}

export default WorkspacePage;
