/**
 * Mega2 agent-loop e2e — exercises everything that drive-mega didn't:
 *
 *   - Two-level extension (build extension under an existing extension)
 *   - Remaining 6 field types: int / price / amount / qty / unit / base_property
 *   - Entity-level Calculate business rule (preCondition-driven)
 *   - List form extension (SAL_SaleOrder_List) — toolbar button + operation
 *
 * Leaves everything in BOS for manual verification.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/drive-mega2-via-agent.ts
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
console.log('  Mega2 agent-loop — 2-layer ext + remaining field types + list form');
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

const userMessage = `补测剩余的写入能力,完成后**全部不要清理**,我去 BOS 客户端验证。

---

## 阶段 A — 二层扩展(在已有扩展下再扩展一层)

已有的一层扩展:
- extId = 6ba3444d39624d15ae89c78e82a4f480 (端到端测试扩展, 挂 SAL_SaleOrder)
- 这层上已有字段 F_AL_Cust(BaseData→BD_Customer)、F_AL_Note(Text)等

请用 \`k3cloud_create_extension(parentFormId="6ba3444d39624d15ae89c78e82a4f480", extName="agent-loop 二层扩展")\` 在它上面再建一个二层扩展。
**这是 K/3 BOS 标准的扩展继承能力,但 OpenDeploy 没跑过 e2e — 如果 single-layer-tree guard 拦了,告诉我具体 error message,我回头改 guard 逻辑。如果成功了拿到 extId(称之为 extId2)继续后续。**

## 阶段 B — 给二层扩展加 6 类剩余字段

调 \`k3cloud_add_fields\` 把这 6 类字段加到 extId2 的 FTAB_P0(基本信息):

| key | type | 中文名 | 必带参数 |
|---|---|---|---|
| F_AL2_Int | int | 测试整数 | — |
| F_AL2_Price | price | 测试单价 | fieldScale=4, fieldPrecision=18 |
| F_AL2_Amount | amount | 测试金额2 | fieldScale=2, fieldPrecision=18 |
| F_AL2_Unit | unit | 测试单位 | (用默认 BD_UNIT) |
| F_AL2_Qty | qty | 测试数量 | fieldScale=2, controlFieldKey="F_AL2_Unit" |
| F_AL2_CustName | base_property | 客户名称带值 | sourceField="F_AL_Cust"(一层扩展上的客户字段), srcDisplayFieldName="FName" |

**qty 引用同批的 unit field**, 如果工具不允许同批引用,把 unit 字段先单独 add_fields 一次,再批量加剩下的 5 个。

**base_property 引用一层扩展的字段** F_AL_Cust — 如果工具校验只查二层扩展自身字段、报"sourceField 不存在",把这个 finding 记下来,跳过 base_property 字段继续后面。

## 阶段 C — Entity 级 Calculate 业务规则

调 \`k3cloud_add_calculate_rule\` 给 extId2 加一条 **entity 级**(挂 HeadEntity)Calculate 规则:
- mountPoint: { kind: "entity", preCondition: "True", description: "agent-loop 实体级 Calculate 测试" }
- actions: ["F_AL2_Int = 100"]

## 阶段 D — 列表菜单(SAL_SaleOrder_List)

K/3 列表 form 是独立 BOS 对象,FormID = SAL_SaleOrder_List。

1. 调 \`k3cloud_get_object("SAL_SaleOrder_List")\` 确认列表 form 存在
2. 调 \`k3cloud_create_extension(parentFormId="SAL_SaleOrder_List", extName="agent-loop 列表测试")\` 建列表 form 扩展(称之为 extIdList)
3. **如果列表 form 创建失败**(可能 modelTypeId 不一样,工具不支持),记下 error 跳过本阶段
4. 如果成功:
   - 调 \`k3cloud_add_custom_operation\` 加自定义操作: operationKey=ListAgentOp, operationName="测试列表操作", operationId=45, 带一行 Python: 'print("hello from list")'
   - 调 \`k3cloud_add_toolbar_button\` 加列表 form 顶层按钮: target.kind=form, buttonKey=ListAgentBtn, caption="测试列表按钮", boundOperationKey=ListAgentOp, toolbarKey="FToolBar"

## 阶段 E — 反查闭环

并行调 3 个反查:
- \`k3cloud_get_extension_fields(extId2)\` 看 6 类字段是否都到位
- \`k3cloud_list_business_rules(extId2)\` 看 entity 级规则在不在
- \`k3cloud_list_operations(extIdList)\`(如果列表扩展建出来了)看按钮在不在

## 报告

最后用一个 markdown 表给出:
- extId2 (二层扩展 GUID) + 哪些字段写成功 / 失败
- extIdList (列表扩展 GUID, 如建出来) + 按钮是否在
- entity Calculate serviceId
- 任何 trip 的限制 / error,我等你的 finding 列表

**重要:不要做任何 delete。完成后保留所有内容给我去 BOS 验证。**`;

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
  maxIterations: 60,
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
      const preview = e.content.length > 350 ? e.content.slice(0, 350) + '…' : e.content;
      console.log(`   ↳ ${e.isError ? '❌' : '✓'} ${preview.replace(/\n/g, ' ').slice(0, 350)}`);
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
