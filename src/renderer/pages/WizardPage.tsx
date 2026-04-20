import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDERS, PROVIDER_BY_ID } from '@renderer/data/providers';
import { Icons } from '@renderer/components/icons';
import { LogoMark } from '@renderer/components/LogoMark';

interface WizardPageProps {
  /** Called after the user clicks "Finish" on the final step. */
  onFinish: () => void;
}

/**
 * WizardPage — 3-step onboarding wizard.
 *
 * Step 0 is a Linear-style minimalist hero (big logo + brand +
 * single-line tagline + primary CTA + one-line feature chips). The
 * stepper and `back` button only appear from Step 1 onward.
 *
 * Step 1 (provider) and Step 2 (done) keep the existing structure.
 */
export function WizardPage({ onFinish }: WizardPageProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const setLlmProvider = useSettingsStore((s) => s.setLlmProvider);
  const setApiKey = useSettingsStore((s) => s.setApiKey);

  // Stepper only covers the two "real" onboarding steps — Step 0 is a hero.
  const steps = [t('wizard.stepProvider'), t('wizard.stepDone')];
  const stepperIndex = step - 1; // -1 on step 0 = hidden

  const selectedProviderLabel =
    (selectedProvider && PROVIDER_BY_ID[selectedProvider]?.short) ?? '—';

  const handleFinish = async (): Promise<void> => {
    if (selectedProvider) {
      await setLlmProvider(selectedProvider);
      if (selectedProvider !== 'ollama' && apiKeyInput.trim()) {
        await setApiKey(selectedProvider, apiKeyInput.trim());
      }
    }
    onFinish();
  };

  const providerStepBlocked =
    !selectedProvider ||
    (selectedProvider !== 'ollama' && !apiKeyInput.trim());

  return (
    <div className="wizard">
      <div className="wiz-card">
        {step === 0 ? (
          <div className="wiz-hero">
            <div className="mark">
              <LogoMark size={80} variant="default" label="开达" />
            </div>
            <h1>{t('app.name')}</h1>
            <p className="tagline">{t('wizard.tagline')}</p>
            <button
              type="button"
              className="btn primary lg cta"
              onClick={() => setStep(1)}
            >
              {t('wizard.startCta')} →
            </button>
            <div className="wiz-chips">
              <span className="chip-item">
                {Icons.shield}
                {t('wizard.feat1Title')}
              </span>
              <span className="chip-dot">·</span>
              <span className="chip-item">
                {Icons.brain}
                {t('wizard.feat2Title')}
              </span>
              <span className="chip-dot">·</span>
              <span className="chip-item">
                {Icons.book}
                {t('wizard.feat3Title')}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="wiz-stepper">
              {steps.map((s, i) => (
                <Fragment key={i}>
                  <span
                    className={`s ${i < stepperIndex ? 'done' : i === stepperIndex ? 'cur' : ''}`}
                  >
                    <span className="n">{i < stepperIndex ? '✓' : i + 1}</span>
                    {s}
                  </span>
                  {i < steps.length - 1 && <span className="dash" />}
                </Fragment>
              ))}
            </div>

            <div className="wiz-body">
              {step === 1 && (
                <>
                  <h3>{t('wizard.providerHeading')}</h3>
                  <div className="hint">{t('wizard.providerDesc')}</div>
                  <div
                    className="prov-grid"
                    style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
                  >
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
                              <span
                                className="chip accent"
                                style={{ marginLeft: 'auto' }}
                              >
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
                      <span
                        className="mono small"
                        style={{ color: 'var(--accent-deep)' }}
                      >
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
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                {t('wizard.back')}
              </button>
              <span className="wiz-progress">
                {step} / {steps.length}
              </span>
              {step < steps.length ? (
                <button
                  className="btn primary lg"
                  type="button"
                  disabled={step === 1 && providerStepBlocked}
                  onClick={() => setStep((s) => Math.min(steps.length, s + 1))}
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
          </>
        )}
      </div>
    </div>
  );
}

export default WizardPage;
