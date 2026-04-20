import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDERS, PROVIDER_BY_ID } from '@renderer/data/providers';
import { Icons } from '@renderer/components/icons';

interface WizardPageProps {
  /** Called after the user clicks "Finish" on the final step. */
  onFinish: () => void;
}

/**
 * WizardPage — 3-step onboarding wizard.
 *
 * Ported from `design/components/Wizard.jsx` (99 lines). The flow is:
 * 1. Welcome — positioning card ("your toolbox, not a SaaS") with three
 *    feature pitches (zero server / BYO-LLM / ERP-native).
 * 2. LLM provider — 2-column grid picker (subset of SettingsPage's 3-col
 *    layout) that stages a provider choice without persisting yet.
 * 3. Done — summary card echoing the chosen provider and a hint about
 *    creating the first project.
 *
 * Only on clicking "Start" (last step) do we persist the provider via
 * `setLlmProvider` and invoke `onFinish`, letting the parent navigate.
 * The "Continue" button on step 1 is disabled until a provider is picked,
 * so the wizard can never complete without a selection.
 */
export function WizardPage({ onFinish }: WizardPageProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const setLlmProvider = useSettingsStore((s) => s.setLlmProvider);
  const setApiKey = useSettingsStore((s) => s.setApiKey);

  const steps = [
    t('wizard.stepWelcome'),
    t('wizard.stepProvider'),
    t('wizard.stepDone')
  ];

  const selectedProviderLabel =
    (selectedProvider && PROVIDER_BY_ID[selectedProvider]?.short) ?? '—';

  const featureCards = [
    { icon: Icons.shield, title: t('wizard.feat1Title'), desc: t('wizard.feat1Desc') },
    { icon: Icons.brain, title: t('wizard.feat2Title'), desc: t('wizard.feat2Desc') },
    { icon: Icons.book, title: t('wizard.feat3Title'), desc: t('wizard.feat3Desc') }
  ];

  const handleFinish = async (): Promise<void> => {
    if (selectedProvider) {
      await setLlmProvider(selectedProvider);
      if (selectedProvider !== 'ollama' && apiKeyInput.trim()) {
        await setApiKey(selectedProvider, apiKeyInput.trim());
      }
    }
    onFinish();
  };

  return (
    <div className="wizard">
      <div className="wiz-card">
        <div className="wiz-logo">
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
            <rect x="2" y="2" width="44" height="44" rx="10" fill="#3d7a5a" />
            <rect x="14" y="11" width="20" height="12" rx="2" fill="#fafaf7" />
            <path
              d="M20 27 L24 31 L28 27"
              stroke="#fafaf7"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
            <line
              x1="10"
              y1="37"
              x2="38"
              y2="37"
              stroke="#fafaf7"
              strokeWidth="2.5"
              strokeLinecap="square"
            />
          </svg>
        </div>
        <h1>
          <span className="wiz-brand-cn ser">开达</span>
          <span className="wiz-brand-en">OpenDeploy</span>
        </h1>
        <div className="wsub">{t('wizard.tagline')}</div>

        <div className="wiz-stepper">
          {steps.map((s, i) => (
            <Fragment key={i}>
              <span className={`s ${i < step ? 'done' : i === step ? 'cur' : ''}`}>
                <span className="n">{i < step ? '✓' : i + 1}</span>
                {s}
              </span>
              {i < steps.length - 1 && <span className="dash" />}
            </Fragment>
          ))}
        </div>

        <div className="wiz-body">
          {step === 0 && (
            <>
              <h3>{t('wizard.welcomeHeading')}</h3>
              <div className="hint">
                {t('wizard.welcomeDesc')} <strong>{t('wizard.welcomeEmphasis')}</strong>
              </div>
              <div className="card" style={{ margin: 0, padding: 16 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 12
                  }}
                >
                  {featureCards.map((c, i) => (
                    <div
                      key={i}
                      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                    >
                      <span style={{ color: 'var(--accent-deep)' }}>{c.icon}</span>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{c.title}</div>
                      <div className="muted small">{c.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h3>{t('wizard.providerHeading')}</h3>
              <div className="hint">{t('wizard.providerDesc')}</div>
              <div className="prov-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                {PROVIDERS.map((p) => {
                  const active = selectedProvider === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`prov-card${active ? ' on' : ''}`}
                      onClick={() => setSelectedProvider(p.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedProvider(p.id);
                        }
                      }}
                    >
                      <div className="prov-title">
                        <span className={`prov-dot ${p.dot}`}>{p.letter}</span>
                        {p.label}
                        {p.recommended && (
                          <span className="chip accent" style={{ marginLeft: 'auto' }}>
                            {t('settings.recommended')}
                          </span>
                        )}
                      </div>
                      <div className="prov-sub">{p.sub}</div>
                    </div>
                  );
                })}
              </div>
              {selectedProvider && (
                <div style={{ marginTop: 16 }}>
                  {selectedProvider === 'ollama' ? (
                    <div className="hint">{t('settings.ollamaNoKey')}</div>
                  ) : (
                    <>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 12,
                          fontWeight: 600,
                          marginBottom: 6
                        }}
                      >
                        {t('settings.apiKey')}
                      </label>
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={t('settings.apiKeyPlaceholder')}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          background: 'var(--surface)',
                          color: 'var(--ink)',
                          fontSize: 13,
                          fontFamily: 'var(--font-mono)'
                        }}
                      />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h3>{t('wizard.doneHeading')}</h3>
              <div className="hint">{t('wizard.doneDesc')}</div>
              <div className="card" style={{ margin: 0, padding: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 8
                  }}
                >
                  <span className="muted small">LLM</span>
                  <span className="mono small">{selectedProviderLabel}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 8
                  }}
                >
                  <span className="muted small">{t('wizard.skillLib')}</span>
                  <span className="mono small">@built-in · 2026-04-19</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted small">{t('wizard.next')}</span>
                  <span className="mono small" style={{ color: 'var(--accent-deep)' }}>
                    {t('wizard.nextAction')}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="wiz-foot">
          <button
            className="btn"
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            {t('wizard.back')}
          </button>
          <span className="wiz-progress">
            {step + 1} / {steps.length}
          </span>
          {step < steps.length - 1 ? (
            <button
              className="btn primary lg"
              type="button"
              disabled={
                step === 1 &&
                (!selectedProvider ||
                  (selectedProvider !== 'ollama' && !apiKeyInput.trim()))
              }
              onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            >
              {t('wizard.continue')}
            </button>
          ) : (
            <button
              className="btn accent lg"
              type="button"
              onClick={() => {
                void handleFinish();
              }}
            >
              {t('wizard.finish')} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default WizardPage;
