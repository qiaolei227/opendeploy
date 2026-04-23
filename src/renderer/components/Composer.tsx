import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { Icons } from './icons';

interface ComposerProps {
  llmProviderId?: string;
  presetText?: string;
}

export function Composer({ llmProviderId, presetText }: ComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(presetText ?? '');
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortStream = useChatStore((s) => s.abort);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const settings = useSettingsStore((s) => s.settings);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasStreamingRef = useRef(false);

  const effectiveProviderId = llmProviderId ?? settings.llmProvider ?? 'deepseek';
  const apiKey = settings.apiKeys?.[effectiveProviderId];

  // Auto-focus the textarea when streaming finishes (true → false transition).
  // Without this, the cursor stays parked wherever the user last clicked,
  // forcing them to click back into the composer for every turn.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      textareaRef.current?.focus();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Auto-grow the textarea as the user types, clamped to a sensible range.
  // Reset to 'auto' first so scrollHeight measures the natural content
  // size — otherwise repeated grows can only increase, never shrink when
  // the user deletes lines. Sending (which empties `text`) re-runs this
  // and collapses back to the min height. CSS max-height caps at 180px;
  // anything longer scrolls internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const MIN_HEIGHT = 48;  // ~2 lines at our font-size, matches initial rows={2}
    const MAX_HEIGHT = 180; // mirrors CSS — JS clamp prevents a brief layout jump on overflow
    el.style.height = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT) + 'px';
  }, [text]);

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
            ref={textareaRef}
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
            <span className="spacer" />
            {isStreaming ? (
              <button
                type="button"
                className="btn danger"
                onClick={() => void abortStream()}
                title={t('composer.stopHint')}
              >
                {t('composer.stop')} {Icons.stop}
              </button>
            ) : (
              <button
                type="button"
                className="btn accent"
                onClick={() => void submit()}
                disabled={!text.trim()}
              >
                {t('composer.send')} {Icons.send}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
