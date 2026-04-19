import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@renderer/i18n';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDERS, type LlmProvider } from '@renderer/data/providers';
import type { Language, Theme } from '@shared/types';

const LANGUAGES: { value: Language; labelKey: string }[] = [
  { value: 'zh-CN', labelKey: 'zh-CN' },
  { value: 'en-US', labelKey: 'en-US' }
];

const THEMES: { value: Theme; labelKey: string }[] = [
  { value: 'light', labelKey: 'settings.themeLight' },
  { value: 'dark', labelKey: 'settings.themeDark' },
  { value: 'system', labelKey: 'settings.themeSystem' }
];

/**
 * SettingsPage — settings surface of OpenDeploy.
 *
 * Ported from `design/components/Pages.jsx` `SettingsPage` function.
 * MVP-0.1 scope is focused:
 *
 * - Appearance: language switcher (zh-CN / en-US) and theme switcher
 *   (light / dark / system).
 * - LLM Provider: full 11-provider grid from `data/providers.ts`. Clicking a
 *   card selects it as the active provider; selection is persisted via the
 *   settings store.
 * - API Key: password input bound to the selected provider's stored key.
 *   Save button persists to settings (encryption happens in the main process,
 *   out of scope for this file). Ollama is local and skips the input.
 *
 * Skipped for later milestones: Skill sources, BOS connection, audit log,
 * multi-tab navigation, "connection history", code-comment language, etc.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLlmProvider = useSettingsStore((s) => s.setLlmProvider);
  const setApiKey = useSettingsStore((s) => s.setApiKey);

  const initialProviderId = settings.llmProvider ?? 'deepseek';
  const [selectedProviderId, setSelectedProviderId] = useState<string>(initialProviderId);
  const [apiKeyInput, setApiKeyInput] = useState<string>(
    settings.apiKeys?.[initialProviderId] ?? ''
  );
  const [saved, setSaved] = useState(false);

  const handleLanguageChange = async (lang: Language): Promise<void> => {
    await setLanguage(lang);
    await i18n.changeLanguage(lang);
  };

  const handleThemeChange = async (theme: Theme): Promise<void> => {
    await setTheme(theme);
  };

  const handleProviderSelect = async (provider: LlmProvider): Promise<void> => {
    setSelectedProviderId(provider.id);
    // Load the stored key for the newly-selected provider (empty if none).
    setApiKeyInput(settings.apiKeys?.[provider.id] ?? '');
    setSaved(false);
    await setLlmProvider(provider.id);
  };

  const handleSave = async (): Promise<void> => {
    await setApiKey(selectedProviderId, apiKeyInput);
    setSaved(true);
    // Hide the "saved" confirmation after a brief moment.
    window.setTimeout(() => setSaved(false), 2000);
  };

  const isOllama = selectedProviderId === 'ollama';

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <h1 className="page-title">
          <span className="ser">{t('settings.title')}</span>
        </h1>
        <p className="page-sub">{t('settings.subtitle')}</p>

        {/* Appearance section: language + theme */}
        <section style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.appearance')}</h3>
          <div className="setting-row">
            <div>
              <div className="lbl">{t('settings.language')}</div>
            </div>
            <div className="ctl" style={{ display: 'flex', gap: 6 }}>
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  className={`btn${settings.language === l.value ? ' primary' : ''}`}
                  onClick={() => {
                    void handleLanguageChange(l.value);
                  }}
                >
                  {l.value === 'zh-CN' ? '中文' : 'English'}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row" style={{ borderBottom: 'none' }}>
            <div>
              <div className="lbl">{t('settings.theme')}</div>
            </div>
            <div className="ctl" style={{ display: 'flex', gap: 6 }}>
              {THEMES.map((th) => (
                <button
                  key={th.value}
                  type="button"
                  className={`btn${settings.theme === th.value ? ' primary' : ''}`}
                  onClick={() => {
                    void handleThemeChange(th.value);
                  }}
                >
                  {t(th.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* LLM Provider section: 11-card grid */}
        <section style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.llmSection')}</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {t('settings.llmSectionDesc')}
          </p>
          <div className="prov-grid">
            {PROVIDERS.map((p) => {
              const active = selectedProviderId === p.id;
              return (
                <div
                  key={p.id}
                  className={`prov-card${active ? ' on' : ''}`}
                  onClick={() => {
                    void handleProviderSelect(p);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void handleProviderSelect(p);
                    }
                  }}
                >
                  <div className="prov-title">
                    <span className={`prov-dot ${p.dot}`}>{p.letter}</span>
                    {p.label}
                    {p.recommended && !active && (
                      <span className="chip" style={{ marginLeft: 'auto', fontSize: 10 }}>
                        {t('settings.recommended')}
                      </span>
                    )}
                    {active && (
                      <span className="chip accent" style={{ marginLeft: 'auto' }}>
                        active
                      </span>
                    )}
                  </div>
                  <div className="prov-sub">{p.sub}</div>
                  <div className="prov-row">
                    <span>
                      {t('settings.latency')} {p.lat}
                    </span>
                    <span>·</span>
                    <span>
                      {t('settings.cost')} {p.cost}
                    </span>
                    <span
                      className={`chip${p.region === 'Local' ? ' good' : p.region === 'CN' ? ' accent' : ''}`}
                      style={{ marginLeft: 'auto', fontSize: 10 }}
                    >
                      {t(`settings.regions.${p.region}`)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* API Key section: hidden for Ollama (local, no key needed) */}
        <section>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.apiKeySection')}</h3>
          {isOllama ? (
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              {t('settings.ollamaNoKey')}
            </p>
          ) : (
            <div className="setting-row" style={{ borderBottom: 'none' }}>
              <div>
                <div className="lbl">
                  {t('settings.apiKey')} ({selectedProviderId})
                </div>
              </div>
              <div
                className="ctl"
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={t('settings.apiKeyPlaceholder')}
                  style={{ minWidth: 260 }}
                />
                <button
                  type="button"
                  className="btn primary lg"
                  onClick={() => {
                    void handleSave();
                  }}
                >
                  {t('settings.save')}
                </button>
                {saved && <span className="chip good">{t('settings.saved')}</span>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default SettingsPage;
