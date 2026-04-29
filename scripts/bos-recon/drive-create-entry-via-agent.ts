/**
 * Headless agent driver for end-to-end testing of "create entry + add fields"
 * without going through the Electron UI. Uses settings.json for project +
 * LLM credentials, runs the full agent loop, and prints every event to stdout.
 *
 * Goal: reproduce the user's failing flow and capture the actual server
 * error message (which the in-app raw-llm dumps already showed once but the
 * fix requires re-running to verify).
 *
 * Usage:
 *   pnpm tsx scripts/bos-recon/drive-create-entry-via-agent.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { ToolRegistry } from '../../src/main/agent/tools';
import { BUILTIN_TOOLS } from '../../src/main/agent/builtin-tools';
import { buildK3CloudTools } from '../../src/main/agent/k3cloud-tools';
import { buildBosRpcTools } from '../../src/main/agent/bos-rpc-tools';
import { runAgentLoop } from '../../src/main/agent/loop';
import { createLlmClient } from '../../src/main/llm/factory';
import { erpRulesFragment } from '../../src/main/agent/erp-rules';
import type { Message } from '../../src/shared/llm-types';
import type { Project } from '../../src/shared/erp-types';

const settingsPath = path.join(os.homedir(), '.opendeploy', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const project = settings.projects.find((p: Project) => p.id === settings.activeProjectId);
if (!project?.bos) {
  console.error('No active project with bos creds. settings.json:', settingsPath);
  process.exit(1);
}
const apiKey = settings.apiKeys?.deepseek;
if (!apiKey) {
  console.error('No deepseek API key in settings.apiKeys.');
  process.exit(1);
}

const PROMPTS_DIR = path.join(
  process.cwd(),
  'src',
  'main',
  'agent',
  'prompts',
);
const baseSystemPrompt = fs.readFileSync(
  path.join(PROMPTS_DIR, 'base-system.md'),
  'utf8',
).trim();
const k3cloudRules = fs.readFileSync(
  path.join(PROMPTS_DIR, 'erp-rules', 'k3cloud.md'),
  'utf8',
).trim();
const projectTagTpl = fs.readFileSync(
  path.join(PROMPTS_DIR, 'active-project-tag.md'),
  'utf8',
).trim();

console.log('=== Connecting to K/3 Cloud ===');
const connector = new K3CloudConnector(project.bos);
await connector.connect();
console.log('connected to', project.bos.baseUrl);
console.log();

// Headless session manager — bos tools call this when they need a session.
// We've already connected the connector; reuse its session for write tools.
const sessionMgr = {
  async getOrLogin(_projectId: string) {
    const s = connector.getSession();
    if (!s) throw new Error('connector has no session');
    return s;
  },
  invalidate(_projectId: string) {},
};

const registry = new ToolRegistry();
for (const t of BUILTIN_TOOLS) registry.register(t);
for (const t of buildK3CloudTools(connector)) registry.register(t);
for (const t of await buildBosRpcTools(connector, project.id, sessionMgr)) {
  registry.register(t);
}
console.log('registered tools:', registry.definitions().map((d) => d.name).join(', '));
console.log();

const projectTag = projectTagTpl
  .replace('{{acctId}}', project.bos.acctId)
  .replace('{{baseUrl}}', project.bos.baseUrl)
  .replace('{{productName}}', '金蝶云星空 企业版/标准版');
const erpRules = erpRulesFragment('k3cloud', { k3cloud: k3cloudRules });
const systemPrompt = [baseSystemPrompt, erpRules, projectTag]
  .filter((s) => s && s.trim() !== '')
  .join('\n\n');

const userPrompt = `在销售订单上加一个新的单据体,叫"质检明细",
里面要有这些字段:

检验员
检验日期
检验结果
备注

注:遇到选择请直接选最常见 / 最简单的方案,不用反问我。例如:复用现有扩展、检验员用 BD_Empinfo、检验结果用单行文本(不用枚举)、备注用单行文本、新建一个 TabPage 挂在 FTab1 下放这个 entry。直接动手做完闭环反查告诉我结果即可。`;

const initialMessages: Message[] = [
  {
    id: 'u_test',
    role: 'user',
    content: userPrompt,
    createdAt: new Date().toISOString(),
  },
];

console.log('=== Running agent loop ===');
console.log('User:', userPrompt.split('\n')[0], '...');
console.log();

const finalMessages = await runAgentLoop({
  client: createLlmClient('deepseek'),
  tools: registry,
  initialMessages,
  providerId: 'deepseek',
  apiKey,
  model: 'deepseek-v4-flash',
  systemPrompt,
  maxIterations: 20,
  conversationId: 'drive_test_' + Date.now(),
  onEvent: (e) => {
    if (e.type === 'tool_call') {
      console.log(
        `\n[tool_call] ${e.toolCall.name}(${JSON.stringify(e.toolCall.arguments).slice(0, 200)}...)`,
      );
    } else if (e.type === 'tool_result') {
      const preview = String(e.content).slice(0, 600);
      console.log(`[tool_result] ${e.isError ? 'ERROR' : 'ok'} ${preview}`);
      console.log();
    } else if (e.type === 'iteration_start') {
      // quiet
    } else if (e.type === 'delta') {
      process.stdout.write(e.content);
    } else if (e.type === 'reasoning_delta') {
      // quiet
    } else if (e.type === 'error') {
      console.log(`\n[ERROR] ${e.error}`);
    }
  },
});

console.log('\n\n=== Final state ===');
console.log('total messages:', finalMessages.length);
const lastAssistant = finalMessages.filter((m) => m.role === 'assistant').slice(-1)[0];
if (lastAssistant) {
  console.log('last assistant:', String(lastAssistant.content).slice(0, 1000));
}

await connector.disconnect();
