import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@renderer/stores/chat-store';
import { Message } from './Message';

interface MessageListProps {
  messages: ChatMessage[];
}

/**
 * Distance (px) from the bottom below which we still consider the user
 * "pinned to bottom" and follow new content automatically. Anything further
 * up — user is reading backlog, stop fighting them.
 */
const AUTO_SCROLL_THRESHOLD = 80;

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * `true` while the viewport is pinned near the bottom. Updated on every
   * user scroll; message-driven effect reads this to decide whether to
   * follow.
   */
  const pinnedToBottomRef = useRef(true);

  // Track whether the user is currently pinned to the bottom. Done via a
  // listener (not state) to avoid re-rendering on every scroll tick.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom < AUTO_SCROLL_THRESHOLD;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-follow new content only when the user hasn't scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-inner">
        {messages.map((m) => <Message key={m.id} message={m} />)}
      </div>
    </div>
  );
}
