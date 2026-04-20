import { ipcMain, type BrowserWindow } from 'electron';
import type { LlmChatRequest } from '@shared/types';
import { createLlmClient } from './llm/factory';
import { runAgentLoop } from './agent/loop';
import { ToolRegistry } from './agent/tools';
import { BUILTIN_TOOLS } from './agent/builtin-tools';
import { saveConversation, loadConversation, listConversations } from './conversations/store';
import type { Message } from '@shared/llm-types';

// In-memory conversation state keyed by conversationId
const activeConversations = new Map<string, Message[]>();

export function registerLlmIpc(getMainWindow: () => BrowserWindow | null): void {
  const registry = new ToolRegistry();
  for (const t of BUILTIN_TOOLS) registry.register(t);

  ipcMain.handle('llm:send', async (_event, req: LlmChatRequest) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Build message history
    const history: Message[] = req.conversationId && activeConversations.has(req.conversationId)
      ? [...activeConversations.get(req.conversationId)!]
      : [];
    const userMsg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: req.userMessage,
      createdAt: new Date().toISOString()
    };
    history.push(userMsg);

    const win = getMainWindow();
    const emit = (ev: { type: string; [k: string]: unknown }) => {
      if (win) win.webContents.send('llm:stream', { requestId, ...ev });
    };

    // Run asynchronously — don't block IPC
    void (async () => {
      try {
        const client = createLlmClient(req.providerId);
        const finalMessages = await runAgentLoop({
          client,
          tools: registry,
          initialMessages: history,
          providerId: req.providerId,
          apiKey: req.apiKey,
          onEvent: (e) => {
            if (e.type === 'delta') emit({ type: 'delta', content: e.content });
            else if (e.type === 'tool_call') emit({ type: 'tool_call', toolCallName: e.toolCall.name, toolCallArgs: JSON.stringify(e.toolCall.arguments) });
            else if (e.type === 'tool_result') emit({ type: 'tool_result', content: e.content });
          }
        });

        // Store updated history
        const convId = req.conversationId ?? requestId;
        activeConversations.set(convId, finalMessages);

        // Save to disk
        const titleGuess = req.userMessage.slice(0, 40);
        await saveConversation({ id: convId, title: titleGuess, messages: finalMessages });

        emit({ type: 'done' });
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return { requestId };
  });

  ipcMain.handle('conversations:list', async () => {
    return await listConversations();
  });

  ipcMain.handle('conversations:load', async (_event, id: string) => {
    return await loadConversation(id);
  });
}
