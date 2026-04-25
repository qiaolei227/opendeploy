import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('parallelSafe tool batch runs concurrently', async () => {
    const registry = new ToolRegistry();
    let inFlight = 0;
    let maxInFlight = 0;
    const make = (name: string): Parameters<ToolRegistry['register']>[0] => ({
      parallelSafe: true,
      definition: { name, description: '', parameters: { type: 'object', properties: {} } },
      async execute() {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
        return `ok:${name}`;
      }
    });
    registry.register(make('a'));
    registry.register(make('b'));
    registry.register(make('c'));

    const client = fakeClient([
      [
        { type: 'tool_call', toolCall: { id: 't1', name: 'a', arguments: {} } },
        { type: 'tool_call', toolCall: { id: 't2', name: 'b', arguments: {} } },
        { type: 'tool_call', toolCall: { id: 't3', name: 'c', arguments: {} } },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [{ type: 'delta', content: 'done' }, { type: 'done', finishReason: 'stop' }]
    ]);

    const finalMessages = await runAgentLoop({
      client, tools: registry, providerId: 't', apiKey: 'k',
      initialMessages: [{ id: 'u', role: 'user', content: 'go', createdAt: '' }]
    });

    expect(maxInFlight).toBe(3);
    const toolMsgs = finalMessages.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.toolCallId)).toEqual(['t1', 't2', 't3']);
    expect(toolMsgs.map((m) => m.content)).toEqual(['ok:a', 'ok:b', 'ok:c']);
  });

  it('mixed-safety batch falls back to serial', async () => {
    const registry = new ToolRegistry();
    let inFlight = 0;
    let maxInFlight = 0;
    const make = (name: string, safe: boolean): Parameters<ToolRegistry['register']>[0] => ({
      parallelSafe: safe,
      definition: { name, description: '', parameters: { type: 'object', properties: {} } },
      async execute() {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return `ok:${name}`;
      }
    });
    registry.register(make('reader', true));
    registry.register(make('writer', false));

    const client = fakeClient([
      [
        { type: 'tool_call', toolCall: { id: 't1', name: 'reader', arguments: {} } },
        { type: 'tool_call', toolCall: { id: 't2', name: 'writer', arguments: {} } },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [{ type: 'delta', content: 'done' }, { type: 'done', finishReason: 'stop' }]
    ]);

    await runAgentLoop({
      client, tools: registry, providerId: 't', apiKey: 'k',
      initialMessages: [{ id: 'u', role: 'user', content: 'go', createdAt: '' }]
    });

    expect(maxInFlight).toBe(1);
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

  it('accumulates reasoning_delta into assistant message.reasoningContent and emits events', async () => {
    const client = fakeClient([[
      { type: 'reasoning_delta', content: '用户要加字段,' },
      { type: 'reasoning_delta', content: '先列扩展。' },
      { type: 'delta', content: '先看看扩展' },
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
    const assistant = finalMessages[finalMessages.length - 1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.reasoningContent).toBe('用户要加字段,先列扩展。');
    expect(assistant.content).toBe('先看看扩展');
    const reasoningEvents = events.filter((e) => e.type === 'reasoning_delta');
    expect(reasoningEvents).toHaveLength(2);
  });

  it('captures reasoning_signature into assistant message.reasoningSignature', async () => {
    const client = fakeClient([[
      { type: 'reasoning_delta', content: 'thinking...' },
      { type: 'reasoning_signature', signature: 'sig-xyz' },
      { type: 'delta', content: 'done' },
      { type: 'done', finishReason: 'stop' }
    ]]);
    const finalMessages = await runAgentLoop({
      client,
      tools: new ToolRegistry(),
      initialMessages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: '' }],
      providerId: 'test',
      apiKey: 'k'
    });
    const assistant = finalMessages[finalMessages.length - 1];
    expect(assistant.reasoningContent).toBe('thinking...');
    expect(assistant.reasoningSignature).toBe('sig-xyz');
  });
});

describe('runAgentLoop error logging', () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'opendeploy-loop-log-'));
    prevHome = process.env.OPENDEPLOY_HOME;
    process.env.OPENDEPLOY_HOME = tmp;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENDEPLOY_HOME;
    else process.env.OPENDEPLOY_HOME = prevHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes stream errors to app.log with provider + iteration + full error body', async () => {
    const client = fakeClient([[
      {
        type: 'error',
        error: 'HTTP 400: {"error":{"message":"The `reasoning_content` in the thinking mode must be passed back to the API."}}'
      }
    ]]);
    await runAgentLoop({
      client,
      tools: new ToolRegistry(),
      initialMessages: [
        { id: 'u', role: 'user', content: 'add a field', createdAt: '' }
      ],
      providerId: 'deepseek',
      apiKey: 'k'
    });
    // tiny grace window for the async append — logger.error resolves but the
    // assertion runs right after; in practice the write lands before the next
    // microtask but we play safe.
    await new Promise((r) => setTimeout(r, 50));
    const logPath = join(tmp, 'logs', 'app.log');
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toMatch(/ERROR/);
    expect(content).toMatch(/agent-loop/);
    expect(content).toMatch(/deepseek/);
    expect(content).toMatch(/iteration 0/);
    expect(content).toMatch(/HTTP 400/);
    expect(content).toMatch(/reasoning_content/);
  });

  it('does not write anything to app.log for successful runs', async () => {
    const client = fakeClient([[
      { type: 'delta', content: 'ok' },
      { type: 'done', finishReason: 'stop' }
    ]]);
    await runAgentLoop({
      client,
      tools: new ToolRegistry(),
      initialMessages: [{ id: 'u', role: 'user', content: 'hi', createdAt: '' }],
      providerId: 'test',
      apiKey: 'k'
    });
    await new Promise((r) => setTimeout(r, 50));
    const logPath = join(tmp, 'logs', 'app.log');
    let exists = true;
    try {
      readFileSync(logPath, 'utf-8');
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
