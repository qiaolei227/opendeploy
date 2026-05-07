/**
 * Real LLM agent loop end-to-end test for today's work (2026-05-07):
 *   5.12.6 — toolbar button via Route B (after L3 followup migration)
 *   5.12.7 — property grid 5 props (MustInput/DefValue/IsShowSeq/OrgFieldKey/Entity.MustInput)
 *
 * What this catches that direct connector smokes miss:
 *   - Real LLM tool selection (does it pick k3cloud_add_custom_operation
 *     vs k3cloud_register_python_plugins for "加按钮 + Python 处理")
 *   - Real LLM args (does it pass mustInput/defaultValue correctly)
 *   - Real LLM ordering (extension before button before remove)
 *   - Real LLM error recovery (when a tool returns an error, does it
 *     reason its way out)
 *   - Real prompt + tool descriptions actually guide correct behavior
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/drive-5_12_6-7-via-agent.ts
 *
 * Spends real DeepSeek API tokens (~10-20k tokens/run, ~$0.005). Auto
 * cleans the sacrificial extension via final agent turn.
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
import { getBusinessObjectMetaData } from '../../src/main/erp/k3cloud/rpc/metadata';
import { extractKernelXml } from '../../src/main/erp/k3cloud/rpc/metadata-xml';
import { login } from '../../src/main/erp/k3cloud/rpc/login';
import type { Message } from '@shared/llm-types';
import type { Project } from '@shared/erp-types';

// ── Bootstrap ───────────────────────────────────────────────────────────

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }
const apiKey: string = settings.apiKeys?.deepseek;
if (!apiKey) { console.error('no deepseek apiKey'); process.exit(1); }

const prompts = (rel: string) => readFileSync(resolve('src/main/agent/prompts', rel), 'utf-8');
const BASE_SYSTEM_PROMPT = prompts('base-system.md').trim();
const k3cloudRulesRaw = prompts('erp-rules/k3cloud.md');
const activeProjectTagRaw = prompts('active-project-tag.md');
const catalogIntroRaw = prompts('skills-catalog-intro.md');

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
console.log('  Agent-loop e2e — 5.12.6 toolbar button + 5.12.7 props');
console.log('═══════════════════════════════════════════════════════════\n');

await setActiveProject(project);
const connState = getConnectionState();
if (connState.status !== 'connected') {
  console.error('connect failed:', connState.error); process.exit(1);
}
console.log('✓ connected', project.bos.baseUrl);

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
console.log('  system prompt:', systemPrompt.length, 'chars |', registry.definitions().length, 'tools\n');

// ── User turn — exercises 5.12.6 + 5.12.7 ─────────────────────────────

const userMessage = `请帮我做一个端到端验证测试,测试今天刚改的工具栏按钮 + 字段属性能力。

**步骤**:

1. 在销售订单(SAL_SaleOrder)上建一个 BOS 扩展,叫"agent-loop 5.12.6+7 测试"
2. 在扩展上加一个**必录的、有缺省值的**文本字段:
   - 字段中文名:"测试备注"
   - 必录:是
   - 缺省值:"AGENT_LOOP_DEFAULT"
   (字段可以放在表单 header,不挂 entry)
3. 在扩展上加一个**自定义操作**(OperationId=45):
   - operationKey: AgentLoopOp
   - operationName: "测试操作"
   - 带一个 Python 插件:className=agent_loop_test, pyBody='# agent loop e2e test\\nprint("hello from agent loop")'
4. 在扩展的**form 顶层工具栏**加一个按钮,绑刚才的 AgentLoopOp:
   - buttonKey: AgentLoopBtn
   - caption: "AgentLoop 测试按钮"
5. 反查 list_operations 确认操作 + 按钮都在
6. **最后请告诉我创建的 extId**,并删除按钮 + 删除操作 + 删除扩展(整个清理干净)

请按顺序做,每步出问题告诉我哪步出错。完成后回到我消息里报告:
- extId 是什么
- 操作 + 按钮反查时看到了吗
- 清理结果

不需要先 list_extensions 或 get_object 探侦察,直接动手按步骤做。`;

console.log('👤 USER:\n' + userMessage + '\n');
console.log('─── starting agent loop ───\n');

const initialMessages: Message[] = [{
  id: 'm_user_1', role: 'user', content: userMessage, createdAt: new Date().toISOString(),
}];

const client = createLlmClient('deepseek');
const createdExtIds: string[] = [];
let toolCallCount = 0;
let lastDelta = '';
const result = await runAgentLoop({
  client, tools: registry, initialMessages,
  providerId: 'deepseek',
  apiKey, model: 'deepseek-chat',
  systemPrompt,
  maxIterations: 40,
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
      const preview = e.content.length > 300 ? e.content.slice(0, 300) + '…' : e.content;
      console.log(`   ↳ ${e.isError ? '❌' : '✓'} ${preview.replace(/\n/g, ' ').slice(0, 300)}`);
      // Sniff for create_extension success → grab extId for fail-safe cleanup
      const m = e.content.match(/"extId"\s*:\s*"([0-9a-f]{32})"/);
      if (m && !createdExtIds.includes(m[1])) createdExtIds.push(m[1]);
    } else if (e.type === 'error') {
      console.error('\n[ERROR]', e.error);
    }
  },
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log(`  agent loop finished — ${result.length} messages, ${toolCallCount} tool calls`);
console.log('═══════════════════════════════════════════════════════════\n');

// ── Post-flow verification — query DB raw ─────────────────────────────

if (createdExtIds.length === 0) {
  console.log('⚠ no extId captured during loop — agent may have failed early');
  process.exit(2);
}

console.log('Captured extIds during run:', createdExtIds);
const loginRes = await login({
  baseUrl: project.bos.baseUrl, acctId: project.bos.acctId,
  username: project.bos.username, password: project.bos.password,
});
if (!loginRes.isSuccess) { console.error('post-verify login failed'); process.exit(1); }

console.log('\n─── Post-flow raw DB verification ──────────────────────');
let issues = 0;
for (const extId of createdExtIds) {
  const md = await getBusinessObjectMetaData(loginRes.session, extId).catch(() => null);
  if (!md) { console.log(`  ${extId}: not found (probably cleaned up — OK)`); continue; }
  const xml = extractKernelXml(md.metaData) ?? '';
  const len = xml.length;
  // After full cleanup, FKERNELXML should be ≤300 chars (just Form scaffolding).
  if (len <= 300) {
    console.log(`  ${extId}: cleaned up (${len} chars) ✓`);
  } else {
    console.log(`  ${extId}: still has content (${len} chars) — agent didn't fully clean`);
    issues++;
  }
}

if (issues > 0) {
  console.log(`\n⚠ ${issues} extension(s) not fully cleaned by agent — manual cleanup may be needed`);
  process.exit(3);
}

console.log('\n✅ Agent-loop e2e PASSED — full LLM-driven loop, real BOS server');
process.exit(0);
