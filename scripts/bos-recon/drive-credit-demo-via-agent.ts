/**
 * Re-run the "信用额度管控" demo end-to-end via agent loop, post the
 * existingHeadEntityRaw fix (commit unstaged) — to determine whether the
 * 信用额度管控 silent-drop bug is reproducible or was a one-off.
 *
 * Same prompt as what the user copy-pasted into the OpenDeploy chat box.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/drive-credit-demo-via-agent.ts
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
console.log('  信用额度管控 demo — re-run after silent-drop investigation');
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

const userMessage = `我是一家贸易公司的实施顾问。客户要求在销售订单(SAL_SaleOrder)上加"信用额度管控 + 客户分级 + 复核流程"。请按下列 8 步做完,**完成后保留所有内容,不要做任何 delete**:

## 一、自建枚举
新建枚举类型「客户信用等级」,3 项: A级 / B级 / C级

## 二、头部基本信息页签 6 类字段(一次批量 add_fields)
| key | type | 中文名 | 关键参数 |
|---|---|---|---|
| F_PAIJ_Grade | combo | 客户等级 | enumTypeName="客户信用等级" |
| F_PAIJ_CreditLimit | amount | 信用额度 | mustInput=true, defaultValue=0, fieldScale=2, fieldPrecision=18 |
| F_PAIJ_CreditEnd | date | 信用到期日 | — |
| F_PAIJ_IsFirstOrder | checkbox | 是否首单 | defaultValue=false |
| F_PAIJ_SalesRep | base_data | 关联业务员 | refBaseDataObjectKey="BD_Empinfo" |
| F_PAIJ_SalesRepName | base_property | 业务员名称 | sourceField="F_PAIJ_SalesRep", srcDisplayFieldName="FName" |

## 三、新建 TabPage + EntryEntity + 8 类字段
- TabPage「信用复核」挂在 FTab1 下
- EntryEntity「复核明细」挂在该 TabPage 下,字段:
  - F_PAIJ_CheckDate (date) — 复核日期
  - F_PAIJ_CheckBy (base_data, BD_Empinfo) — 复核人
  - F_PAIJ_CheckResult (text) — 复核结论
  - F_PAIJ_CheckSeq (int) — 序号
  - F_PAIJ_CheckUnit (unit) — 复核单位(默认 BD_UNIT)
  - F_PAIJ_CheckQty (qty, controlFieldKey="F_PAIJ_CheckUnit", fieldScale=2) — 复核数量
  - F_PAIJ_CheckPrice (price, fieldScale=4) — 复核单价
  - F_PAIJ_CheckRate (decimal, fieldScale=4) — 复核比例

## 四、自定义操作 + 内联 Python
- operationKey = F_PAIJ_CreditCheck (OperationId=45), name "信用复核"
- 内联 Python \`paij_credit_check_plugin\`, pyBody = '# credit check\\nprint("信用复核 OK")'

## 五、3 个工具栏按钮(覆盖 form / list / entry 三种位置)
- **target.kind="form"** — 顶部菜单按钮 "信用复核",绑 F_PAIJ_CreditCheck
- **target.kind="list"** — 列表菜单按钮 "批量信用复核",绑 F_PAIJ_CreditCheck
- **target.kind="entry", entityKey="<上面建的复核明细 entryKey>"** — 单据体工具栏按钮 "拒绝",绑 F_PAIJ_CreditCheck

## 六、业务规则(字段级 + 实体级)
- **字段级 Calculate**: F_PAIJ_Grade 变化 → set F_PAIJ_IsFirstOrder = False
- **实体级 Calculate**: preCondition \`F_PAIJ_IsFirstOrder == True\`, actions \`["F_PAIJ_Grade = \\"C\\""]\`, description "首单默认 C 级"

## 七、表单 Python 插件
register_python_plugins 注册 \`paij_form_main_plugin\` (class 体 pass 即可)

## 八、转换规则扩展(SaleOrder-OutStock)
- create_convert_rule_extension 名 "信用复核携带"
- add_convert_plugin Python 插件 \`paij_carry_credit_plugin\`,OnAfterConvert 携带头字段 FNote 到目标单

---

## 反查闭环(并行)
- get_extension_fields → 14 个字段都在
- list_operations → F_PAIJ_CreditCheck + 3 个按钮
- list_business_rules → entityRules 1 条 + fieldUpdateActions 1 条
- list_form_plugins → paij_form_main_plugin 在
- describe_convert_rule SaleOrder-OutStock → hasExtends=true

## 报告
markdown 表格列出:
1. 扩展 extId、转换规则扩展 extId、枚举 enumTypeId
2. 14 个字段是否全过 + 类型对不对
3. 3 个按钮 menuLocation 标签是否对(menu/listMenu/entry)
4. 2 条业务规则是否全过
5. 表单插件 + 转换插件是否全过

**完成后保留所有内容,不要清理。**`;

console.log('👤 USER prompt length:', userMessage.length, 'chars\n');
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
