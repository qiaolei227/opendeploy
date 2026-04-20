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
});
