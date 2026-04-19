import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ThemeProvider } from '@renderer/components/ThemeProvider';
import { TitleBar } from '@renderer/components/TitleBar';
import { NavRail, type PageKey } from '@renderer/components/NavRail';
import { SecondarySide } from '@renderer/components/SecondarySide';
import { StatusBar } from '@renderer/components/StatusBar';
import { WorkspacePage } from '@renderer/pages/WorkspacePage';
import { SettingsPage } from '@renderer/pages/SettingsPage';
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

  // Fetch settings if the bootstrap didn't pre-hydrate the store (defensive).
  useEffect(() => {
    if (!loaded) {
      void load();
    }
  }, [loaded, load]);

  // First-launch detection: no provider configured → show the wizard.
  useEffect(() => {
    if (loaded && !settings.llmProvider && !wizardCompleted) {
      setPage('wizard');
    }
  }, [loaded, settings.llmProvider, wizardCompleted]);

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
  const appClass = `app ${isWizard ? 'mode-wizard' : ''} ${isBare ? 'mode-skills' : ''}`;

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
            {page === 'skills' && <SkillsPlaceholder />}
          </main>

          {!isWizard && (
            <StatusBar
              llmProviderId={settings.llmProvider}
              bosConnected={false}
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

/** Placeholder for the Skills page — full implementation lands in MVP-1. */
function SkillsPlaceholder() {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '40px', color: 'var(--muted)' }}>
      <h2>{t('nav.skills')}</h2>
      <p>{t('placeholders.skillsSoon')}</p>
    </div>
  );
}

export default App;
