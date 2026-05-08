/**
 * Mega agent-loop e2e — exercises the long tail of write tools that the
 * existing drive-real-agent-loop / drive-5_12_6-7 don't cover:
 *
 *   - Multi-typed fields in one batch (decimal / date / checkbox / base_data / combo)
 *   - k3cloud_create_enum_type (custom dropdown source)
 *   - k3cloud_register_python_plugins (form-level plugin)
 *   - k3cloud_add_calculate_rule (field-bound IronPython assignment)
 *   - k3cloud_get_form_layout / get_extension_fields (read-back verify)
 *
 * Leaves the extension in BOS for manual verification.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/drive-mega-via-agent.ts
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
console.log('  Mega agent-loop — multi-typed fields + enum + plugin + business-rule');
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

const userMessage = `请帮我做一个综合端到端测试,覆盖多种字段类型 + 枚举 + Python 插件 + 业务规则。
所有写入都打在销售订单(SAL_SaleOrder)的扩展上,**完成后不要清理任何东西**,我要去 BOS 客户端验证。

**重要前提**:SAL_SaleOrder 上已经有一个本项目扩展(端到端测试扩展, extId=6ba3444d39624d15ae89c78e82a4f480)。
single-layer-tree 规则禁止建第 2 个并列扩展 — 请**直接复用**这个 extId 把所有内容打上去,不要反问、不要尝试删了重建。

**步骤**:

1. 复用已有扩展 extId=6ba3444d39624d15ae89c78e82a4f480(可先 list_extensions 确认),后面所有写入都用这个 extId

2. 建一个自定义枚举类型,中文名"AgentLoop 测试状态",包含 3 个枚举项:
   - "待审"  (Value=A)
   - "审核中" (Value=B)
   - "已审"  (Value=C)
   (用 k3cloud_create_enum_type)

3. **一次** k3cloud_add_fields 调用批量加 6 个字段(全放在表单 header / FTAB_P0 上):
   - text 字段:"测试备注" (key: F_AL_Note)
   - decimal 字段:"测试金额" (key: F_AL_Amt, fieldScale=2, fieldPrecision=18)
   - date 字段:"测试日期" (key: F_AL_Date)
   - checkbox 字段:"测试启用" (key: F_AL_Enable, defaultValue=true)
   - base_data 字段:"关联客户" (key: F_AL_Cust, refBaseDataObjectKey=BD_Customer)
   - combo 字段:"测试状态" (key: F_AL_Status, enumTypeName="AgentLoop 测试状态")

4. 注册一个表单 Python 插件 (k3cloud_register_python_plugins):
   - className: agent_loop_form_plugin
   - description: "agent-loop e2e 测试用 form plugin"
   - pyBody: '# AgentLoop e2e form plugin\\nfrom Kingdee.BOS.Core.DynamicForm.PlugIn import AbstractDynamicFormPlugIn\\nclass agent_loop_form_plugin(AbstractDynamicFormPlugIn):\\n    pass'

5. 加一条 Calculate 业务规则,**字段级**,绑在 F_AL_Cust(关联客户)字段上:
   - 当客户字段变化时,set F_AL_Note = "已选客户"
   - mountPoint: kind=field, fieldKey=F_AL_Cust
   - actions: ["F_AL_Note = '已选客户'"]

6. 反查闭环:
   - k3cloud_get_extension_fields 看 6 个字段都在
   - k3cloud_list_business_rules 看 Calculate 规则在
   - k3cloud_list_form_plugins 看 Python 插件在

7. **最后报告 extId**(我要去 BOS 验证),不要做任何清理。

按顺序做,出问题告诉我哪步出错。可以并行的工具(只读反查)就并行。**重要:不要清理。**`;

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
  maxIterations: 50,
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
      console.log(`🔧 [${toolCallCount}] ${e.toolCall.name}(${args.length > 250 ? args.slice(0, 250) + '…' : args})`);
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
