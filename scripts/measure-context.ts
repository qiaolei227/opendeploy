/**
 * Measure the per-request context the LLM sees on turn 1:
 *   system prompt (assembled from prompt md files + skills catalog)
 *   + tool definitions (sent in the API tools array)
 *   + user message
 *
 * Outputs a per-section breakdown so we can see where the bytes go.
 *
 * Token estimate:
 *   - Chinese characters ≈ 1.5 chars/token
 *   - ASCII (JSON, code, English) ≈ 4 chars/token
 *   - Mixed content (which most of our prompts are) ≈ 2 chars/token midpoint
 *   We report `chars` and approx tokens at 2 chars/token.
 *
 * Usage: node --experimental-strip-types scripts/measure-context.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ToolRegistry } from '../src/main/agent/tools';
import { BUILTIN_TOOLS } from '../src/main/agent/builtin-tools';
import { buildSkillsContext } from '../src/main/agent/skills-integration';
import { buildK3CloudTools } from '../src/main/agent/k3cloud-tools';
import { erpRulesFragment } from '../src/main/agent/erp-rules';
import { buildPluginTools } from '../src/main/agent/plugin-tools';
import { buildBosWriteTools } from '../src/main/agent/bos-write-tools';

// Minimal mock connector — only `.config.database` is read at definition
// build time; everything else lives in execute() closures we never call.
const FAKE_CONNECTOR = { config: { database: 'AIS20260302144343' } } as never;
const FAKE_PROJECT_ID = 'demo-project';

const PROMPTS_DIR = 'src/main/agent/prompts';

const tok = (s: string) => Math.ceil(s.length / 2);
const fmt = (label: string, chars: number) =>
  `  ${label.padEnd(38)} chars=${String(chars).padStart(6)}  ≈ ${String(tok(chars.toString().length === 0 ? '' : ' '.repeat(chars))).padStart(5)} tokens`;

async function main() {
  // 1. Read raw prompts (same as ipc-llm.ts via Vite ?raw)
  const baseRaw = (await readFile(join(PROMPTS_DIR, 'base-system.md'), 'utf-8')).trim();
  const k3cloudRaw = await readFile(join(PROMPTS_DIR, 'erp-rules/k3cloud.md'), 'utf-8');
  const activeTagRaw = await readFile(join(PROMPTS_DIR, 'active-project-tag.md'), 'utf-8');
  const catalogIntroRaw = await readFile(join(PROMPTS_DIR, 'skills-catalog-intro.md'), 'utf-8');

  // 2. Build skills catalog (K/3 Cloud project active scenario)
  const { systemPromptFragment } = await buildSkillsContext({
    activeErpProvider: 'k3cloud',
    catalogIntro: catalogIntroRaw
  });

  // 4. ERP rules
  const erpRules = erpRulesFragment('k3cloud', { k3cloud: k3cloudRaw });

  // 5. Assemble final system prompt (mirror ipc-llm.ts; projectTag rendered
  //    above with placeholder substitution since the active-project module
  //    requires a live connector singleton)
  const renderedProjectTag = activeTagRaw
    .trim()
    .replace('{{database}}', 'AIS20260302144343')
    .replace('{{productName}}', '金蝶云星空 企业版/标准版');
  const systemPrompt = [baseRaw, erpRules, renderedProjectTag, systemPromptFragment]
    .filter((s) => s && s.trim() !== '')
    .join('\n\n');

  // 6. Build full tool registry (same as ipc-llm.ts)
  const registry = new ToolRegistry();
  for (const t of BUILTIN_TOOLS) registry.register(t);
  // load_skill / load_skill_file come from buildSkillsContext too — pull them
  const skillsCtx = await buildSkillsContext({
    activeErpProvider: 'k3cloud',
    catalogIntro: catalogIntroRaw
  });
  registry.register(skillsCtx.loadSkillTool);
  registry.register(skillsCtx.loadSkillFileTool);
  for (const t of buildK3CloudTools(FAKE_CONNECTOR)) registry.register(t);
  for (const t of buildPluginTools()) registry.register(t);
  for (const t of buildBosWriteTools(FAKE_CONNECTOR, FAKE_PROJECT_ID)) registry.register(t);

  const toolDefs = registry.definitions();
  const toolsJson = JSON.stringify(
    toolDefs.map((d) => ({ type: 'function', function: d }))
  );

  // 7. User message
  const userMsg =
    '我们销售部经常发生重复下单——同一个销售员对同一个客户,在同一天里录了两张内容差不多的销售订单,其实是手抖重复了。保存销售订单的时候,如果发现今天这个客户已经有过同一个物料的订单了,给销售员一个提示但不阻断,让他确认要不要继续保存。';

  // ─── Report ────────────────────────────────────────────────────────────
  console.log('\n=== System prompt 组成 ===');
  console.log(`  base-system.md                          chars=${String(baseRaw.length).padStart(6)}  ≈ ${String(tok(baseRaw)).padStart(5)} tokens`);
  console.log(`  erp-rules/k3cloud.md                    chars=${String(erpRules.length).padStart(6)}  ≈ ${String(tok(erpRules)).padStart(5)} tokens`);
  console.log(`  active-project-tag (rendered)           chars=${String(renderedProjectTag.length).padStart(6)}  ≈ ${String(tok(renderedProjectTag)).padStart(5)} tokens`);
  console.log(`  skills catalog (K/3 active, 9 visible)  chars=${String(systemPromptFragment.length).padStart(6)}  ≈ ${String(tok(systemPromptFragment)).padStart(5)} tokens`);
  console.log(`  --- 系统提示词总 ---                    chars=${String(systemPrompt.length).padStart(6)}  ≈ ${String(tok(systemPrompt)).padStart(5)} tokens`);

  console.log(`\n=== Tool definitions (${toolDefs.length} 个工具) ===`);
  for (const d of toolDefs) {
    const j = JSON.stringify({ type: 'function', function: d });
    console.log(`  ${d.name.padEnd(46)} chars=${String(j.length).padStart(5)}  ≈ ${String(tok(j)).padStart(4)} tokens`);
  }
  console.log(`  --- Tools JSON 总 ---                       chars=${String(toolsJson.length).padStart(6)}  ≈ ${String(tok(toolsJson)).padStart(5)} tokens`);

  console.log('\n=== 用户消息 ===');
  console.log(`  user msg                                chars=${String(userMsg.length).padStart(6)}  ≈ ${String(tok(userMsg)).padStart(5)} tokens`);

  const total = systemPrompt.length + toolsJson.length + userMsg.length;
  console.log(`\n=== 第 1 轮"提交给 LLM 之前"总输入 ===`);
  console.log(`  TOTAL                                   chars=${String(total).padStart(6)}  ≈ ${String(tok(total)).padStart(5)} tokens (≈ ${Math.ceil(total / 1.3)} 中文 token,DeepSeek/Qwen 口径)`);

  // Note: buildPluginTools() needs a real connection state singleton — script
  // can't easily mock that without booting Electron. The 3 plugin tools
  // (write_plugin / list_plugins / read_plugin) add roughly 600-800 chars to
  // the toolsJson on a real run.
  console.log(`\n  (注:write_plugin / list_plugins / read_plugin 因 mock 限制未注册,实际再加 ~700 chars / ~350 token)`);

  // Agent typically explores in turn 1 — these get appended as assistant
  // messages + tool responses BEFORE the final reply. Numbers below are
  // observation-based ranges from real chat traces.
  console.log(`\n=== 第 1 轮 agent 探索后,context 还会增长(估算) ===`);
  console.log(`  load_skill body × 1-2 个                      ≈ +2,000-6,000 chars`);
  console.log(`  kingdee_get_fields 默认(lean:只返 keys)       ≈ +500-1,500 chars`);
  console.log(`  kingdee_get_fields + keyword 过滤(仅匹配项)   ≈ +200-800 chars`);
  console.log(`  kingdee_get_fields + includeDetail:true (全量) ≈ +5,000-15,000 chars(罕用)`);
  console.log(`  kingdee_list_extensions / list_form_plugins   ≈ +500-2,000 chars`);
  console.log(`  agent 自己的 reasoning 文本                   ≈ +1,000-3,000 chars`);
  console.log(`  --- 估算(lean 默认路径) ---                    ≈ ${total + 4000}-${total + 12000} chars`);
  console.log(`                                                  ≈ ${Math.ceil((total + 4000) / 1.3)}-${Math.ceil((total + 12000) / 1.3)} token (中文口径)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
