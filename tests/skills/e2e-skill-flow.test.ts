import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runAgentLoop } from '../../src/main/agent/loop';
import { ToolRegistry } from '../../src/main/agent/tools';
import { buildSkillsContext } from '../../src/main/agent/skills-integration';
import type { LlmClient } from '../../src/main/llm/types';
import type { StreamEvent } from '../../src/shared/llm-types';

/**
 * End-to-end exercise of the full skills loop: the agent sees a skill in the
 * system-prompt catalog, calls load_skill, gets the body, incorporates the
 * guidance into its final answer. No real LLM is hit — a scripted fake client
 * replays the tool-call cycle we expect in production.
 */

let root: string;

async function seedSkill(id: string, description: string, body: string): Promise<void> {
  const dir = path.join(root, 'skills', ...id.split('/'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${id.split('/').pop()}\ndescription: ${JSON.stringify(description)}\nversion: 1.0.0\n---\n${body}\n`,
    'utf8'
  );
}

function scriptedClient(scripts: StreamEvent[][]): LlmClient {
  let call = 0;
  return {
    async *stream() {
      const script = scripts[call++];
      if (!script) throw new Error('fake client ran out of scripts');
      for (const e of script) yield e;
    }
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendeploy-e2e-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('skills e2e: discover → load → answer', () => {
  it('injects the catalog, runs load_skill, and echoes the skill body', async () => {
    await seedSkill(
      'common/requirements-clarification',
      'Use when requirements are incomplete.',
      'ASK THESE FIVE QUESTIONS'
    );

    // Context snapshot: catalog + load_skill tool bound to the seeded root.
    const { systemPromptFragment, loadSkillTool } = await buildSkillsContext({ root });
    const registry = new ToolRegistry();
    registry.register(loadSkillTool);

    // Fake LLM: iteration 1 emits a load_skill call; iteration 2 answers
    // using the body that came back.
    const client = scriptedClient([
      [
        {
          type: 'tool_call',
          toolCall: {
            id: 'tc1',
            name: 'load_skill',
            arguments: { id: 'common/requirements-clarification' }
          }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'delta', content: 'Per the skill: ASK THESE FIVE QUESTIONS' },
        { type: 'done', finishReason: 'stop' }
      ]
    ]);

    const finalMessages = await runAgentLoop({
      client,
      tools: registry,
      initialMessages: [
        {
          id: 'u1',
          role: 'user',
          content: '客户说他们想做个信用额度预警',
          createdAt: ''
        }
      ],
      providerId: 'test',
      apiKey: 'k',
      systemPrompt: `You are a test agent.\n\n${systemPromptFragment}`
    });

    // System prompt contains the catalog entry (agent would see this).
    const systemMsg = finalMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('common/requirements-clarification');
    expect(systemMsg?.content).toContain('Use when requirements are incomplete');

    // Tool cycle: the tool result in the message trail should carry the body.
    const toolMsg = finalMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('ASK THESE FIVE QUESTIONS');

    // Final assistant message incorporates the body.
    const last = finalMessages[finalMessages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toContain('ASK THESE FIVE QUESTIONS');
  });

  it('unknown skill id surfaces as a tool error without crashing the loop', async () => {
    await seedSkill('common/a', 'present', 'body a');

    const { loadSkillTool } = await buildSkillsContext({ root });
    const registry = new ToolRegistry();
    registry.register(loadSkillTool);

    const client = scriptedClient([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc1', name: 'load_skill', arguments: { id: 'common/ghost' } }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'delta', content: 'skill not found, fallback answer' },
        { type: 'done', finishReason: 'stop' }
      ]
    ]);

    const finalMessages = await runAgentLoop({
      client,
      tools: registry,
      initialMessages: [{ id: 'u', role: 'user', content: 'x', createdAt: '' }],
      providerId: 'test',
      apiKey: 'k'
    });

    const toolMsg = finalMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/unknown skill/i);

    const last = finalMessages[finalMessages.length - 1];
    expect(last.content).toContain('fallback');
  });
});
