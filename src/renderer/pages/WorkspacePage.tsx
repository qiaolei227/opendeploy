import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { Composer } from '@renderer/components/Composer';
import { MessageList } from '@renderer/components/MessageList';
import { ArtifactsPanel } from '@renderer/components/ArtifactsPanel';

interface WorkspacePageProps {
  llmProviderId?: string;
}

export function WorkspacePage({ llmProviderId }: WorkspacePageProps) {
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const isEmpty = messages.length === 0;

  return (
    <div className="ws" style={{ display: 'flex', height: '100%' }}>
      <div
        className={`chat-col${isEmpty ? ' is-empty' : ''}`}
        style={{ flex: 1, minWidth: 0 }}
      >
        {isEmpty ? (
          <div className="chat-empty-hero">
            <EmptyState />
            <Composer llmProviderId={llmProviderId} />
          </div>
        ) : (
          <>
            <MessageList messages={messages} />
            {error && (
              <div style={{padding: '8px 20px', color: 'var(--danger)', fontSize: 12}}>
                {error}
              </div>
            )}
            <Composer llmProviderId={llmProviderId} />
          </>
        )}
      </div>
      <ArtifactsPanel />
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="chat-empty-heading">
      <h1 style={{fontSize: 28, letterSpacing: '-0.02em', margin: '0 0 6px'}}>
        <span style={{fontFamily: 'var(--font-serif)', fontWeight: 500}}>
          {t('workspace.emptyHeading')}
        </span>
      </h1>
      <p className="muted" style={{margin: 0}}>{t('workspace.emptyDesc')}</p>
    </div>
  );
}
