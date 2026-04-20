import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Message } from '@shared/llm-types';
import { openDeployHome } from '../paths';

export interface ConversationSummary {
  id: string;
  title: string;
  savedAt: string;
  messageCount: number;
}

export interface Conversation {
  id: string;
  title: string;
  savedAt: string;
  messages: Message[];
}

export function getConversationsDir(): string {
  return join(openDeployHome(), 'conversations');
}

function sanitizeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60);
}

function formatMessage(m: Message): string {
  const body = [`### [${m.createdAt}] ${m.role}`, '', m.content];
  if (m.toolCallId) body.splice(2, 0, `_(tool_call_id: ${m.toolCallId})_`, '');
  if (m.toolCalls && m.toolCalls.length > 0) {
    body.push('', '```tool-calls', JSON.stringify(m.toolCalls, null, 2), '```');
  }
  return body.join('\n');
}

function parseConversation(content: string): Conversation {
  const lines = content.split('\n');
  const frontmatter: Record<string, string> = {};
  let idx = 0;
  if (lines[0] === '---') {
    idx = 1;
    while (idx < lines.length && lines[idx] !== '---') {
      const match = lines[idx].match(/^(\w+):\s*(.*)$/);
      if (match) frontmatter[match[1]] = match[2];
      idx++;
    }
    idx++; // skip closing ---
  }
  const rest = lines.slice(idx).join('\n');
  const messages: Message[] = [];
  const turns = rest.split(/(?=^### \[)/gm).filter(t => t.trim().length > 0);
  for (const turn of turns) {
    const headMatch = turn.match(/^### \[([^\]]+)\] (\w+)/);
    if (!headMatch) continue;
    const [, createdAt, role] = headMatch;
    const bodyStart = turn.indexOf('\n', turn.indexOf(headMatch[0])) + 1;
    const body = turn.slice(bodyStart).replace(/```tool-calls[\s\S]*?```\s*$/, '').trim();
    messages.push({
      id: `loaded_${messages.length}`,
      role: role as Message['role'],
      content: body,
      createdAt
    });
  }
  return {
    id: frontmatter.id ?? '',
    title: frontmatter.title ?? '',
    savedAt: frontmatter.savedAt ?? '',
    messages
  };
}

export async function saveConversation(params: {
  id?: string;
  title: string;
  messages: Message[];
}): Promise<string> {
  const dir = getConversationsDir();
  await fs.mkdir(dir, { recursive: true });
  const now = new Date();
  const id = params.id ?? `${now.toISOString().replace(/[:.]/g, '-')}_${sanitizeFilename(params.title)}`;
  const path = join(dir, `${id}.md`);
  const content = [
    '---',
    `id: ${id}`,
    `title: ${params.title}`,
    `savedAt: ${now.toISOString()}`,
    `messageCount: ${params.messages.length}`,
    '---',
    '',
    ...params.messages.map(formatMessage)
  ].join('\n');
  await fs.writeFile(path, content, 'utf-8');
  return id;
}

export async function loadConversation(id: string): Promise<Conversation> {
  const path = join(getConversationsDir(), `${id}.md`);
  const content = await fs.readFile(path, 'utf-8');
  return parseConversation(content);
}

export async function deleteConversation(id: string): Promise<void> {
  // id in the on-disk filename is the same string we write in the frontmatter.
  // Use force: true so a repeat call (or a stale ui reference) is a silent no-op.
  const path = join(getConversationsDir(), `${id}.md`);
  await fs.rm(path, { force: true });
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const dir = getConversationsDir();
  try {
    const files = await fs.readdir(dir);
    const results: ConversationSummary[] = [];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      try {
        const content = await fs.readFile(join(dir, f), 'utf-8');
        const conv = parseConversation(content);
        results.push({
          id: conv.id || f.replace(/\.md$/, ''),
          title: conv.title,
          savedAt: conv.savedAt,
          messageCount: conv.messages.length
        });
      } catch { /* skip malformed */ }
    }
    return results;
  } catch {
    return [];
  }
}
