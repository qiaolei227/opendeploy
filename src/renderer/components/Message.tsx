import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@renderer/stores/chat-store';
import { MarkdownBlock } from './MarkdownBlock';
import { Icons } from './icons';

interface MessageProps {
  message: ChatMessage;
}

type ToolCall = NonNullable<ChatMessage['toolCalls']>[number];

/**
 * Tool-call card with a collapsible result body. Default is collapsed —
 * kingdee_search_metadata can return 50+ rows of JSON that swamp the turn
 * when always visible. The head row remains clickable once the call
 * finishes; while it's still `running` the head isn't interactive because
 * there's no body yet.
 */
function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const hasResult = Boolean(call.result);

  return (
    <div className={`tool${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="tool-head"
        onClick={() => hasResult && setOpen((v) => !v)}
        disabled={!hasResult}
        aria-expanded={open}
        aria-label={open ? t('messages.hideToolResult') : t('messages.showToolResult')}
      >
        <span className="tool-ic">{Icons.zap}</span>
        <span className="tool-name">{call.name}</span>
        <span className="tool-args">{call.args}</span>
        <span className={`tool-status ${hasResult ? 'ok' : 'running'}`}>
          {hasResult ? t('messages.toolStatusOk') : t('messages.toolStatusRunning')}
        </span>
        {hasResult && <span className="tool-chevron">{open ? '▾' : '▸'}</span>}
      </button>
      {hasResult && open && (
        <div className="tool-body">
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{call.result}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * Was anything at all rendered yet? Used to decide whether the "思考中…"
 * placeholder should show during the pre-first-delta gap.
 */
function hasAnyContent(message: ChatMessage): boolean {
  if (message.blocks && message.blocks.length > 0) return true;
  if (message.content) return true;
  if (message.toolCalls && message.toolCalls.length > 0) return true;
  return false;
}

/**
 * Render the assistant turn body. If `blocks` is present, render in arrival
 * order (text deltas and tool_use cards interleaved — matches the Claude
 * Code experience where you see "I will X" → [tool] → "now Y" → [tool]).
 * Historic messages that predate blocks fall back to text-first then all
 * tool calls after.
 *
 * The streaming cursor ▍ is anchored to the *last text block* so it moves
 * forward even when a tool call sits between text segments.
 */
function renderBody(message: ChatMessage) {
  const streaming = Boolean(message.isStreaming);
  const callsById = new Map<string, NonNullable<ChatMessage['toolCalls']>[number]>();
  for (const tc of message.toolCalls ?? []) callsById.set(tc.id, tc);

  if (message.blocks && message.blocks.length > 0) {
    const lastTextIdx = findLastTextIndex(message.blocks);
    return message.blocks.map((block, i) => {
      if (block.type === 'text') {
        return (
          <Fragment key={i}>
            <MarkdownBlock content={block.text} />
            {streaming && i === lastTextIdx && <span className="streaming-cursor">▍</span>}
          </Fragment>
        );
      }
      const call = callsById.get(block.callId);
      if (!call) return null;
      return <ToolCallCard key={i} call={call} />;
    });
  }

  // Legacy path: no blocks → render text first, then all tool calls.
  return (
    <>
      {message.content && <MarkdownBlock content={message.content} />}
      {streaming && message.content && <span className="streaming-cursor">▍</span>}
      {message.toolCalls?.map((tc, i) => <ToolCallCard key={i} call={tc} />)}
    </>
  );
}

function findLastTextIndex(blocks: NonNullable<ChatMessage['blocks']>): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text') return i;
  }
  return -1;
}

export function Message({ message }: MessageProps) {
  const { t } = useTranslation();
  const who = message.role === 'user' ? 'user' : 'ai';
  const name = message.role === 'user' ? t('messages.user') : t('messages.assistant');
  // Derive the avatar glyph from the localized name so it stays neutral
  // (no hardcoded surname). zh "顾问" → "顾", en "You" → "Y".
  const avatar = message.role === 'user' ? name.charAt(0).toUpperCase() : 'AI';
  const time = new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <div className="turn">
      <div className="turn-head">
        <div className={`turn-av ${who}`}>{avatar}</div>
        <span className="turn-name">{name}</span>
        <span className="turn-time">{time}</span>
      </div>
      <div className="turn-body">
        {renderBody(message)}
        {message.isStreaming && !hasAnyContent(message) && (
          // The 500ms-2s gap between "user hits send" and "first delta
          // arrives" used to show nothing except a small ▍ — users read it
          // as "frozen". An explicit "思考中…" label removes the ambiguity.
          <div className="turn-thinking">{t('messages.thinking')}</div>
        )}
      </div>
    </div>
  );
}
