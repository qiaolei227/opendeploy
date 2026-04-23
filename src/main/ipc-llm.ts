import { ipcMain, type BrowserWindow } from 'electron';
import type { LlmChatRequest } from '@shared/types';
import { createLlmClient } from './llm/factory';
import { runAgentLoop } from './agent/loop';
import { ToolRegistry } from './agent/tools';
import { BUILTIN_TOOLS } from './agent/builtin-tools';
import { buildSkillsContext } from './agent/skills-integration';
import { activeProjectTag, buildK3CloudTools } from './agent/k3cloud-tools';
import { erpRulesFragment } from './agent/erp-rules';
import { getConnectionState } from './erp/active';
import { buildPluginTools } from './agent/plugin-tools';
import { buildBosWriteTools } from './agent/bos-write-tools';
import {
  deleteConversation,
  listConversations,
  loadConversation,
  saveConversation
} from './conversations/store';
import type { Message } from '@shared/llm-types';
import baseSystemPromptRaw from './agent/prompts/base-system.md?raw';
import k3cloudRulesRaw from './agent/prompts/erp-rules/k3cloud.md?raw';
import activeProjectTagRaw from './agent/prompts/active-project-tag.md?raw';
import catalogIntroRaw from './agent/prompts/skills-catalog-intro.md?raw';

/**
 * Base system prompt lives in `src/main/agent/prompts/base-system.md` so
 * non-engineers (product / consulting leads) can audit and PR the rules
 * without touching TypeScript. Vite's `?raw` inlines the markdown as a
 * string at build time — no runtime fs access, same behavior in dev and
 * production builds. Runtime assembly is unchanged: this base + an
 * active-project tag + the skills catalog fragment.
 */
const BASE_SYSTEM_PROMPT = baseSystemPromptRaw.trim();

// In-memory conversation state keyed by conversationId
const activeConversations = new Map<string, Message[]>();

// Active AbortControllers keyed by requestId — set on llm:send, removed on
// done/error. llm:abort looks up by requestId and aborts the agent loop +
// in-flight LLM stream.
const activeAborts = new Map<string, AbortController>();

export function registerLlmIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('llm:send', async (_event, req: LlmChatRequest) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const abortController = new AbortController();
    activeAborts.set(requestId, abortController);

    // Build message history. Three sources, in order of preference:
    //   1. In-memory `activeConversations` — set after every send, fastest path
    //   2. Disk (conversation md file) — used after an app restart or after
    //      the user switches to a historical conversation in the sidebar;
    //      without this step the main process would treat the next turn as
    //      if it were a brand-new conversation, losing all prior context
    //   3. Empty — genuinely new conversation
    let history: Message[] = [];
    if (req.conversationId) {
      const inMemory = activeConversations.get(req.conversationId);
      if (inMemory) {
        history = [...inMemory];
      } else {
        try {
          const saved = await loadConversation(req.conversationId);
          history = [...saved.messages];
          // Warm the in-memory cache so we don't hit disk again next turn.
          activeConversations.set(req.conversationId, history);
        } catch {
          // Conversation id given but no file on disk — treat as fresh start.
          // (Could happen if the renderer races a delete with a send.)
        }
      }
    }
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
        // Fresh registry + skill catalog + k3cloud tools per request so
        // project switches / skill installs between turns are picked up
        // without an app restart.
        const registry = new ToolRegistry();
        for (const t of BUILTIN_TOOLS) registry.register(t);
        // Pass the active project's ERP so only common/* and matching
        // <erp>/* skills appear in the catalog. system/* is hidden
        // regardless and stays loadable by name for internal references.
        const activeErpProvider = getConnectionState().erpProvider;
        const { systemPromptFragment, loadSkillTool, loadSkillFileTool } =
          await buildSkillsContext({
            activeErpProvider,
            catalogIntro: catalogIntroRaw
          });
        registry.register(loadSkillTool);
        registry.register(loadSkillFileTool);
        for (const t of buildK3CloudTools()) registry.register(t);
        for (const t of buildPluginTools()) registry.register(t);
        for (const t of buildBosWriteTools()) registry.register(t);

        const projectTag = activeProjectTag(activeProjectTagRaw);
        const erpRules = erpRulesFragment(activeErpProvider, { k3cloud: k3cloudRulesRaw });
        const systemPrompt = [
          BASE_SYSTEM_PROMPT,
          erpRules,
          projectTag,
          systemPromptFragment
        ]
          .filter((s) => s && s.trim() !== '')
          .join('\n\n');

        const client = createLlmClient(req.providerId);
        const finalMessages = await runAgentLoop({
          client,
          tools: registry,
          initialMessages: history,
          providerId: req.providerId,
          apiKey: req.apiKey,
          systemPrompt,
          signal: abortController.signal,
          onEvent: (e) => {
            if (e.type === 'delta') emit({ type: 'delta', content: e.content });
            else if (e.type === 'tool_call') emit({
              type: 'tool_call',
              toolCallId: e.toolCall.id,
              toolCallName: e.toolCall.name,
              toolCallArgs: JSON.stringify(e.toolCall.arguments)
            });
            else if (e.type === 'tool_result') emit({
              type: 'tool_result',
              toolCallId: e.toolCallId,
              content: e.content
            });
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
        // If the user pressed stop, surface a friendly status not a raw
        // "AbortError" — UI can render this as "已停止" rather than an error
        // banner.
        if (abortController.signal.aborted) {
          emit({ type: 'done' });
        } else {
          emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        activeAborts.delete(requestId);
      }
    })();

    return { requestId };
  });

  ipcMain.handle('llm:abort', async (_event, requestId: string) => {
    const ctrl = activeAborts.get(requestId);
    if (ctrl) ctrl.abort();
  });

  ipcMain.handle('conversations:list', async () => {
    return await listConversations();
  });

  ipcMain.handle('conversations:load', async (_event, id: string) => {
    return await loadConversation(id);
  });

  ipcMain.handle('conversations:delete', async (_event, id: string) => {
    await deleteConversation(id);
    activeConversations.delete(id);
  });
}
