import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { useProjectsStore } from '@renderer/stores/projects-store';
import { Composer } from '@renderer/components/Composer';
import { MessageList } from '@renderer/components/MessageList';
import { ArtifactsPanel } from '@renderer/components/ArtifactsPanel';
import type { PageKey } from '@renderer/components/NavRail';

interface WorkspacePageProps {
  llmProviderId?: string;
  onNavigate?: (page: PageKey) => void;
}

export function WorkspacePage({ llmProviderId, onNavigate }: WorkspacePageProps) {
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const hasActiveProject = useProjectsStore((s) => Boolean(s.connectionState.projectId));
  const isEmpty = messages.length === 0;

  return (
    <div className="ws" style={{ display: 'flex', height: '100%' }}>
      <div
        className={`chat-col${isEmpty ? ' is-empty' : ''}`}
        style={{ flex: 1, minWidth: 0 }}
      >
        {isEmpty ? (
          <div className="chat-empty-hero">
            {hasActiveProject ? (
              <>
                <Heading textKey="workspace.emptyHeading" />
                <Composer llmProviderId={llmProviderId} />
              </>
            ) : (
              <NoProjectState onNavigate={onNavigate} />
            )}
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

function Heading({ textKey }: { textKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="chat-empty-heading">
      <h1 style={{fontSize: 28, letterSpacing: '-0.02em', margin: 0}}>
        <span style={{fontFamily: 'var(--font-serif)', fontWeight: 500}}>
          {t(textKey)}
        </span>
      </h1>
    </div>
  );
}

function NoProjectState({ onNavigate }: { onNavigate?: (page: PageKey) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Heading textKey="workspace.noProjectHeading" />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          className="btn accent"
          onClick={() => onNavigate?.('projects')}
        >
          {t('workspace.noProjectButton')}
        </button>
      </div>
    </>
  );
}
