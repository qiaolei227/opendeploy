import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@renderer/i18n';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDERS, PROVIDER_BY_ID, resolveActiveModel, type LlmProvider, type LlmModel } from '@renderer/data/providers';
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

type SettingsSection = 'appearance' | 'llm' | 'about';

/**
 * SettingsPage — settings surface of OpenDeploy.
 *
 * Restructured from a flat long page to a 2-column layout with a left
 * sub-nav. Sections:
 *
 * - Appearance: language + theme.
 * - LLM Provider: 11-card provider grid + API Key input (Ollama is local
 *   and skips the input).
 * - About: version, license, source link, copyright.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSection>('appearance');

  const navItems: { key: SettingsSection; label: string }[] = [
    { key: 'appearance', label: t('settings.sectionAppearance') },
    { key: 'llm', label: t('settings.sectionLlm') },
    { key: 'about', label: t('settings.sectionAbout') }
  ];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left sub-nav */}
      <nav
        style={{
          width: 200,
          borderRight: '1px solid var(--border)',
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflowY: 'auto'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, margin: '0 4px 16px' }}>
          {t('settings.title')}
        </div>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSection(item.key)}
            style={{
              padding: '8px 12px',
              textAlign: 'left',
              border: 'none',
              borderRadius: 6,
              background:
                section === item.key ? 'var(--surface-hover)' : 'transparent',
              color: section === item.key ? 'var(--ink)' : 'var(--muted)',
              fontWeight: section === item.key ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Right content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {section === 'appearance' && <AppearanceSection />}
        {section === 'llm' && <LlmSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </div>
  );
}

/**
 * AppearanceSection — language + theme switcher.
 */
function AppearanceSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const handleLanguageChange = async (lang: Language): Promise<void> => {
    await setLanguage(lang);
    await i18n.changeLanguage(lang);
  };

  const handleThemeChange = async (theme: Theme): Promise<void> => {
    await setTheme(theme);
  };

  return (
    <section>
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
  );
}

/**
 * LlmSection — 11-card provider grid + API Key input + Save.
 */
function LlmSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setLlmProvider = useSettingsStore((s) => s.setLlmProvider);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const setModel = useSettingsStore((s) => s.setModel);
  const setOllamaModelInput = useSettingsStore((s) => s.setOllamaModelInput);

  const initialProviderId = settings.llmProvider ?? 'deepseek';
  const [selectedProviderId, setSelectedProviderId] =
    useState<string>(initialProviderId);
  const provider: LlmProvider | undefined = PROVIDER_BY_ID[selectedProviderId];

  const [apiKeyInput, setApiKeyInput] = useState<string>(
    settings.apiKeys?.[initialProviderId] ?? ''
  );
  const [saved, setSaved] = useState(false);

  const [selectedModelId, setSelectedModelId] = useState<string>(
    () => resolveActiveModel(selectedProviderId, settings.modelByProvider)?.id ?? ''
  );
  const selectedModel: LlmModel | undefined =
    provider?.models.find((m) => m.id === selectedModelId);

  const [ollamaInput, setOllamaInput] = useState<string>(
    () => settings.ollamaModelInput ?? PROVIDER_BY_ID['ollama']?.modelInputDefault ?? ''
  );

  // Re-resolve when provider changes (selectedProviderId mutates as user clicks cards)
  useEffect(() => {
    const m = resolveActiveModel(selectedProviderId, settings.modelByProvider);
    setSelectedModelId(m?.id ?? '');
  }, [selectedProviderId, settings.modelByProvider]);

  const handleModelChange = async (id: string): Promise<void> => {
    setSelectedModelId(id);
    await setModel(selectedProviderId, id);
  };
  const handleOllamaInputBlur = async (): Promise<void> => {
    if (ollamaInput.trim()) await setOllamaModelInput(ollamaInput.trim());
  };

  const handleProviderSelect = async (provider: LlmProvider): Promise<void> => {
    setSelectedProviderId(provider.id);
    setApiKeyInput(settings.apiKeys?.[provider.id] ?? '');
    setSaved(false);
    await setLlmProvider(provider.id);
  };

  const handleSave = async (): Promise<void> => {
    await setApiKey(selectedProviderId, apiKeyInput);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const isOllama = selectedProviderId === 'ollama';

  return (
    <>
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
                    {p.id === 'ollama'
                      ? t('settings.customModel')
                      : t('settings.modelCount', { count: p.models.length })}
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

      {!isOllama && provider && provider.models.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.model')}</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{t('settings.modelHint')}</p>
          <div className="setting-row" style={{ borderBottom: 'none', alignItems: 'flex-start' }}>
            <div>
              <div className="lbl">{provider.label}</div>
            </div>
            <div className="ctl" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select
                value={selectedModelId}
                onChange={(e) => { void handleModelChange(e.target.value); }}
                style={{ minWidth: 280, padding: '6px 8px' }}
              >
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.recommended ? ` (${t('settings.recommendedShort')})` : ''} — {m.hint}
                  </option>
                ))}
              </select>
              {selectedModel && (
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  {t('settings.contextLabel')}: {(selectedModel.contextWindow / 1000).toFixed(0)}K ·{' '}
                  {t('settings.maxOutputLabel')}: {(selectedModel.maxOutput / 1000).toFixed(1)}K ·{' '}
                  {t('settings.priceLabel')}: {selectedModel.pricing}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {isOllama && (
        <section style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.model')}</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{t('settings.modelOllamaHint')}</p>
          <div className="setting-row" style={{ borderBottom: 'none' }}>
            <div><div className="lbl">{t('settings.model')}</div></div>
            <div className="ctl">
              <input
                type="text"
                value={ollamaInput}
                onChange={(e) => setOllamaInput(e.target.value)}
                onBlur={() => { void handleOllamaInputBlur(); }}
                placeholder={t('settings.modelOllamaPlaceholder')}
                style={{ minWidth: 280 }}
              />
            </div>
          </div>
        </section>
      )}

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
            <div className="ctl" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
    </>
  );
}

/**
 * AboutSection — version, license, source, copyright.
 */
function AboutSection() {
  const { t } = useTranslation();
  return (
    <section>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.sectionAbout')}</h3>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutVersion')}</div>
        </div>
        <div className="ctl">
          <span className="mono small">v0.1.0-alpha.1</span>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutLicense')}</div>
        </div>
        <div className="ctl">
          <span className="mono small">MIT</span>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutSource')}</div>
        </div>
        <div className="ctl">
          <a
            href="https://github.com/yourname/opendeploy"
            target="_blank"
            rel="noreferrer"
            className="mono small"
            style={{ color: 'var(--accent-deep)' }}
          >
            github.com/yourname/opendeploy
          </a>
        </div>
      </div>
      <div className="setting-row" style={{ borderBottom: 'none' }}>
        <div>
          <div className="lbl">{t('settings.aboutCopyright')}</div>
        </div>
      </div>
    </section>
  );
}

export default SettingsPage;
