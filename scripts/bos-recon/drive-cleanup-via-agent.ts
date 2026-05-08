/**
 * Round 5 cleanup driver — exercises every delete tool we ship.
 *
 * Cleans up everything the previous 4 rounds + the 2 finding-fix verify
 * scripts left in BOS:
 *   - Level-2 extension (bf6f107f) and its rules + fields
 *   - Level-1 extension (6ba3444d) and its buttons / operation / plugin /
 *     business rule / tab page / entry / fields
 *   - Convert-rule extension (746f000e) and its convert plugin
 *   - Custom enum type (c80946a6) created in round 3
 *   - List-menu button (AgentLoopListBtn) added by verify-list-menu-button
 *   - Entity-level Calculate rule (5cbb0c23) added by verify-entity-rule-fix
 *
 * Delete tools to exercise (each must run at least once):
 *   1. k3cloud_delete_business_rule
 *   2. k3cloud_delete_toolbar_button
 *   3. k3cloud_delete_operation
 *   4. k3cloud_delete_tab_page
 *   5. k3cloud_delete_entry
 *   6. k3cloud_delete_enum_type
 *   7. k3cloud_delete_convert_rule_extension
 *   8. k3cloud_delete_extension
 *
 * Final assertion: list_extensions("SAL_SaleOrder") returns 0 reusable
 * extensions; list_convert_rule extensions returns no agent-loop entry.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/drive-cleanup-via-agent.ts
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
console.log('  Round 5 cleanup — exercise all delete tools');
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

const userMessage = `请把今天测试时建的所有 BOS 扩展 / 规则 / 操作 / 按钮 / 枚举全部清理掉,顺便**验证 8 个 delete 工具每个至少跑一次**。

## 待清理对象

### 一层扩展(端到端测试扩展) extId=6ba3444d39624d15ae89c78e82a4f480 挂 SAL_SaleOrder
- 字段:F_PAIJ_TESTNOTE / F_PAIJ_AGENTNOTE / F_AL_Note / F_AL_Amt / F_AL_Date / F_AL_Enable / F_AL_Cust / F_AL_Status
- 自定义操作:AgentLoopOp(带 Python 插件 agent_loop_test)
- 工具栏按钮:AgentLoopBtn(form 顶层) / AgentLoopListBtn(列表菜单 — 用 target.kind="list" 验过)
- 表单插件:agent_loop_form_plugin
- 业务规则:F_AL_Cust 上字段级 Calculate
- TabPage:测试页签 + EntryEntity:测试明细 / F_PAIJ_Entity_h1a

### 二层扩展(agent-loop 二层扩展) extId=bf6f107f436b420b966462be1580ffd5 挂在一层下
- 字段:F_AL2_Int / F_AL2_Price / F_AL2_Amount / F_AL2_Unit / F_AL2_Qty / F_AL2_CustName
- 字段级 Calculate(F_AL2_Int 上)
- 实体级 Calculate(描述含"multi-layer fix verify"的那条,挂 HeadEntity)

### 转换规则扩展(端到端测试转换) extId=746f000ea16b450d88343e12cfe70ebe 在 SaleOrder-OutStock 上
- 转换插件 PAIJ_NoteCarryPlugin

### 自定义枚举类型(AgentLoop 测试状态) enumTypeId=c80946a6-4a28-4a00-8358-4de422623c76

---

## 必须按这顺序删(精细 → 粗粒度,**每一步都用相应的 delete 工具**)

1. **先删二层扩展上的两条业务规则** — 用 \`k3cloud_delete_business_rule\`(call 2 次)
2. **删一层扩展上的字段级 Calculate(F_AL_Cust)** — 用 \`k3cloud_delete_business_rule\`(可与上面合并算 1 个工具被调用过)
3. **删两个工具栏按钮** — 用 \`k3cloud_delete_toolbar_button\` 删 AgentLoopBtn + AgentLoopListBtn
4. **删自定义操作** — 用 \`k3cloud_delete_operation\` 删 AgentLoopOp
5. **删 TabPage** — 用 \`k3cloud_delete_tab_page\` 删测试页签
6. **删 EntryEntity** — 用 \`k3cloud_delete_entry\` 删测试明细(注意:如果 TabPage 删了之后 entry 自动跟着没了,本步可能报"不存在",这种情况记录下来不算失败)
7. **删二层扩展整个** — 用 \`k3cloud_delete_extension\`
8. **删一层扩展整个** — 用 \`k3cloud_delete_extension\`
9. **删转换规则扩展** — 用 \`k3cloud_delete_convert_rule_extension\`
10. **删自定义枚举类型** — 用 \`k3cloud_delete_enum_type\`

## 反查闭环

最后并行调:
- \`k3cloud_list_extensions(parentFormId="SAL_SaleOrder")\` 应该返回 count=0
- \`k3cloud_list_convert_rules\` 看 SaleOrder-OutStock 的 hasExtends 应该是 false
- \`k3cloud_list_enum_types\` 搜 "AgentLoop" 应该 0 命中

## 报告格式

| delete 工具 | 调用次数 | 全部成功? |
|---|---|---|
| delete_business_rule | ? | ? |
| delete_toolbar_button | ? | ? |
| delete_operation | ? | ? |
| delete_tab_page | ? | ? |
| delete_entry | ? | ? |
| delete_extension | ? | ? |
| delete_convert_rule_extension | ? | ? |
| delete_enum_type | ? | ? |

最后报"清理完成,SAL_SaleOrder 上 0 扩展"或者列出残留。

不要并行删除(写操作可能撞 backup)。读反查可以并行。`;

console.log('👤 USER:\n' + userMessage + '\n');
console.log('─── starting agent loop ───\n');

const initialMessages: Message[] = [{
  id: 'm_user_1', role: 'user', content: userMessage, createdAt: new Date().toISOString(),
}];

const client = createLlmClient('deepseek');
const calledTools = new Map<string, number>();
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
      calledTools.set(e.toolCall.name, (calledTools.get(e.toolCall.name) ?? 0) + 1);
      const args = JSON.stringify(e.toolCall.arguments);
      console.log(`🔧 [${toolCallCount}] ${e.toolCall.name}(${args.length > 200 ? args.slice(0, 200) + '…' : args})`);
    } else if (e.type === 'tool_result') {
      const preview = e.content.length > 250 ? e.content.slice(0, 250) + '…' : e.content;
      console.log(`   ↳ ${e.isError ? '❌' : '✓'} ${preview.replace(/\n/g, ' ').slice(0, 250)}`);
    } else if (e.type === 'error') {
      console.error('\n[ERROR]', e.error);
    }
  },
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log(`  cleanup finished — ${result.length} messages, ${toolCallCount} tool calls`);
const expected = [
  'k3cloud_delete_business_rule',
  'k3cloud_delete_toolbar_button',
  'k3cloud_delete_operation',
  'k3cloud_delete_tab_page',
  'k3cloud_delete_entry',
  'k3cloud_delete_extension',
  'k3cloud_delete_convert_rule_extension',
  'k3cloud_delete_enum_type',
];
console.log('  Delete tool coverage:');
for (const t of expected) {
  const n = calledTools.get(t) ?? 0;
  console.log(`    ${n > 0 ? '✓' : '✗'} ${t}: ${n}x`);
}
console.log('═══════════════════════════════════════════════════════════\n');
process.exit(0);
