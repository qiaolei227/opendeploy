import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@renderer/stores/chat-store';
import { MarkdownBlock } from './MarkdownBlock';
import { Icons } from './icons';

interface MessageProps {
  message: ChatMessage;
}

export function Message({ message }: MessageProps) {
  const { t } = useTranslation();
  const who = message.role === 'user' ? 'user' : 'ai';
  const avatar = message.role === 'user' ? '乔' : 'AI';
  const name = message.role === 'user' ? t('messages.user') : t('messages.assistant');
  const time = new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <div className="turn">
      <div className="turn-head">
        <div className={`turn-av ${who}`}>{avatar}</div>
        <span className="turn-name">{name}</span>
        <span className="turn-time">{time}</span>
      </div>
      <div className="turn-body">
        {message.content && <MarkdownBlock content={message.content} />}
        {message.isStreaming && <span className="streaming-cursor">▍</span>}
        {message.toolCalls?.map((tc, i) => (
          <div key={i} className="tool">
            <div className="tool-head">
              <span className="tool-ic">{Icons.zap}</span>
              <span className="tool-name">{tc.name}</span>
              <span className="tool-args">{tc.args}</span>
              <span className={`tool-status ${tc.result ? 'ok' : 'running'}`}>
                {tc.result ? 'ok ✓' : 'running'}
              </span>
            </div>
            {tc.result && (
              <div className="tool-body">
                <pre style={{fontSize: 11, whiteSpace: 'pre-wrap'}}>{tc.result}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
