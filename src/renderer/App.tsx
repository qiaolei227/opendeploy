import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSkillsStore } from '@renderer/stores/skills-store';
import { useChatStore } from '@renderer/stores/chat-store';
import { useProjectsStore } from '@renderer/stores/projects-store';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ThemeProvider } from '@renderer/components/ThemeProvider';
import { TitleBar } from '@renderer/components/TitleBar';
import { NavRail, type PageKey } from '@renderer/components/NavRail';
import {
  SecondarySide,
  type ConversationSummary,
  type ProjectSummary
} from '@renderer/components/SecondarySide';
import { StatusBar } from '@renderer/components/StatusBar';
import { WorkspacePage } from '@renderer/pages/WorkspacePage';
import { SettingsPage } from '@renderer/pages/SettingsPage';
import { SkillsPage } from '@renderer/pages/SkillsPage';
import { ProjectsPage } from '@renderer/pages/ProjectsPage';
import { WizardPage } from '@renderer/pages/WizardPage';

/** Short relative time label: "刚刚" / "14:23" / "4月18日". Terminal-width safe. */
function formatConvDate(iso: string, lang: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
}

/**
 * App — root component that composes every surface in the renderer.
 *
 * Ported from `design/components/App.jsx` `App` function, adapted for MVP-0.1:
 *
 * - Reads settings from the Zustand store (hydrated by `main.tsx` before
 *   render), so the first paint already has the user's persisted language
 *   and theme applied.
 * - First-launch detection: if no `llmProvider` is configured and the user
 *   has not yet completed the wizard this session, we route them to the
 *   wizard automatically.
 * - Layout modes: `mode-wizard` hides chrome (titlebar / nav / side / status);
 *   `mode-skills` is reserved for the future skills page which carries its
 *   own rail (no skills page exists yet, but the class logic is in place so
 *   that design-system CSS selectors continue to work).
 * - Projects and Skills pages are placeholder stubs in MVP-0.1; the full
 *   implementations ship in MVP-1.
 */
