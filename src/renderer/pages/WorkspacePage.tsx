import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { Composer } from '@renderer/components/Composer';
import { MessageList } from '@renderer/components/MessageList';

interface WorkspacePageProps {
  llmProviderId?: string;
}

export function WorkspacePage({ llmProviderId }: WorkspacePageProps) {
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);

  return (
    <div className="ws">
      <div className="chat-col">
        {messages.length === 0 ? (
          <div className="chat-scroll">
            <div className="chat-inner">
              <EmptyState />
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
        <Composer llmProviderId={llmProviderId} />
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div style={{padding: '40px 0'}}>
      <h1 style={{fontSize: 28, letterSpacing: '-0.02em', margin: '0 0 6px'}}>
        <span style={{fontFamily: 'var(--font-serif)', fontWeight: 500}}>
          {t('workspace.emptyHeading')}
        </span>
      </h1>
      <p className="muted" style={{margin: 0}}>{t('workspace.emptyDesc')}</p>
    </div>
  );
}
