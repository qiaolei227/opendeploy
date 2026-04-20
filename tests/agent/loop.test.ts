import { describe, it, expect } from 'vitest';
import { runAgentLoop, type AgentLoopEvent } from '../../src/main/agent/loop';
import type { LlmClient } from '../../src/main/llm/types';
import type { Message, StreamEvent } from '../../src/shared/llm-types';
import { ToolRegistry } from '../../src/main/agent/tools';

function fakeClient(scripts: StreamEvent[][]): LlmClient {
  let call = 0;
  return {
    async *stream() {
      const script = scripts[call++];
      for (const e of script) yield e;
    }
  };
}

describe('runAgentLoop', () => {
  it('single turn, no tools', async () => {
    const client = fakeClient([[
      { type: 'delta', content: 'Hello' },
      { type: 'delta', content: ' world' },
      { type: 'done', finishReason: 'stop' }
    ]]);
    const events: AgentLoopEvent[] = [];
    const finalMessages = await runAgentLoop({
      client,
      tools: new ToolRegistry(),
      initialMessages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: '' }],
      providerId: 'test',
      apiKey: 'k',
      onEvent: (e) => events.push(e)
    });

    expect(events.filter(e => e.type === 'delta').map(e => e.type === 'delta' ? e.content : '')).toEqual(['Hello', ' world']);
    expect(finalMessages[finalMessages.length - 1].content).toBe('Hello world');
    expect(finalMessages[finalMessages.length - 1].role).toBe('assistant');
  });

  it('tool call cycle: LLM calls tool, tool result fed back, LLM finishes', async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'echo',
        description: 'echo input',
        parameters: { type: 'object', properties: { text: { type: 'string' } } }
      },
      async execute(args) { return `echoed: ${args.text}`; }
    });

    const client = fakeClient([
      [
        { type: 'tool_call', toolCall: { id: 'tc1', name: 'echo', arguments: { text: 'hi' } } },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'delta', content: 'ok echoed done' },
        { type: 'done', finishReason: 'stop' }
      ]
    ]);

    const events: AgentLoopEvent[] = [];
    const finalMessages = await runAgentLoop({
      client, tools: registry, providerId: 't', apiKey: 'k',
      initialMessages: [{ id: 'u', role: 'user', content: 'echo hi', createdAt: '' }],
      onEvent: (e) => events.push(e)
    });

    expect(events.some(e => e.type === 'tool_call')).toBe(true);
    expect(events.some(e => e.type === 'tool_result')).toBe(true);
    const toolMsg = finalMessages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toBe('echoed: hi');
  });

  it('halts after max iterations', async () => {
    const client = fakeClient([
      [{ type: 'tool_call', toolCall: { id: 't', name: 'nope', arguments: {} } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'tool_call', toolCall: { id: 't', name: 'nope', arguments: {} } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'tool_call', toolCall: { id: 't', name: 'nope', arguments: {} } }, { type: 'done', finishReason: 'tool_calls' }]
    ]);
    await expect(
      runAgentLoop({
        client, tools: new ToolRegistry(), providerId: 't', apiKey: 'k',
        initialMessages: [{ id: 'u', role: 'user', content: 'go', createdAt: '' }],
        maxIterations: 2
      })
    ).rejects.toThrow(/max iterations/i);
  });
});
