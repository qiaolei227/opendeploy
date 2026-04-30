/**
 * Real agent loop end-to-end test.
 *
 * Boots the same registry + prompts the production IPC layer uses, drives
 * runAgentLoop with a deepseek client and a single user message, streams
 * deltas + tool calls to stdout. No fake narration — every "AGENT:" line
 * is real LLM output, every tool call is the LLM choosing to invoke it.
 *
 * Cleanup: prints the extId values created so user can manually clean
 * (or follow up with another agent turn).
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/drive-real-agent-loop.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { runAgentLoop } from '../../src/main/agent/loop';
import { ToolRegistry } from '../../src/main/agent/tools';
import { BUILTIN_TOOLS } from '../../src/main/agent/builtin-tools';
import { activeProjectTag, buildK3CloudTools } from '../../src/main/agent/k3cloud-tools';
import { buildBosRpcTools } from '../../src/main/agent/bos-rpc-tools';
import { buildSkillsContext } from '../../src/main/agent/skills-integration';
import { erpRulesFragment } from '../../src/main/agent/erp-rules';
import { setActiveProject, setBundledConvertRuleBaselines, getConnectionState } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import { createLlmClient } from '../../src/main/llm/factory';
import type { Message } from '@shared/llm-types';
import type { Project } from '@shared/erp-types';

// ── Read settings + prompts (no Vite ?raw available outside electron-vite) ──

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project with bos creds'); process.exit(1); }
const apiKey: string = settings.apiKeys?.deepseek;
if (!apiKey) { console.error('no deepseek apiKey in settings'); process.exit(1); }

const prompts = (rel: string) => readFileSync(resolve('src/main/agent/prompts', rel), 'utf-8');
const baseSystemPromptRaw = prompts('base-system.md');
const k3cloudRulesRaw = prompts('erp-rules/k3cloud.md');
const activeProjectTagRaw = prompts('active-project-tag.md');
const catalogIntroRaw = prompts('skills-catalog-intro.md');
const BASE_SYSTEM_PROMPT = baseSystemPromptRaw.trim();

// ── Bootstrap baselines + activate project ─────────────────────────────

const originXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'), 'utf-8',
);
const extensionTemplateXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'), 'utf-8',
);
setBundledConvertRuleBaselines({
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({ originXml, extensionTemplateXml }),
});

console.log('═══════════════════════════════════════════════════════════');
console.log('  Real agent loop — DeepSeek-driven end-to-end test');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('Activating project:', project.name, '(id=' + project.id + ')');
await setActiveProject(project);
const connState = getConnectionState();
if (connState.status !== 'connected') {
  console.error('project failed to connect:', connState.status, connState.error);
  process.exit(1);
}
console.log('✓ connected to', project.bos.baseUrl, '\n');

// ── Build registry like ipc-llm.ts does ────────────────────────────────

const registry = new ToolRegistry();
for (const t of BUILTIN_TOOLS) registry.register(t);
const { systemPromptFragment, loadSkillTool, loadSkillFileTool } = await buildSkillsContext({
  activeErpProvider: connState.erpProvider, catalogIntro: catalogIntroRaw,
});
registry.register(loadSkillTool);
registry.register(loadSkillFileTool);
for (const t of buildK3CloudTools()) registry.register(t);
for (const t of await buildBosRpcTools()) registry.register(t);

const projectTag = activeProjectTag(activeProjectTagRaw);
const erpRules = erpRulesFragment(connState.erpProvider, { k3cloud: k3cloudRulesRaw });
const systemPrompt = [BASE_SYSTEM_PROMPT, erpRules, projectTag, systemPromptFragment]
  .filter((s) => s && s.trim() !== '').join('\n\n');
console.log('System prompt size:', systemPrompt.length, 'chars');
console.log('Tools registered:', registry.definitions().length);
console.log();

// ── User turn ───────────────────────────────────────────────────────────

const userMessage = `我要测试一下 OpenDeploy 的端到端写入能力。请帮我:

1. 在销售订单(SAL_SaleOrder)上建一个名为"端到端测试扩展"的 BOS 扩展
2. 在这个扩展上建一个 TabPage(挂在 FTab1 下),叫"测试页签"
3. 在 TabPage 下建一个单据体(EntryEntity)叫"测试明细"
4. 给单据体加 1 个文本字段叫"备注说明"
5. 然后扩展销售订单到出库单的转换规则(SaleOrder-OutStock),取名"端到端测试转换"
6. 在转换规则扩展上加一条字段映射:目标 FNote ← 来源 FNote(头体,Auto 模式)
7. 验证一下,然后**告诉我两个 extId(表单扩展和转换规则扩展),让我手动清理**

请按顺序一步一步做,每步都用相应的 kingdee_* 工具。不需要先做侦察读元数据,直接动手就行。`;

console.log('👤 USER:\n' + userMessage + '\n');
console.log('─── 启动 agent loop ───\n');

const initialMessages: Message[] = [{
  id: 'm_user_1',
  role: 'user',
  content: userMessage,
  createdAt: new Date().toISOString(),
}];

const client = createLlmClient('deepseek');
let toolCallCount = 0;
let lastDelta = '';
const result = await runAgentLoop({
  client, tools: registry, initialMessages,
  providerId: 'deepseek',
  apiKey, model: 'deepseek-chat',
  systemPrompt,
  maxIterations: 30,
  onEvent: (e) => {
    if (e.type === 'iteration_start') {
      if (lastDelta) { process.stdout.write('\n'); lastDelta = ''; }
      console.log(`\n── iteration ${e.iteration} ──`);
    } else if (e.type === 'delta') {
      process.stdout.write(e.content);
      lastDelta += e.content;
    } else if (e.type === 'tool_call') {
      if (lastDelta) { process.stdout.write('\n'); lastDelta = ''; }
      toolCallCount++;
      const args = JSON.stringify(e.toolCall.arguments);
      console.log(`🔧 [${toolCallCount}] ${e.toolCall.name}(${args.length > 200 ? args.slice(0, 200) + '…' : args})`);
    } else if (e.type === 'tool_result') {
      const preview = e.content.length > 250 ? e.content.slice(0, 250) + '…' : e.content;
      console.log(`   ↳ ${e.isError ? '❌' : '✓'} ${preview.replace(/\n/g, ' ')}`);
    } else if (e.type === 'usage') {
      // skip — too noisy
    } else if (e.type === 'error') {
      console.error('\n[ERROR]', e.error);
    }
  },
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log(`  Done — ${result.length} messages, ${toolCallCount} tool calls`);
console.log('═══════════════════════════════════════════════════════════');
process.exit(0);
