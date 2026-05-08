/**
 * Variant of drive-5_12_6-7-via-agent.ts that does NOT auto-clean —
 * leaves the sacrificial extension in BOS so the user can verify it
 * in BOS Designer / K/3 client manually.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/drive-5_12_6-7-keep-via-agent.ts
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
console.log('  Agent-loop e2e — 5.12.6 + 5.12.7 (KEEP extension for manual verify)');
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

const userMessage = `请帮我做一个端到端验证测试,测试自定义操作 + 工具栏按钮 + 字段属性面板。

**步骤**:

1. 在销售订单(SAL_SaleOrder)上建一个 BOS 扩展,叫"agent-loop 操作按钮属性测试"
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
6. **完成后告诉我创建的 extId,不要做任何删除**(我要去 BOS 客户端肉眼验证)

请按顺序做,每步出问题告诉我哪步出错。完成后报告:
- extId 是什么
- 操作 + 按钮反查时看到了吗

不需要先 list_extensions 或 get_object 探侦察,直接动手按步骤做。**重要:不要清理,留着给我验证。**`;

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
      const m = e.content.match(/"extId"\s*:\s*"([0-9a-f]{32})"/);
      if (m && !createdExtIds.includes(m[1])) createdExtIds.push(m[1]);
    } else if (e.type === 'error') {
      console.error('\n[ERROR]', e.error);
    }
  },
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log(`  agent loop finished — ${result.length} messages, ${toolCallCount} tool calls`);
console.log(`  Captured extIds: ${createdExtIds.join(', ') || '(none)'}`);
console.log('═══════════════════════════════════════════════════════════\n');
process.exit(0);
