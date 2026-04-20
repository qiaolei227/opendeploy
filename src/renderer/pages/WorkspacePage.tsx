import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { Composer } from '@renderer/components/Composer';
import { MessageList } from '@renderer/components/MessageList';
import { Icons } from '@renderer/components/icons';

interface WorkspacePageProps {
  llmProviderId?: string;
}

export function WorkspacePage({ llmProviderId }: WorkspacePageProps) {
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const [presetText, setPresetText] = useState<string>('');

  return (
    <div className="ws">
      <div className="chat-col">
        {messages.length === 0 ? (
          <div className="chat-scroll">
            <div className="chat-inner">
              <EmptyState onPick={(t) => setPresetText(t)} />
            </div>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
        {error && (
          <div style={{padding: '8px 20px', color: 'var(--danger)', fontSize: 12}}>
            {error}
          </div>
        )}
        <Composer llmProviderId={llmProviderId} presetText={presetText} />
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();
  const prompts = [
    { tag: 'SAL', titleKey: 'workspace.prompt1Title', descKey: 'workspace.prompt1Desc' },
    { tag: 'BD',  titleKey: 'workspace.prompt2Title', descKey: 'workspace.prompt2Desc' },
    { tag: 'STK', titleKey: 'workspace.prompt3Title', descKey: 'workspace.prompt3Desc' },
    { tag: 'AP',  titleKey: 'workspace.prompt4Title', descKey: 'workspace.prompt4Desc' }
  ];

  return (
    <div style={{padding: '40px 0'}}>
      <h1 style={{fontSize: 28, letterSpacing: '-0.02em', margin: '0 0 6px'}}>
        <span style={{fontFamily: 'var(--font-serif)', fontWeight: 500}}>
          {t('workspace.emptyHeading')}
        </span>
      </h1>
      <p className="muted" style={{margin: '0 0 24px'}}>{t('workspace.emptyDesc')}</p>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24}}>
        {prompts.map((p, i) => (
          <button
            key={i}
            type="button"
            className="card"
            style={{textAlign: 'left', padding: '14px 16px', margin: 0, cursor: 'pointer'}}
            onClick={() => onPick(`${t(p.titleKey)}: ${t(p.descKey)}`)}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
              <span className="chip accent">{p.tag}</span>
              <span style={{fontWeight: 600, fontSize: 13}}>{t(p.titleKey)}</span>
            </div>
            <div className="muted" style={{fontSize: 12}}>{t(p.descKey)}</div>
          </button>
        ))}
      </div>
      <div className="card" style={{display: 'flex', gap: 10, alignItems: 'flex-start', margin: 0, padding: 12}}>
        <span style={{color: 'var(--accent-deep)', marginTop: 2}}>{Icons.shield}</span>
        <div style={{fontSize: 12, color: 'var(--muted)', lineHeight: 1.5}}>
          {t('workspace.securityReassurance')}
        </div>
      </div>
    </div>
  );
}