export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const load = useSettingsStore((s) => s.load);

  const [page, setPage] = useState<PageKey>('workspace');
  const [wizardCompleted, setWizardCompleted] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const { t, i18n } = useTranslation();
  const chatConversationId = useChatStore((s) => s.conversationId);
  const chatMessages = useChatStore((s) => s.messages);
  const chatIsStreaming = useChatStore((s) => s.isStreaming);
  const chatClear = useChatStore((s) => s.clear);
  const chatLoadConversation = useChatStore((s) => s.loadConversation);

  const projects = useProjectsStore((s) => s.projects);
  const projectsConnectionState = useProjectsStore((s) => s.connectionState);
  const projectSummaries: ProjectSummary[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    // Full product label so a consultant can tell "which ERP" without
    // opening the project page. Falls back to the provider id if a new
    // provider ships before its i18n label lands.
    product: t(`projects.products.${p.erpProvider}`, {
      defaultValue: p.erpProvider
    }),
    state:
      projectsConnectionState.projectId === p.id
        ? projectsConnectionState.status === 'connected'
          ? 'live'
          : projectsConnectionState.status === 'connecting'
            ? 'conn'
            : 'idle'
        : 'idle'
  }));

  const refreshConversations = useCallback(async () => {
    try {
      const list = await window.opendeploy.conversationsList();
      // Map backend shape → SecondarySide ConversationSummary.
      const mapped: ConversationSummary[] = list.map((c) => ({
        id: c.id,
        title: c.title || t('side.untitledConversation'),
        date: formatConvDate(c.savedAt, i18n.language)
      }));
      setConversations(mapped);
    } catch {
      // Swallow — disk access can race with background writes. UI stays on last snapshot.
    }
  }, [t, i18n.language]);

  // Window/document title is pinned to the English brand so the OS taskbar
  // / window chrome stays stable across language switches.
  useEffect(() => {
    document.title = 'OpenDeploy';
    void window.opendeploy.setWindowTitle('OpenDeploy');
  }, []);

  // Fetch settings if the bootstrap didn't pre-hydrate the store (defensive).
  useEffect(() => {
    if (!loaded) {
      void load();
    }
  }, [loaded, load]);

  // Startup silent check: populate the Skills store once on mount so the
  // NavRail can surface an update badge without the user visiting the page.
  // Failures are stored in the store but don't surface outside the Skills page.
  useEffect(() => {
    const skillsStore = useSkillsStore.getState();
    void skillsStore.load();
    void skillsStore.checkUpdates();
  }, []);

  // Projects: load once + subscribe to live connection-state pushes. Both the
  // StatusBar and the workspace rail read from the same store so they stay
  // consistent without manual prop threading.
  useEffect(() => {
    const store = useProjectsStore.getState();
    void store.load();
    store.subscribeConnection();
  }, []);

  // Seed conversation list on mount + whenever the active chat changes.
  // The important signal for "file just landed on disk" is isStreaming going
  // true → false: saveConversation runs right before the `done` event, so once
  // the store flips to idle the .md file exists. Including it in the deps
  // guarantees the recent list refreshes the moment a first reply finishes.
  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations, chatConversationId, chatMessages.length, chatIsStreaming]);

  // First-launch detection: show wizard if setup is incomplete.
  // Incomplete = no provider OR (non-Ollama provider without API key).
  useEffect(() => {
    if (!loaded || wizardCompleted) return;
    const provider = settings.llmProvider;
    if (!provider) {
      setPage('wizard');
      return;
    }
    const needsApiKey = provider !== 'ollama';
    const hasApiKey = !needsApiKey || !!settings.apiKeys?.[provider];
    if (!hasApiKey) {
      setPage('wizard');
    }
  }, [loaded, settings.llmProvider, settings.apiKeys, wizardCompleted]);

  if (!loaded) {
    return (
      <div
        className="app-loading"
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)'
        }}
      >
        Loading…
      </div>
    );
  }

  const isWizard = page === 'wizard';
  // Skills page has its own built-in rail (mode-skills removes the side rail);
  // not used yet in MVP-0.1, but the class logic matches the design prototype
  // so design-system CSS continues to line up once SkillsPage lands.
  const isBare = page === 'skills';
  const isSettings = page === 'settings';
  const appClass = `app ${isWizard ? 'mode-wizard' : ''} ${isBare ? 'mode-skills' : ''} ${isSettings ? 'mode-settings' : ''}`;

  const handleWizardFinish = (): void => {
    setWizardCompleted(true);
    setPage('workspace');
  };

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className={appClass}>
          {!isWizard && <TitleBar />}
          {!isWizard && <NavRail current={page} onChange={setPage} />}
          {!isWizard && (
            <SecondarySide
              page={page}
              projects={projectSummaries}
              activeProjectId={projectsConnectionState.projectId ?? undefined}
              onProjectSelect={(id) => {
                void useProjectsStore.getState().setActive(id);
              }}
              conversations={conversations}
              activeConversationId={chatConversationId ?? undefined}
              onConversationSelect={(id) => {
                void chatLoadConversation(id);
                setPage('workspace');
              }}
              onNewConversation={() => {
                chatClear();
                setPage('workspace');
              }}
              onConversationDelete={(id) => {
                void (async () => {
                  await window.opendeploy.conversationsDelete(id);
                  // If the user killed the active conversation, clear the chat
                  // so the workspace doesn't keep the orphan transcript.
                  if (id === chatConversationId) chatClear();
                  await refreshConversations();
                })();
              }}
            />
          )}

          <main className="main">
            {page === 'workspace' && (
              <WorkspacePage llmProviderId={settings.llmProvider} onNavigate={setPage} />
            )}
            {page === 'settings' && <SettingsPage />}
            {page === 'wizard' && <WizardPage onFinish={handleWizardFinish} />}
            {page === 'projects' && <ProjectsPage />}
            {page === 'skills' && <SkillsPage />}
          </main>

          {!isWizard && (
            <StatusBar
              llmProviderId={settings.llmProvider}
              appVersion="v0.1.0-alpha.1"
            />
          )}
        </div>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
