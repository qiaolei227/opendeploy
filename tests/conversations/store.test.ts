import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveConversation, loadConversation, listConversations, getConversationsDir } from '../../src/main/conversations/store';
import type { Message } from '../../src/shared/llm-types';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'opendeploy-conv-'));
  process.env.OPENDEPLOY_HOME = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
});

describe('conversation store', () => {
  it('saves and loads a conversation', async () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: 'hello', createdAt: '2026-04-20T10:00:00Z' },
      { id: 'a1', role: 'assistant', content: 'hi there', createdAt: '2026-04-20T10:00:02Z' }
    ];
    const id = await saveConversation({ title: 'test chat', messages: msgs });
    const loaded = await loadConversation(id);
    expect(loaded.title).toBe('test chat');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe('hello');
  });

  it('lists saved conversations with titles and timestamps', async () => {
    await saveConversation({ title: 'first', messages: [] });
    await new Promise(r => setTimeout(r, 5));
    await saveConversation({ title: 'second', messages: [] });
    const list = await listConversations();
    expect(list).toHaveLength(2);
    expect(list.map(c => c.title).sort()).toEqual(['first', 'second']);
  });

  it('creates directory on first save', async () => {
    const id = await saveConversation({ title: 'x', messages: [] });
    expect(id).toBeTruthy();
    expect(getConversationsDir()).toContain(testDir);
  });

  it('round-trips assistant blocks (text / tool_use / text / tool_use / text)', async () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: 'go', createdAt: '2026-04-24T10:00:00Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'I will check first. Now continuing. Done.',
        toolCalls: [
          { id: 'tc1', name: 'list_extensions', arguments: {} },
          { id: 'tc2', name: 'get_object', arguments: { id: 'SAL_SaleOrder' } }
        ],
        blocks: [
          { type: 'text', text: 'I will check first.' },
          { type: 'tool_use', callId: 'tc1' },
          { type: 'text', text: 'Now continuing.' },
          { type: 'tool_use', callId: 'tc2' },
          { type: 'text', text: 'Done.' }
        ],
        createdAt: '2026-04-24T10:00:02Z'
      }
    ];
    const id = await saveConversation({ title: 'blocks rt', messages: msgs });
    const loaded = await loadConversation(id);
    const assistant = loaded.messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant!.blocks).toEqual(msgs[1].blocks);
    expect(assistant!.toolCalls).toEqual(msgs[1].toolCalls);
    expect(assistant!.content).toBe('I will check first. Now continuing. Done.');
  });

  it('assistants without blocks round-trip cleanly (legacy path)', async () => {
    const msgs: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'old message',
        toolCalls: [{ id: 'tc1', name: 't', arguments: {} }],
        createdAt: '2026-04-24T10:00:02Z'
      }
    ];
    const id = await saveConversation({ title: 'legacy', messages: msgs });
    const loaded = await loadConversation(id);
    const assistant = loaded.messages[0];
    expect(assistant.content).toBe('old message');
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.blocks).toBeUndefined();
  });
});
