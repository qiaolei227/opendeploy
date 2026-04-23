/**
 * Dry-run the agent loop from the command line — without Electron / UI.
 *
 * Loads the same settings.json the app uses, picks up the active project,
 * builds the real tool registry, calls the real LLM, and dumps every event
 * (system prompt, tool calls, tool args, tool results, LLM replies) to a
 * trace file for inspection.
 *
 * Usage:
 *   pnpm agent:chat "<user message>"
 *     — single-turn, trace to tmp/trace.txt (overwrites)
 *   pnpm agent:chat "<message>" --conv <name>
 *     — multi-turn: loads tmp/conv-<name>.json if it exists, appends new user
 *       message, runs loop, saves updated history back. Trace appends to
 *       tmp/trace-<name>.txt with a turn marker so you see the full session.
 *   pnpm agent:chat "<message>" --out <file>
 *     — explicit trace path override (single-turn mode only)
 *   pnpm agent:chat --conv <name> --reset
 *     — clear the named conversation (delete history file + trace file)
 *
 * This script intentionally does NOT import the four prompt md files via
 * Vite's `?raw` syntax — those would crash Node. Instead it reads them via
 * fs and passes them into the same production functions.
 */
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeDir } from '../src/main/skills/paths';
import { loadSettings } from '../src/main/settings';
import { getProject } from '../src/main/projects/store';
import { setActiveProject, getConnectionState } from '../src/main/erp/active';
import { createLlmClient } from '../src/main/llm/factory';
import { ToolRegistry } from '../src/main/agent/tools';
import { BUILTIN_TOOLS } from '../src/main/agent/builtin-tools';
import { buildSkillsContext } from '../src/main/agent/skills-integration';
import {
  activeProjectTag,
  buildK3CloudTools
} from '../src/main/agent/k3cloud-tools';
import { erpRulesFragment } from '../src/main/agent/erp-rules';
import { buildPluginTools } from '../src/main/agent/plugin-tools';
import { buildBosWriteTools } from '../src/main/agent/bos-write-tools';
import { runAgentLoop } from '../src/main/agent/loop';
import type { Message } from '../src/shared/llm-types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const promptsDir = join(repoRoot, 'src', 'main', 'agent', 'prompts');
const repoKnowledgeDir = join(repoRoot, 'knowledge');
const tmpDir = join(repoRoot, 'tmp');

/**
 * Copy the repo's `knowledge/` into the user's cache so the debug run
 * reflects the latest bundled content, without waiting for the Electron app
 * to trigger `seedOrRefreshKnowledge`. Always-on in the script — prod uses
 * the Electron path and never runs this.
 */
async function refreshLocalKnowledge(): Promise<void> {
  const target = knowledgeDir();
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  await fs.cp(repoKnowledgeDir, target, { recursive: true });
}

async function readPrompt(relPath: string): Promise<string> {
  return fs.readFile(join(promptsDir, relPath), 'utf-8');
}

interface Args {
  message: string | null;
  conv: string | null;
  out: string | null;
  reset: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let message: string | null = null;
  let conv: string | null = null;
  let out: string | null = null;
  let reset = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--conv') {
      conv = args[++i] ?? null;
    } else if (a === '--out') {
      out = args[++i] ?? null;
    } else if (a === '--reset') {
      reset = true;
    } else if (!a.startsWith('--') && message === null) {
      message = a;
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }

  if (!message && !reset) {
    console.error(
      'Usage:\n' +
        '  agent-chat "<user message>"                 single-turn\n' +
        '  agent-chat "<message>" --conv <name>        multi-turn (resumes conv-<name>.json)\n' +
        '  agent-chat --conv <name> --reset            clear that conversation'
    );
    process.exit(1);
  }

  return { message, conv, out, reset };
}

function convPaths(conv: string): { history: string; trace: string } {
  return {
    history: join(tmpDir, `conv-${conv}.json`),
    trace: join(tmpDir, `trace-${conv}.txt`)
  };
}

async function loadHistory(path: string): Promise<Message[]> {
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}

function sectionHeader(title: string): string {
  const line = '━'.repeat(72);
  return `\n${line}\n  ${title}\n${line}\n`;
}

