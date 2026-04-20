import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@renderer/stores/chat-store';
import { Message } from './Message';

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
