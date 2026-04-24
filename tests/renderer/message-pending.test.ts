import { describe, expect, it } from 'vitest';
import { derivePendingActivity } from '../../src/renderer/components/Message';
import type { ChatMessage } from '../../src/renderer/stores/chat-store';

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-25T00:00:00Z',
    isStreaming: true,
    ...overrides
  };
}

describe('derivePendingActivity', () => {
  it('returns null when message is not streaming', () => {
    expect(derivePendingActivity(msg({ isStreaming: false }))).toBeNull();
  });

  it('returns thinking when streaming with no blocks yet', () => {
    expect(derivePendingActivity(msg({ blocks: [] }))).toEqual({ kind: 'thinking' });
  });

  it('returns awaiting-tool with name when last block is a running tool', () => {
    const result = derivePendingActivity(msg({
      blocks: [{ type: 'tool_use', callId: 'c1' }],
      toolCalls: [{ id: 'c1', name: 'kingdee_list_extensions', args: '{}' }]
    }));
    expect(result).toEqual({ kind: 'awaiting-tool', toolName: 'kingdee_list_extensions' });
  });

  it('returns thinking when last block is a finished tool (has result)', () => {
    expect(derivePendingActivity(msg({
      blocks: [{ type: 'tool_use', callId: 'c1' }],
      toolCalls: [{ id: 'c1', name: 'kingdee_list_extensions', args: '{}', result: '{"count":0}' }]
    }))).toEqual({ kind: 'thinking' });
  });

  it('returns null when last block is text mid-stream (cursor handles it)', () => {
    expect(derivePendingActivity(msg({
      blocks: [{ type: 'text', text: '我先看一下扩展' }]
    }))).toBeNull();
  });
});
