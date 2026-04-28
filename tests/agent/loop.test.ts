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

  it('halts after max iterations with a soft cap message instead of throwing', async () => {
    // Iteration cap is a soft signal — the loop appends a synthetic assistant
    // message ("回复继续我接着干完") and returns normally. Throwing would
    // surface a red error in the chat and lose the user's progress.
    const client = fakeClient([
      [{ type: 'tool_call', toolCall: { id: 't', name: 'nope', arguments: {} } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'tool_call', toolCall: { id: 't', name: 'nope', arguments: {} } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'tool_call', toolCall: { id: 't', name: 'nope', arguments: {} } }, { type: 'done', finishReason: 'tool_calls' }]
    ]);
    const result = await runAgentLoop({
      client, tools: new ToolRegistry(), providerId: 't', apiKey: 'k',
      initialMessages: [{ id: 'u', role: 'user', content: 'go', createdAt: '' }],
      maxIterations: 2
    });
    const last = result[result.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toMatch(/已运行 2 轮/);
    expect(last.content).toMatch(/继续/);
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

describe('runAgentLoop trace (Plan 5.13)', () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'opendeploy-loop-trace-'));
    prevHome = process.env.OPENDEPLOY_HOME;
    process.env.OPENDEPLOY_HOME = tmp;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENDEPLOY_HOME;
    else process.env.OPENDEPLOY_HOME = prevHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  function tracePath(): string {
    const ymd = new Date().toISOString().slice(0, 10);
    return join(tmp, 'logs', `agent-trace.${ymd}.log`);
  }

  it('writes one JSON line per turn with usage + finish reason + elapsed', async () => {
    const client = fakeClient([[
      { type: 'delta', content: 'hi' },
      { type: 'usage', outputTokens: 42 },
      { type: 'done', finishReason: 'stop' }
    ]]);
    await runAgentLoop({
      client,
      tools: new ToolRegistry(),
      initialMessages: [{ id: 'u', role: 'user', content: 'hi', createdAt: '' }],
      providerId: 'deepseek',
      model: 'deepseek-v4',
      conversationId: 'c-test-1',
      apiKey: 'k'
    });
    await new Promise((r) => setTimeout(r, 50));
    const lines = readFileSync(tracePath(), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.ns).toBe('agent-loop');
    expect(rec.conversationId).toBe('c-test-1');
    expect(rec.iteration).toBe(0);
    expect(rec.providerId).toBe('deepseek');
    expect(rec.model).toBe('deepseek-v4');
    expect(rec.outputTokens).toBe(42);
    expect(rec.finishReason).toBe('stop');
    expect(rec.errored).toBe(false);
    expect(typeof rec.llmElapsedMs).toBe('number');
    expect(typeof rec.totalElapsedMs).toBe('number');
    expect(rec.toolCalls).toEqual([]);
  });

  it('records each tool call with name + duration + ok flag + parallelSafe', async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'echo_safe',
        description: '',
        parameters: { type: 'object', properties: {} }
      },
      parallelSafe: true,
      async execute() { return 'ok-1'; }
    });
    registry.register({
      definition: {
        name: 'echo_unsafe',
        description: '',
        parameters: { type: 'object', properties: {} }
      },
      async execute() { return 'ok-2'; }
    });

    const client = fakeClient([
      [
        { type: 'tool_call', toolCall: { id: 't1', name: 'echo_safe', arguments: {} } },
        { type: 'tool_call', toolCall: { id: 't2', name: 'echo_unsafe', arguments: {} } },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'delta', content: 'done' },
        { type: 'done', finishReason: 'stop' }
      ]
    ]);
    await runAgentLoop({
      client, tools: registry, providerId: 'test', apiKey: 'k',
      conversationId: 'c-tools',
      initialMessages: [{ id: 'u', role: 'user', content: 'go', createdAt: '' }]
    });
    await new Promise((r) => setTimeout(r, 50));
    const lines = readFileSync(tracePath(), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2); // turn 0 (tool calls) + turn 1 (final)
    const turn0 = JSON.parse(lines[0]);
    expect(turn0.iteration).toBe(0);
    expect(turn0.toolCalls).toHaveLength(2);
    expect(turn0.toolCalls[0].name).toBe('echo_safe');
    expect(turn0.toolCalls[0].ok).toBe(true);
    expect(turn0.toolCalls[0].parallelSafe).toBe(true);
    expect(turn0.toolCalls[1].name).toBe('echo_unsafe');
    expect(turn0.toolCalls[1].parallelSafe).toBe(false);
    expect(typeof turn0.toolCalls[0].durationMs).toBe('number');

    const turn1 = JSON.parse(lines[1]);
    expect(turn1.iteration).toBe(1);
    expect(turn1.toolCalls).toEqual([]);
  });

  it('passes per-turn rawCapture into client.stream when factory provided', async () => {
    const captures: Array<{ turn: number; gotRequest: boolean; gotChunkCount: number; closed: boolean }> = [];
    const factory = (turn: number) => {
      const rec = { turn, gotRequest: false, gotChunkCount: 0, closed: false };
      captures.push(rec);
      return {
        onRequest() { rec.gotRequest = true; },
        onChunk() { rec.gotChunkCount++; },
        async onClose() { rec.closed = true; }
      };
    };

    // Custom client that exercises the rawCapture argument so we don't depend
    // on real openai-client wiring here — the per-client integration is covered
    // by tests/llm/openai-client.test.ts etc.
    const client = {
      async *stream(_req: unknown, opts: { rawCapture?: { onRequest: Function; onChunk: Function; onClose: () => Promise<void> } }) {
        opts.rawCapture?.onRequest({ body: 'fake' }, { Authorization: 'sk' });
        opts.rawCapture?.onChunk('chunk-1');
        opts.rawCapture?.onChunk('chunk-2');
        yield { type: 'delta', content: 'hi' } as const;
        yield { type: 'done', finishReason: 'stop' } as const;
        await opts.rawCapture?.onClose();
      }
    } as unknown as import('../../src/main/llm/types').LlmClient;

    await runAgentLoop({
      client,
      tools: new ToolRegistry(),
      initialMessages: [{ id: 'u', role: 'user', content: 'hi', createdAt: '' }],
      providerId: 'test',
      apiKey: 'k',
      conversationId: 'c-raw',
      rawCaptureFactory: factory
    });

    expect(captures).toHaveLength(1);
    expect(captures[0].turn).toBe(0);
    expect(captures[0].gotRequest).toBe(true);
    expect(captures[0].gotChunkCount).toBe(2);
    expect(captures[0].closed).toBe(true);
  });

  it('records errored=true + errorMessage when LLM stream errors', async () => {
    const client = fakeClient([[
      { type: 'error', error: 'HTTP 500: oops' }
    ]]);
    await runAgentLoop({
      client,
      tools: new ToolRegistry(),
      initialMessages: [{ id: 'u', role: 'user', content: 'hi', createdAt: '' }],
      providerId: 'test',
      apiKey: 'k',
      conversationId: 'c-err'
    });
    await new Promise((r) => setTimeout(r, 50));
    const lines = readFileSync(tracePath(), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.errored).toBe(true);
    expect(rec.errorMessage).toContain('HTTP 500');
  });
});
