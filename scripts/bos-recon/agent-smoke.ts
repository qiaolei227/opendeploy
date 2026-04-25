/**
 * Agent-loop smoke test —— 绕过 Electron UI, 直接用脚本跑完整 agent loop
 * (和 ipc-llm.ts 里 `llm:send` handler 等价), 把每一步 LLM 的 delta / tool_call
 * / tool_result 打印出来, 用来诊断 LLM 决策 (为何卡住 / 工具选对不对) 这种
 * UI 里看不到细节的问题。
 *
 * 跑法:
 *   tsx --tsconfig tsconfig.node.json scripts/bos-recon/agent-smoke.ts "你的 prompt"
 *
 * 用完即删 / 或者作为未来 LLM 行为回归测的种子。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from '../../src/main/settings';
import { getProject } from '../../src/main/projects/store';
import { setActiveProject, getConnectionState } from '../../src/main/erp/active';
import { runAgentLoop, type AgentLoopEvent } from '../../src/main/agent/loop';
import { ToolRegistry } from '../../src/main/agent/tools';
import { BUILTIN_TOOLS } from '../../src/main/agent/builtin-tools';
import { buildSkillsContext } from '../../src/main/agent/skills-integration';
import { activeProjectTag, buildK3CloudTools } from '../../src/main/agent/k3cloud-tools';
import { erpRulesFragment } from '../../src/main/agent/erp-rules';
import { buildPluginTools } from '../../src/main/agent/plugin-tools';
import { buildPlanTools } from '../../src/main/agent/plan-tools';
import { buildBosWriteTools } from '../../src/main/agent/bos-write-tools';
import { createLlmClient } from '../../src/main/llm/factory';
import type { Message } from '@shared/llm-types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(HERE, '..', '..', 'src', 'main', 'agent', 'prompts');

const basePrompt = fs.readFileSync(path.join(PROMPTS_DIR, 'base-system.md'), 'utf-8').trim();
const k3cloudRules = fs.readFileSync(path.join(PROMPTS_DIR, 'erp-rules', 'k3cloud.md'), 'utf-8');
const activeTag = fs.readFileSync(path.join(PROMPTS_DIR, 'active-project-tag.md'), 'utf-8');
const catalogIntro = fs.readFileSync(path.join(PROMPTS_DIR, 'skills-catalog-intro.md'), 'utf-8');

const PROJECT_ID = 'p_mobmehj2_34p2xri7';
const DEFAULT_PROMPT = '给销售订单加一个叫 F_DEMO 的文本字段，显示名 演示字段 ，在已存在的那个扩展上加。';
const userPrompt = process.argv[2] ?? DEFAULT_PROMPT;

function truncate(s: string, n = 500): string {
  return s.length <= n ? s : s.slice(0, n) + ` …[+${s.length - n}b]`;
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  const providerId = settings.llmProvider;
  if (!providerId) throw new Error('no llmProvider in settings.json');
  const apiKey = settings.apiKeys?.[providerId];
  if (!apiKey && providerId !== 'ollama') {
    throw new Error(`no apiKey for provider ${providerId} in settings.json`);
  }

  const project = await getProject(PROJECT_ID);
  if (!project) throw new Error(`project ${PROJECT_ID} not found`);

  console.log('[smoke] activating project', PROJECT_ID);
  await setActiveProject(project);
  const state = getConnectionState();
  if (state.status !== 'connected') {
    throw new Error('project connect failed: ' + (state.error ?? state.status));
  }
  console.log('[smoke] connected. erp=' + state.erpProvider);

  const registry = new ToolRegistry();
  for (const t of BUILTIN_TOOLS) registry.register(t);
  const { systemPromptFragment, loadSkillTool, loadSkillFileTool } = await buildSkillsContext({
    activeErpProvider: state.erpProvider,
    catalogIntro
  });
  registry.register(loadSkillTool);
  registry.register(loadSkillFileTool);
  for (const t of buildK3CloudTools()) registry.register(t);
  for (const t of buildPluginTools()) registry.register(t);
  for (const t of buildPlanTools()) registry.register(t);
  for (const t of buildBosWriteTools()) registry.register(t);

  const systemPrompt = [
    basePrompt,
    erpRulesFragment(state.erpProvider, { k3cloud: k3cloudRules }),
    activeProjectTag(activeTag),
    systemPromptFragment
  ]
    .filter((s) => s && s.trim() !== '')
    .join('\n\n');

  console.log('[smoke] tools:', registry.definitions().map((d) => d.name).join(', '));
  console.log('[smoke] provider:', providerId, '  model=(default)');
  console.log('[smoke] systemPrompt length:', systemPrompt.length, 'chars');
  console.log('[smoke] user prompt:', userPrompt);
  console.log('\n══════════ AGENT LOOP ══════════');

  const client = createLlmClient(providerId);

  const finalMessages = await runAgentLoop({
    client,
    tools: registry,
    initialMessages: [
      {
        id: 'u1',
        role: 'user',
        content: userPrompt,
        createdAt: new Date().toISOString()
      } as Message
    ],
    providerId,
    apiKey,
    systemPrompt,
    maxIterations: 6,
    onEvent: (e: AgentLoopEvent) => {
      if (e.type === 'iteration_start') {
        console.log(`\n── iter ${e.iteration} ──`);
      } else if (e.type === 'delta') {
        process.stdout.write(e.content);
      } else if (e.type === 'tool_call') {
        console.log(
          `\n  🔧 TOOL_CALL ${e.toolCall.name}(${JSON.stringify(e.toolCall.arguments)})`
        );
      } else if (e.type === 'tool_result') {
        console.log(
          `  ✅ TOOL_RESULT err=${e.isError} ${truncate(e.content, 600)}`
        );
      } else if (e.type === 'done') {
        console.log('\n[done]');
      } else if (e.type === 'error') {
        console.log('\n[ERROR]', e.error);
      }
    }
  });

  console.log('\n\n══════════ FINAL MESSAGES ══════════');
  for (const m of finalMessages) {
    const preview = m.content ? truncate(m.content, 300) : '(empty)';
    console.log(`\n[${m.role}] ${preview}`);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        console.log(`  → ${tc.name}(${truncate(JSON.stringify(tc.arguments), 200)})`);
      }
    }
  }

  await setActiveProject(null);
}

main().catch((err) => {
  console.error('\n[smoke] FAIL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
