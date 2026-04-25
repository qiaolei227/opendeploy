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

  it('returns thinking when streaming with no blocks and no pendingText', () => {
    expect(derivePendingActivity(msg({ blocks: [] }))).toEqual({ kind: 'thinking' });
  });

  it('returns generating with estimate token count when pendingText is set + tokensExact false', () => {
    expect(derivePendingActivity(msg({
      pendingText: 'partial',
      pendingTokens: 4,
      tokensExact: false
    }))).toEqual({ kind: 'generating', tokens: 4, exact: false });
  });

  it('returns generating with exact token count when tokensExact is true', () => {
    expect(derivePendingActivity(msg({
      pendingText: 'partial',
      pendingTokens: 23,
      tokensExact: true
    }))).toEqual({ kind: 'generating', tokens: 23, exact: true });
  });

  it('returns awaiting-tool with toolName + startedAt when last block is a running tool', () => {
    const result = derivePendingActivity(msg({
      blocks: [{ type: 'tool_use', callId: 'c1' }],
      toolCalls: [{ id: 'c1', name: 'kingdee_list_extensions', args: '{}', startedAt: 1700000000000 }]
    }));
    expect(result).toEqual({
      kind: 'awaiting-tool',
      toolName: 'kingdee_list_extensions',
      startedAt: 1700000000000
    });
  });

  it('falls back startedAt to Date.now() when running tool has no startedAt (legacy)', () => {
    const before = Date.now();
    const result = derivePendingActivity(msg({
      blocks: [{ type: 'tool_use', callId: 'c1' }],
      toolCalls: [{ id: 'c1', name: 'old_tool', args: '{}' }]
    })) as { kind: 'awaiting-tool'; toolName: string; startedAt: number };
    const after = Date.now();
    expect(result.kind).toBe('awaiting-tool');
    expect(result.startedAt).toBeGreaterThanOrEqual(before);
    expect(result.startedAt).toBeLessThanOrEqual(after);
  });

  it('returns thinking when last block is a finished tool (has result)', () => {
    expect(derivePendingActivity(msg({
      blocks: [{ type: 'tool_use', callId: 'c1' }],
      toolCalls: [{ id: 'c1', name: 'kingdee_list_extensions', args: '{}', result: '{"count":0}' }]
    }))).toEqual({ kind: 'thinking' });
  });

  it('returns null when last block is text (no pendingText, cursor handles it — legacy path)', () => {
    expect(derivePendingActivity(msg({
      blocks: [{ type: 'text', text: '完成了' }]
    }))).toBeNull();
  });
});
