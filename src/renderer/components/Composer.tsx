import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import { PROVIDER_BY_ID } from '@renderer/data/providers';

export interface ComposerProps {
  /** Optional placeholder override. Falls back to `composer.placeholder` i18n key. */
  placeholder?: string;
  /** Submit handler — not wired to any backend in MVP-0.1. */
  onSubmit?: (text: string) => void;
  /** Currently selected LLM provider id (e.g. 'deepseek'). Undefined shows "not set". */
  llmProviderId?: string;
  /**
   * Allows a parent to pre-fill the textarea (e.g. when a prompt card in the
   * EmptyState is clicked). Changes to this prop replace the current draft.
   */
  presetText?: string;
}

/**
 * Composer — chat input box at the bottom of the Workspace.
 *
 * Ported from `design/components/Workspace.jsx` `Composer` function,
 * simplified for MVP-0.1:
 *
 * - No project / skill chips are shown yet (no project selected in MVP-0.1).
 * - "Attach" button is a placeholder.
 * - Submit is not wired to a backend; `onSubmit` is optional and only called
 *   if provided. Real chat orchestration lands in Plan 2.
 */
export function Composer({ placeholder, onSubmit, llmProviderId, presetText }: ComposerProps) {
  const { t } = useTranslation();
  const [val, setVal] = useState(presetText ?? '');

  // Sync external preset (e.g. prompt card click) into the textarea.
  useEffect(() => {
    if (presetText !== undefined) setVal(presetText);
  }, [presetText]);

  const provider = llmProviderId ? PROVIDER_BY_ID[llmProviderId] : undefined;

  const submit = () => {
    const text = val.trim();
    if (!text) return;
    onSubmit?.(text);
    setVal('');
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="cbox">
          <textarea
            rows={2}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder ?? t('composer.placeholder')}
          />
          <div className="ctools">
            <button type="button" className="comp-chip" disabled>
              {Icons.attach} {t('composer.attach')}
            </button>
            <span className="spacer" />
            <button type="button" className="comp-chip">
              {provider ? (
                <>
                  <span className={`prov-dot ${provider.dot}`}>{provider.letter}</span>
                  {provider.short}
                </>
              ) : (
                <>
                  <span className="prov-dot">·</span>
                  {t('status.llmNotConfigured')}
                </>
              )}{' '}
              {Icons.down}
            </button>
            <button type="button" className="btn accent" onClick={submit}>
              {t('composer.send')} {Icons.send}
            </button>
          </div>
        </div>
        <div className="chint">
          <span>{t('composer.hintLeft')}</span>
          <span>{t('composer.hintRight')}</span>
        </div>
      </div>
    </div>
  );
}

export default Composer;
