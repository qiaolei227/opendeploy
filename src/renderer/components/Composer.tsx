import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDER_BY_ID } from '@renderer/data/providers';
import { Icons } from './icons';
import { getModKey } from '@renderer/utils/platform';

interface ComposerProps {
  llmProviderId?: string;
  presetText?: string;
}

export function Composer({ llmProviderId, presetText }: ComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(presetText ?? '');
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const settings = useSettingsStore((s) => s.settings);

  const effectiveProviderId = llmProviderId ?? settings.llmProvider ?? 'deepseek';
  const provider = PROVIDER_BY_ID[effectiveProviderId];
  const apiKey = settings.apiKeys?.[effectiveProviderId];

  const submit = async () => {
    if (!text.trim() || isStreaming) return;
    const msg = text;
    setText('');
    await sendMessage(msg, effectiveProviderId, apiKey);
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="cbox">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={t('composer.placeholder')}
            disabled={isStreaming}
          />
          <div className="ctools">
            <button type="button" className="comp-chip" disabled>
              {Icons.attach} {t('composer.attach')}
            </button>
            <span className="spacer" />
            <button type="button" className="comp-chip">
              <span className={`prov-dot ${provider?.dot ?? ''}`}>{provider?.letter ?? '?'}</span>
              {provider?.short ?? '—'}
            </button>
            <button
              type="button"
              className="btn accent"
              onClick={() => void submit()}
              disabled={isStreaming || !text.trim()}
            >
              {t('composer.send')} {Icons.send}
            </button>
          </div>
        </div>
        <div className="chint">
          <span>{t('composer.hintLeft', { mod: getModKey() })}</span>
          <span>{t('composer.hintRight')}</span>
        </div>
      </div>
    </div>
  );
}
