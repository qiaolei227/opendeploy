import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import './styles/global.css';

/**
 * Renderer entry point.
 *
 * Bootstrap sequence:
 *   1. Pull persisted settings from the main process (single IPC round-trip).
 *   2. Initialise i18next with the saved language — happens BEFORE React
 *      renders so the first paint shows the correct locale (no en-US flash
 *      for zh-CN users).
 *   3. Pre-populate the Zustand settings store so `loaded` is already `true`
 *      when `App` mounts, avoiding a "Loading…" frame and a flash of
 *      DEFAULT_SETTINGS in any component that reads from the store.
 *   4. Render.
 *
 * If any of the above fails (missing preload, corrupt settings file, etc.),
 * we render a plain-HTML fallback so the user sees a helpful message instead
 * of a blank window.
 */
async function bootstrap(): Promise<void> {
  try {
    const settings = await window.opendeploy.getSettings();
    await initI18n(settings.language);

    // Pre-populate the Zustand store with initial settings
    // (avoids a flash of DEFAULT_SETTINGS before load() resolves).
    const { useSettingsStore } = await import('./stores/settings-store');
    useSettingsStore.setState({ settings, loaded: true });

    const root = document.getElementById('root');
    if (!root) {
      throw new Error('Root element not found');
    }

    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to bootstrap:', err);
    const root = document.getElementById('root');
    if (root) {
      const message = err instanceof Error ? err.message : String(err);
      root.innerHTML = `<div style="padding: 2rem; font-family: sans-serif; color: #c33;">
        <h1>Failed to start OpenDeploy</h1>
        <pre>${message}</pre>
        <p>See console for details.</p>
      </div>`;
    }
  }
}

void bootstrap();