function turnHeader(turnIdx: number, message: string): string {
  const line = '█'.repeat(72);
  return `\n\n${line}\n  TURN ${turnIdx} · ${new Date().toISOString()}\n  > ${message.split('\n').join('\n  > ')}\n${line}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // ─── Reset branch ────────────────────────────────────────────────────
  if (args.reset) {
    if (!args.conv) {
      console.error('--reset requires --conv <name>');
      process.exit(1);
    }
    const p = convPaths(args.conv);
    await fs.rm(p.history, { force: true });
    await fs.rm(p.trace, { force: true });
    process.stdout.write(`Cleared conversation "${args.conv}".\n`);
    return;
  }

  const message = args.message!;
  const convMode = args.conv !== null;
  const paths = args.conv ? convPaths(args.conv) : null;
  const traceOut = args.out ?? paths?.trace ?? join(tmpDir, 'trace.txt');

  const lines: string[] = [];
  const emit = (s: string): void => {
    lines.push(s);
    process.stdout.write(s + (s.endsWith('\n') ? '' : '\n'));
  };

  // ─── Sync repo knowledge into local cache ─────────────────────────────
  await refreshLocalKnowledge();

  // ─── Settings + provider ──────────────────────────────────────────────
  const settings = await loadSettings();
  if (!settings.llmProvider) {
    emit('ERROR: no llmProvider set in settings.json — configure via the app first.');
    process.exit(1);
  }
  const providerId = settings.llmProvider;
  const apiKey = settings.apiKeys?.[providerId];

  // ─── Load prior history (conv mode) ──────────────────────────────────
  const priorHistory: Message[] = paths ? await loadHistory(paths.history) : [];
  const turnIdx = priorHistory.filter((m) => m.role === 'user').length + 1;

  if (convMode) {
    emit(turnHeader(turnIdx, message));
    if (priorHistory.length > 0) {
      emit(`(resuming conv "${args.conv}" — ${priorHistory.length} prior messages)`);
    } else {
      emit(`(new conv "${args.conv}" — no prior history)`);
    }
  }

  emit(sectionHeader('1. LLM provider'));
  emit(`providerId:  ${providerId}`);
  emit(`apiKey:      ${apiKey ? `${apiKey.slice(0, 8)}…(len=${apiKey.length})` : '(none — ok for ollama)'}`);

  // ─── Activate the configured project ──────────────────────────────────
  emit(sectionHeader('2. Active project'));
  if (settings.activeProjectId) {
    const project = await getProject(settings.activeProjectId);
    if (project) {
      emit(`name:        ${project.name}`);
      emit(`erpProvider: ${project.erpProvider}`);
      emit(`database:    ${project.connection.database}`);
      emit(`server:      ${project.connection.server}:${project.connection.port ?? 1433}`);
      try {
        await setActiveProject(project);
      } catch (err) {
        emit(`WARN: connect failed — ${(err as Error).message}`);
      }
      const st = getConnectionState();
      emit(`status:      ${st.status}${st.error ? ` (${st.error})` : ''}`);
    } else {
      emit(`WARN: activeProjectId "${settings.activeProjectId}" not found in projects store`);
    }
  } else {
    emit('(no active project — kingdee_* tools will be absent, erp-rules won\'t inject)');
  }

  // ─── Load prompt md files ─────────────────────────────────────────────
  const baseSystem = (await readPrompt('base-system.md')).trim();
  const k3cloudRules = (await readPrompt('erp-rules/k3cloud.md')).trim();
  const activeTagTpl = (await readPrompt('active-project-tag.md')).trim();
  const catalogIntro = (await readPrompt('skills-catalog-intro.md')).trim();

  // ─── Build skills context + tools ─────────────────────────────────────
  const activeErpProvider = getConnectionState().erpProvider;
  const { systemPromptFragment, loadSkillTool, loadSkillFileTool } =
    await buildSkillsContext({ activeErpProvider, catalogIntro });

  const registry = new ToolRegistry();
  for (const t of BUILTIN_TOOLS) registry.register(t);
  registry.register(loadSkillTool);
  registry.register(loadSkillFileTool);
  for (const t of buildK3CloudTools()) registry.register(t);
  for (const t of buildPluginTools()) registry.register(t);
  for (const t of buildBosWriteTools()) registry.register(t);

  const toolNames = registry.definitions().map((d) => d.name);
  emit(sectionHeader('3. Tool registry'));
  emit(`count: ${toolNames.length}`);
  for (const n of toolNames) emit(`  - ${n}`);

  // ─── Assemble system prompt ───────────────────────────────────────────
  const projectTag = activeProjectTag(activeTagTpl);
  const erpRules = erpRulesFragment(activeErpProvider, { k3cloud: k3cloudRules });
  const systemPrompt = [baseSystem, erpRules, projectTag, systemPromptFragment]
    .filter((s) => s && s.trim() !== '')
    .join('\n\n');

  // In conv mode, only print the system prompt on the first turn to avoid
  // duplicating this large block in every turn of the trace.
  if (!convMode || priorHistory.length === 0) {
    emit(sectionHeader('4. System prompt (full, as sent to LLM)'));
    emit(systemPrompt);
  } else {
    emit(sectionHeader('4. System prompt'));
    emit('(unchanged from turn 1 — carried over in message history)');
  }

  // ─── User message ─────────────────────────────────────────────────────
  emit(sectionHeader('5. User message'));
  emit(message);

  // ─── Build message list ───────────────────────────────────────────────
  const newUserMsg: Message = {
    id: `u_${Date.now()}`,
    role: 'user',
    content: message,
    createdAt: new Date().toISOString()
  };
  const initialMessages: Message[] = [...priorHistory, newUserMsg];

  // ─── Run agent loop ───────────────────────────────────────────────────
  const client = createLlmClient(providerId);

  emit(sectionHeader('6. Agent loop events'));
  let deltaBuf = '';
  const flushDelta = (): void => {
    if (deltaBuf) {
      emit(`  [delta]\n${deltaBuf.split('\n').map((l) => `    ${l}`).join('\n')}`);
      deltaBuf = '';
    }
  };

  let finalMessages: Message[] = initialMessages;
  try {
    finalMessages = await runAgentLoop({
      client,
      tools: registry,
      initialMessages,
      providerId,
      apiKey,
      systemPrompt,
      onEvent: (e) => {
        if (e.type === 'iteration_start') {
          flushDelta();
          emit(`\n── iteration ${e.iteration} ──`);
        } else if (e.type === 'delta') {
          deltaBuf += e.content;
        } else if (e.type === 'tool_call') {
          flushDelta();
          emit(`  [tool_call] ${e.toolCall.name}`);
          emit(`    args: ${JSON.stringify(e.toolCall.arguments, null, 2).split('\n').join('\n    ')}`);
        } else if (e.type === 'tool_result') {
          const preview =
            e.content.length > 4000 ? `${e.content.slice(0, 4000)}\n    … (truncated, ${e.content.length} chars total)` : e.content;
          emit(`  [tool_result]${e.isError ? ' ERROR' : ''}`);
          emit(`    ${preview.split('\n').join('\n    ')}`);
        } else if (e.type === 'error') {
          flushDelta();
          emit(`  [error] ${e.error}`);
        } else if (e.type === 'done') {
          flushDelta();
          emit(`\n── done ──`);
        }
      }
    });
  } catch (err) {
    flushDelta();
    emit(`\nAGENT LOOP ERROR: ${(err as Error).message}`);
    if ((err as Error).stack) emit((err as Error).stack!);
  }

  // ─── Final messages ──────────────────────────────────────────────────
  emit(sectionHeader('7. New assistant messages this turn'));
  const newMessages = finalMessages.slice(initialMessages.length);
  for (const m of newMessages) {
    if (m.role !== 'assistant') continue;
    const tc = m.toolCalls?.length ? ` [toolCalls=${m.toolCalls.length}]` : '';
    emit(`[assistant${tc}] content=${JSON.stringify(m.content)}`);
  }

  // ─── Tear down DB pool ────────────────────────────────────────────────
  await setActiveProject(null).catch(() => undefined);

  // ─── Persist history (conv mode) ─────────────────────────────────────
  if (paths) {
    await fs.mkdir(dirname(paths.history), { recursive: true });
    await fs.writeFile(paths.history, JSON.stringify(finalMessages, null, 2), 'utf-8');
    process.stdout.write(`\nConversation saved: ${paths.history}\n`);
  }

  // ─── Write trace (append in conv mode, overwrite otherwise) ──────────
  await fs.mkdir(dirname(traceOut), { recursive: true });
  const traceBody = lines.join('\n');
  if (convMode) {
    await fs.appendFile(traceOut, traceBody + '\n', 'utf-8');
  } else {
    await fs.writeFile(traceOut, traceBody, 'utf-8');
  }
  process.stdout.write(`Trace ${convMode ? 'appended to' : 'written to'} ${traceOut}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
