import { describe, it, expect } from 'vitest';
import type { Message } from '../../src/shared/llm-types';
import { pruneOldToolResults } from '../../src/main/agent/history-prune';

function u(content: string): Message {
  return { id: `u${content}`, role: 'user', content, createdAt: '' };
}
function a(content: string, toolCalls: string[] = []): Message {
  return {
    id: `a${content}`,
    role: 'assistant',
    content,
    createdAt: '',
    toolCalls: toolCalls.map((id) => ({ id, name: 'fake', arguments: {} }))
  };
}
function t(toolCallId: string, content: string): Message {
  return {
    id: `t${toolCallId}`,
    role: 'tool',
    content,
    toolCallId,
    createdAt: ''
  };
}

describe('pruneOldToolResults', () => {
  it('is a no-op when there are fewer tool messages than the cap', () => {
    const msgs = [u('hi'), a('ack', ['c1']), t('c1', 'tool out'), a('done')];
    const out = pruneOldToolResults(msgs, 10);
    expect(out).toEqual(msgs);
  });

  it('replaces content of older tool results, keeps the last N intact', () => {
    const msgs: Message[] = [u('go')];
    for (let i = 1; i <= 20; i++) {
      msgs.push(a(`r${i}`, [`c${i}`]));
      msgs.push(t(`c${i}`, `result ${i} body, quite a lot of json here`));
    }

    const out = pruneOldToolResults(msgs, 5);

    // Tool messages positions: 2, 4, 6, ..., 40 (one per turn).
    // Last 5 tool messages = c16..c20 → keep original content.
    const toolMsgs = out.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(20);
    // First 15 are pruned
    for (let i = 0; i < 15; i++) {
      expect(toolMsgs[i].content).toContain('[tool result pruned');
      expect(toolMsgs[i].toolCallId).toBe(`c${i + 1}`);
    }
    // Last 5 are intact
    for (let i = 15; i < 20; i++) {
      expect(toolMsgs[i].content).toBe(`result ${i + 1} body, quite a lot of json here`);
      expect(toolMsgs[i].toolCallId).toBe(`c${i + 1}`);
    }
  });

  it('preserves toolCallId on pruned messages (API pairing stays valid)', () => {
    const msgs: Message[] = [
      u('go'),
      a('step1', ['call-a']),
      t('call-a', 'dump 1'),
      a('step2', ['call-b']),
      t('call-b', 'dump 2'),
      a('step3', ['call-c']),
      t('call-c', 'dump 3')
    ];

    const out = pruneOldToolResults(msgs, 1);
    const tools = out.filter((m) => m.role === 'tool');

    expect(tools[0].toolCallId).toBe('call-a');
    expect(tools[1].toolCallId).toBe('call-b');
    expect(tools[2].toolCallId).toBe('call-c');
    expect(tools[0].content).toContain('pruned');
    expect(tools[1].content).toContain('pruned');
    expect(tools[2].content).toBe('dump 3');
  });

  it('never touches user / assistant / system messages', () => {
    const msgs: Message[] = [
      { id: 's', role: 'system', content: 'sys', createdAt: '' },
      u('user msg'),
      a('assistant with tool', ['c1']),
      t('c1', 'BIG TOOL RESULT THAT SHOULD BE PRUNED'),
      a('assistant text continues unchanged'),
      u('next user'),
      a('another tool call', ['c2']),
      t('c2', 'kept — this is latest')
    ];

    const out = pruneOldToolResults(msgs, 1);

    expect(out[0].content).toBe('sys');
    expect(out[1].content).toBe('user msg');
    expect(out[2].content).toBe('assistant with tool');
    // c1 pruned
    expect(out[3].content).toContain('pruned');
    expect(out[4].content).toBe('assistant text continues unchanged');
    expect(out[5].content).toBe('next user');
    expect(out[6].content).toBe('another tool call');
    // c2 kept (last one within keepLastN=1)
    expect(out[7].content).toBe('kept — this is latest');
  });

  it('keepLastN=0 prunes every tool message', () => {
    const msgs: Message[] = [
      u('go'),
      a('s', ['c1']),
      t('c1', 'a'),
      a('s', ['c2']),
      t('c2', 'b')
    ];
    const out = pruneOldToolResults(msgs, 0);
    const tools = out.filter((m) => m.role === 'tool');
    expect(tools.every((m) => m.content.includes('pruned'))).toBe(true);
  });

  it('does not mutate the input array', () => {
    const msgs: Message[] = [
      a('s', ['c1']),
      t('c1', 'original body')
    ];
    const snapshot = JSON.parse(JSON.stringify(msgs));
    pruneOldToolResults(msgs, 0);
    expect(msgs).toEqual(snapshot);
  });
});
