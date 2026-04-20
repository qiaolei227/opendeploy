import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSkillsStore } from '@renderer/stores/skills-store';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ThemeProvider } from '@renderer/components/ThemeProvider';
import { TitleBar } from '@renderer/components/TitleBar';
import { NavRail, type PageKey } from '@renderer/components/NavRail';
import { SecondarySide } from '@renderer/components/SecondarySide';
import { StatusBar } from '@renderer/components/StatusBar';
import { WorkspacePage } from '@renderer/pages/WorkspacePage';
import { SettingsPage } from '@renderer/pages/SettingsPage';
import { SkillsPage } from '@renderer/pages/SkillsPage';
import { WizardPage } from '@renderer/pages/WizardPage';

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

  const { t } = useTranslation();

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
          {!isWizard && <SecondarySide page={page} />}

          <main className="main">
            {page === 'workspace' && (
              <WorkspacePage llmProviderId={settings.llmProvider} />
            )}
            {page === 'settings' && <SettingsPage />}
            {page === 'wizard' && <WizardPage onFinish={handleWizardFinish} />}
            {page === 'projects' && <ProjectsPlaceholder />}
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

/** Placeholder for the Projects page — full implementation lands in MVP-1. */
function ProjectsPlaceholder() {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '40px', color: 'var(--muted)' }}>
      <h2>{t('nav.projects')}</h2>
      <p>{t('placeholders.projectsSoon')}</p>
    </div>
  );
}

export default App;
