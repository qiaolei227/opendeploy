# OpenDeploy · Plan 2: LLM Integration & Agent Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Plan 1 的 UI 壳子真正能对话 —— 实现 LLM provider 抽象层（支持 DeepSeek/Claude/Ollama）+ Agent Loop（含工具调用框架）+ 真实的流式聊天 UI。

**Architecture:** LLM 客户端运行在 Electron main 进程（API Key 不暴露给 renderer），通过 IPC 与 renderer 通信；流式响应通过 IPC events 推送；OpenAI 兼容格式作为统一基准（覆盖 DeepSeek/Qwen/GLM 等 9 个国内provider），Anthropic 和 Ollama 各自独立客户端；Tool 框架先定义接口 + 一个 sample tool，真正的业务工具留给 Plan 3/4。

**Tech Stack:** TypeScript, node-fetch (内置 fetch), `eventsource-parser`（SSE 解析）, `react-markdown` + `shiki`/`highlight.js`（代码高亮），Zustand（chat state）, Vitest + MSW（HTTP mock）。

**Project Root:** `D:\Project\opendeploy\`

---

## Plan 2 完成后能做什么

- 顾问在 Composer 输入消息，点发送
- 消息走 IPC → main 进程 → 调用选定的 LLM provider
- LLM 流式返回文本，通过 IPC events 逐字推送到 renderer
- renderer 实时渲染，支持 Markdown + 代码高亮
- 多轮对话：历史消息自动带入下一次请求
- Agent 能调用工具（示例：`get_current_datetime`），展示工具调用UI
- 对话持久化到 `%USERPROFILE%/.opendeploy/conversations/*.md`，重启后可恢复
- 支持 3 个 provider 完整测试：DeepSeek（国内主力）、Claude（海外旗舰）、Ollama（本地）

---

## 文件结构规划

```
src/
├── shared/
│   └── llm-types.ts              # Message, Tool, LlmClient 共享类型
├── main/
│   ├── llm/
│   │   ├── types.ts              # 内部 LLM 客户端接口
│   │   ├── openai-client.ts      # OpenAI 兼容格式（DeepSeek/Qwen/GLM/GPT 通用）
│   │   ├── anthropic-client.ts   # Claude
│   │   ├── ollama-client.ts      # 本地
│   │   ├── factory.ts            # create client by provider id
│   │   └── sse.ts                # SSE 流解析工具
│   ├── agent/
│   │   ├── loop.ts               # Agent Loop 核心
│   │   ├── tools.ts              # Tool 注册表 + 执行器
│   │   └── builtin-tools.ts      # get_current_datetime sample
│   ├── conversations/
│   │   └── store.ts              # 对话持久化（Markdown 文件）
│   └── ipc-llm.ts                # LLM 相关 IPC handlers
├── preload/
│   └── index.ts                  # 暴露 LLM 方法到 renderer
├── renderer/
│   ├── stores/
│   │   └── chat-store.ts         # Zustand chat state
│   ├── components/
│   │   ├── Message.tsx           # 单条消息渲染
│   │   ├── MessageList.tsx       # 消息列表 + 自动滚动
│   │   ├── MarkdownBlock.tsx     # Markdown + 代码高亮
│   │   ├── ToolCall.tsx          # 工具调用 UI
│   │   └── Composer.tsx          # （修改）接线到 chat-store
│   └── pages/
│       └── WorkspacePage.tsx     # （修改）非空态显示 MessageList
└── tests/
    ├── llm/
    │   ├── openai-client.test.ts
    │   ├── anthropic-client.test.ts
    │   └── sse.test.ts
    ├── agent/
    │   └── loop.test.ts
    └── conversations/
        └── store.test.ts
```

---

## Task 1: 共享 LLM 类型定义

**Files:**
- Create: `src/shared/llm-types.ts`

- [ ] **Step 1: 创建 `src/shared/llm-types.ts`**

```typescript
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  role: Role;
  content: string;
  toolCallId?: string;         // set when role === 'tool'
  toolCalls?: ToolCall[];      // set on assistant messages that invoke tools
  createdAt: string;           // ISO timestamp
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;             // stringified output
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
}

export interface ChatRequest {
  providerId: string;
  apiKey?: string;
  model?: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; finishReason: 'stop' | 'tool_calls' | 'length' | 'error'; usage?: TokenUsage }
  | { type: 'error'; error: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
```

- [ ] **Step 2: 验证 typecheck**

```bash
cd D:/Project/opendeploy
pnpm typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/llm-types.ts
git commit -m "feat(shared): define LLM types (Message, Tool, StreamEvent)"
```

---

## Task 2: SSE 流解析工具

**Files:**
- Create: `src/main/llm/sse.ts`
- Create: `tests/llm/sse.test.ts`

- [ ] **Step 1: 安装 eventsource-parser**

```bash
cd D:/Project/opendeploy
pnpm add eventsource-parser
```

- [ ] **Step 2: 写失败测试 `tests/llm/sse.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../../src/main/llm/sse';

async function* chunkStream(chunks: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for (const c of chunks) yield encoder.encode(c);
}

describe('parseSseStream', () => {
  it('parses single SSE event', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream(['data: {"text":"hi"}\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"text":"hi"}']);
  });

  it('handles split events across chunks', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream(['data: {"te', 'xt":"ok"}\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"text":"ok"}']);
  });

  it('ignores [DONE] sentinel', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream(['data: {"a":1}\n\ndata: [DONE]\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"a":1}']);
  });

  it('skips non-data SSE lines', async () => {
    const events: string[] = [];
    for await (const e of parseSseStream(chunkStream([': keep-alive\n\ndata: {"ok":true}\n\n']))) {
      events.push(e);
    }
    expect(events).toEqual(['{"ok":true}']);
  });
});
```

- [ ] **Step 3: Verify failing**

```bash
pnpm test tests/llm/sse.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: 实现 `src/main/llm/sse.ts`**

```typescript
import { createParser, type EventSourceMessage } from 'eventsource-parser';

export async function* parseSseStream(
  stream: AsyncIterable<Uint8Array>
): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8');
  const events: string[] = [];
  const parser = createParser({
    onEvent(ev: EventSourceMessage) {
      if (!ev.data || ev.data === '[DONE]') return;
      events.push(ev.data);
    }
  });
  for await (const chunk of stream) {
    parser.feed(decoder.decode(chunk, { stream: true }));
    while (events.length > 0) {
      yield events.shift()!;
    }
  }
}
```

- [ ] **Step 5: Verify passing**

```bash
pnpm test tests/llm/sse.test.ts
```
Expected: 4/4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/llm/sse.ts tests/llm/sse.test.ts package.json pnpm-lock.yaml
git commit -m "feat(llm): add SSE stream parser for streaming responses"
```

---

## Task 3: LLM 客户端内部接口

**Files:**
- Create: `src/main/llm/types.ts`

- [ ] **Step 1: 创建 `src/main/llm/types.ts`**

```typescript
import type { ChatRequest, StreamEvent } from '@shared/llm-types';

export interface LlmClient {
  /**
   * Stream a chat completion. Caller iterates the returned AsyncIterable
   * to receive deltas, tool calls, and the final done event.
   * Throws if request preparation fails (before streaming starts).
   */
  stream(request: ChatRequest, abortSignal?: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface ProviderConfig {
  id: string;                    // e.g., 'deepseek', 'claude', 'ollama'
  baseUrl: string;
  defaultModel: string;
  /** OpenAI-compatible endpoint format vs Anthropic vs Ollama */
  format: 'openai' | 'anthropic' | 'ollama';
}

/** Map provider id → config. Each entry used by factory to build correct client. */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  deepseek: { id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', format: 'openai' },
  qwen:     { id: 'qwen',     baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max', format: 'openai' },
  glm:      { id: 'glm',      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4', format: 'openai' },
  kimi:     { id: 'kimi',     baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', format: 'openai' },
  doubao:   { id: 'doubao',   baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-pro-32k', format: 'openai' },
  hunyuan:  { id: 'hunyuan',  baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-standard', format: 'openai' },
  minimax:  { id: 'minimax',  baseUrl: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5-chat', format: 'openai' },
  baichuan: { id: 'baichuan', baseUrl: 'https://api.baichuan-ai.com/v1', defaultModel: 'Baichuan4-Turbo', format: 'openai' },
  gpt:      { id: 'gpt',      baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', format: 'openai' },
  claude:   { id: 'claude',   baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514', format: 'anthropic' },
  ollama:   { id: 'ollama',   baseUrl: 'http://localhost:11434', defaultModel: 'qwen2.5-coder', format: 'ollama' }
};
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/llm/types.ts
git commit -m "feat(llm): define LlmClient interface and provider configs"
```

---

## Task 4: OpenAI 兼容客户端

**Files:**
- Create: `src/main/llm/openai-client.ts`
- Create: `tests/llm/openai-client.test.ts`

- [ ] **Step 1: 写失败测试 `tests/llm/openai-client.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOpenAiClient } from '../../src/main/llm/openai-client';
import type { ChatRequest } from '../../src/shared/llm-types';

// Minimal fetch mock returning streaming SSE
function mockFetchStream(chunks: string[]) {
  return vi.fn(async (_url: string, _init: RequestInit) => {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i++]));
        } else {
          controller.close();
        }
      }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('OpenAI-compatible client', () => {
  it('streams text deltas', async () => {
    const fetch = mockFetchStream([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n'
    ]);
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const req: ChatRequest = {
      providerId: 'test', apiKey: 'sk-test',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    };
    const events: unknown[] = [];
    for await (const e of client.stream(req)) events.push(e);

    expect(events).toEqual([
      { type: 'delta', content: 'Hello ' },
      { type: 'delta', content: 'world' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }
    ]);
  });

  it('emits tool_call event', async () => {
    const fetch = mockFetchStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_time","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ]);
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const req: ChatRequest = {
      providerId: 'test', apiKey: 'sk',
      messages: [{ id: '1', role: 'user', content: 'what time', createdAt: '' }]
    };
    const events: unknown[] = [];
    for await (const e of client.stream(req)) events.push(e);

    expect(events[0]).toEqual({
      type: 'tool_call',
      toolCall: { id: 'c1', name: 'get_time', arguments: {} }
    });
  });

  it('emits error event on non-200 response', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const client = createOpenAiClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({ providerId: 't', apiKey: 'bad', messages: [] })) events.push(e);
    expect(events[0]).toMatchObject({ type: 'error' });
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
pnpm test tests/llm/openai-client.test.ts
```
Expected: FAIL.

- [ ] **Step 3: 实现 `src/main/llm/openai-client.ts`**

```typescript
import type { ChatRequest, StreamEvent, ToolCall } from '@shared/llm-types';
import type { LlmClient } from './types';
import { parseSseStream } from './sse';

interface OpenAiClientOpts {
  baseUrl: string;
  defaultModel: string;
  /** Override for tests */
  fetchImpl?: typeof fetch;
}

export function createOpenAiClient(opts: OpenAiClientOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
      const body = {
        model: req.model ?? opts.defaultModel,
        messages: req.messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
          }
          const base: Record<string, unknown> = { role: m.role, content: m.content };
          if (m.toolCalls && m.toolCalls.length > 0) {
            base.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
            }));
          }
          return base;
        }),
        stream: true,
        ...(req.tools && req.tools.length > 0 ? {
          tools: req.tools.map((t) => ({ type: 'function', function: t }))
        } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})
      };

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${req.apiKey ?? ''}`
          },
          body: JSON.stringify(body),
          signal
        });
      } catch (err) {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      if (!response.ok) {
        const text = await response.text();
        yield { type: 'error', error: `HTTP ${response.status}: ${text}` };
        return;
      }
      if (!response.body) {
        yield { type: 'error', error: 'Response has no body' };
        return;
      }

      // Accumulate tool call fragments across deltas
      const toolCallAcc = new Map<number, { id: string; name: string; argsText: string }>();

      const reader = response.body.getReader();
      const stream: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield value;
          }
        }
      };

      for await (const dataStr of parseSseStream(stream)) {
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        const choice = data.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { type: 'delta', content: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallAcc.get(idx) ?? { id: '', name: '', argsText: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.argsText += tc.function.arguments;
            toolCallAcc.set(idx, existing);
          }
        }

        if (choice.finish_reason) {
          // Emit any accumulated tool calls
          for (const acc of toolCallAcc.values()) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(acc.argsText || '{}'); } catch { args = {}; }
            const toolCall: ToolCall = { id: acc.id, name: acc.name, arguments: args };
            yield { type: 'tool_call', toolCall };
          }
          const finishReason = (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls' || choice.finish_reason === 'length')
            ? choice.finish_reason : 'stop';
          const usage = data.usage ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0
          } : undefined;
          yield { type: 'done', finishReason, usage };
          return;
        }
      }
    }
  };
}
```

- [ ] **Step 4: Verify passing**

```bash
pnpm test tests/llm/openai-client.test.ts
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/llm/openai-client.ts tests/llm/openai-client.test.ts
git commit -m "feat(llm): implement OpenAI-compatible streaming client (covers 9 providers)"
```

---

## Task 5: Anthropic Claude 客户端

**Files:**
- Create: `src/main/llm/anthropic-client.ts`
- Create: `tests/llm/anthropic-client.test.ts`

- [ ] **Step 1: 写失败测试 `tests/llm/anthropic-client.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnthropicClient } from '../../src/main/llm/anthropic-client';

function mockFetchStream(chunks: string[]) {
  return vi.fn(async () => {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
        else controller.close();
      }
    });
    return new Response(stream, { status: 200 });
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('Anthropic client', () => {
  it('streams text deltas from content_block_delta events', async () => {
    const fetch = mockFetchStream([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n',
      'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);
    const client = createAnthropicClient({ baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({
      providerId: 'claude', apiKey: 'sk-ant',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: '' }]
    })) events.push(e);

    expect(events.slice(0, 2)).toEqual([
      { type: 'delta', content: 'Hi' },
      { type: 'delta', content: ' there' }
    ]);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('emits error on non-200', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"invalid"}}', { status: 400 }));
    const client = createAnthropicClient({ baseUrl: 'https://x', defaultModel: 'm', fetchImpl: fetch });
    const events: unknown[] = [];
    for await (const e of client.stream({ providerId: 'claude', apiKey: 'bad', messages: [] })) events.push(e);
    expect(events[0]).toMatchObject({ type: 'error' });
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
pnpm test tests/llm/anthropic-client.test.ts
```

- [ ] **Step 3: 实现 `src/main/llm/anthropic-client.ts`**

```typescript
import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { LlmClient } from './types';
import { parseSseStream } from './sse';

interface AnthropicOpts {
  baseUrl: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

export function createAnthropicClient(opts: AnthropicOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
      // Split out system messages (Anthropic takes them separately)
      const systemParts = req.messages.filter(m => m.role === 'system').map(m => m.content);
      const conversation = req.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : m.role === 'tool' ? 'user' : 'user',
        content: m.role === 'tool'
          ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
          : m.content
      }));

      const body = {
        model: req.model ?? opts.defaultModel,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
        messages: conversation,
        ...(req.tools && req.tools.length > 0 ? {
          tools: req.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters
          }))
        } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
      };

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': req.apiKey ?? '',
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body),
          signal
        });
      } catch (err) {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      if (!response.ok) {
        const text = await response.text();
        yield { type: 'error', error: `HTTP ${response.status}: ${text}` };
        return;
      }
      if (!response.body) { yield { type: 'error', error: 'no body' }; return; }

      const reader = response.body.getReader();
      const stream: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield value;
          }
        }
      };

      let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const dataStr of parseSseStream(stream)) {
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          yield { type: 'delta', content: data.delta.text ?? '' };
        } else if (data.type === 'message_delta') {
          const sr = data.delta?.stop_reason;
          if (sr === 'tool_use') finishReason = 'tool_calls';
          else if (sr === 'max_tokens') finishReason = 'length';
          else finishReason = 'stop';
          if (data.usage?.output_tokens) outputTokens = data.usage.output_tokens;
        } else if (data.type === 'message_start') {
          inputTokens = data.message?.usage?.input_tokens ?? 0;
        } else if (data.type === 'message_stop') {
          yield {
            type: 'done',
            finishReason,
            usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
          };
          return;
        }
      }
    }
  };
}
```

- [ ] **Step 4: Verify passing**

```bash
pnpm test tests/llm/anthropic-client.test.ts
```
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/llm/anthropic-client.ts tests/llm/anthropic-client.test.ts
git commit -m "feat(llm): implement Anthropic Claude streaming client"
```

---

## Task 6: Ollama 本地客户端

**Files:**
- Create: `src/main/llm/ollama-client.ts`

- [ ] **Step 1: 创建 `src/main/llm/ollama-client.ts`**

```typescript
import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { LlmClient } from './types';

interface OllamaOpts {
  baseUrl: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

export function createOllamaClient(opts: OllamaOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
      const body = {
        model: req.model ?? opts.defaultModel,
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        options: req.temperature !== undefined ? { temperature: req.temperature } : {}
      };

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal
        });
      } catch (err) {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      if (!response.ok) {
        yield { type: 'error', error: `HTTP ${response.status}: ${await response.text()}` };
        return;
      }
      if (!response.body) { yield { type: 'error', error: 'no body' }; return; }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Ollama sends newline-delimited JSON
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let obj: any;
          try { obj = JSON.parse(line); } catch { continue; }

          if (obj.message?.content) {
            yield { type: 'delta', content: obj.message.content };
          }
          if (obj.done) {
            yield {
              type: 'done',
              finishReason: 'stop',
              usage: {
                inputTokens: obj.prompt_eval_count ?? 0,
                outputTokens: obj.eval_count ?? 0,
                totalTokens: (obj.prompt_eval_count ?? 0) + (obj.eval_count ?? 0)
              }
            };
            return;
          }
        }
      }
    }
  };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/main/llm/ollama-client.ts
git commit -m "feat(llm): implement Ollama local client (NDJSON streaming)"
```

---

## Task 7: Client Factory

**Files:**
- Create: `src/main/llm/factory.ts`

- [ ] **Step 1: 创建 `src/main/llm/factory.ts`**

```typescript
import type { LlmClient } from './types';
import { PROVIDER_CONFIGS } from './types';
import { createOpenAiClient } from './openai-client';
import { createAnthropicClient } from './anthropic-client';
import { createOllamaClient } from './ollama-client';

export function createLlmClient(providerId: string): LlmClient {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) throw new Error(`Unknown provider: ${providerId}`);

  switch (cfg.format) {
    case 'openai':
      return createOpenAiClient({ baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel });
    case 'anthropic':
      return createAnthropicClient({ baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel });
    case 'ollama':
      return createOllamaClient({ baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel });
  }
}
```

- [ ] **Step 2: Verify typecheck + existing tests still pass**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add src/main/llm/factory.ts
git commit -m "feat(llm): add provider factory"
```

---

## Task 8: Tool Framework

**Files:**
- Create: `src/main/agent/tools.ts`
- Create: `src/main/agent/builtin-tools.ts`

- [ ] **Step 1: 创建 `src/main/agent/tools.ts`**

```typescript
import type { ToolDefinition, ToolResult } from '@shared/llm-types';

export interface ToolHandler {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    if (this.tools.has(handler.definition.name)) {
      throw new Error(`Tool already registered: ${handler.definition.name}`);
    }
    this.tools.set(handler.definition.name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(h => h.definition);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const handler = this.tools.get(name);
    if (!handler) {
      return { toolCallId: '', content: `Unknown tool: ${name}`, isError: true };
    }
    try {
      const output = await handler.execute(args);
      return { toolCallId: '', content: output, isError: false };
    } catch (err) {
      return {
        toolCallId: '',
        content: err instanceof Error ? err.message : String(err),
        isError: true
      };
    }
  }
}
```

- [ ] **Step 2: 创建 `src/main/agent/builtin-tools.ts`**

```typescript
import type { ToolHandler } from './tools';

export const getCurrentDateTime: ToolHandler = {
  definition: {
    name: 'get_current_datetime',
    description: 'Get the current date and time in ISO 8601 format. Use when the user asks about the current time or date.',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone name (e.g., "Asia/Shanghai"). Default: system timezone.'
        }
      }
    }
  },
  async execute(args): Promise<string> {
    const tz = typeof args.timezone === 'string' ? args.timezone : undefined;
    const now = new Date();
    if (tz) {
      try {
        return now.toLocaleString('zh-CN', { timeZone: tz, hour12: false });
      } catch {
        return now.toISOString();
      }
    }
    return now.toISOString();
  }
};

export const BUILTIN_TOOLS: ToolHandler[] = [getCurrentDateTime];
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/
git commit -m "feat(agent): add Tool framework and get_current_datetime sample tool"
```

---

## Task 9: Agent Loop

**Files:**
- Create: `src/main/agent/loop.ts`
- Create: `tests/agent/loop.test.ts`

- [ ] **Step 1: 写失败测试 `tests/agent/loop.test.ts`**

```typescript
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
```

- [ ] **Step 2: Verify failing**

```bash
pnpm test tests/agent/loop.test.ts
```

- [ ] **Step 3: 实现 `src/main/agent/loop.ts`**

```typescript
import type { Message, ToolCall } from '@shared/llm-types';
import type { LlmClient } from '../llm/types';
import type { ToolRegistry } from './tools';

export type AgentLoopEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; content: string; isError: boolean }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'done' };

interface RunAgentLoopParams {
  client: LlmClient;
  tools: ToolRegistry;
  initialMessages: Message[];
  providerId: string;
  apiKey?: string;
  model?: string;
  onEvent?: (e: AgentLoopEvent) => void;
  maxIterations?: number;
  signal?: AbortSignal;
}

function makeId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAgentLoop(params: RunAgentLoopParams): Promise<Message[]> {
  const maxIter = params.maxIterations ?? 10;
  const messages: Message[] = [...params.initialMessages];
  const emit = params.onEvent ?? (() => {});
  const toolDefs = params.tools.definitions();

  for (let iter = 0; iter < maxIter; iter++) {
    emit({ type: 'iteration_start', iteration: iter });

    let assistantContent = '';
    const toolCalls: ToolCall[] = [];
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    let errored = false;

    for await (const ev of params.client.stream({
      providerId: params.providerId,
      apiKey: params.apiKey,
      model: params.model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined
    }, params.signal)) {
      if (ev.type === 'delta') {
        assistantContent += ev.content;
        emit({ type: 'delta', content: ev.content });
      } else if (ev.type === 'tool_call') {
        toolCalls.push(ev.toolCall);
        emit({ type: 'tool_call', toolCall: ev.toolCall });
      } else if (ev.type === 'done') {
        finishReason = ev.finishReason;
      } else if (ev.type === 'error') {
        errored = true;
        assistantContent = ev.error;
        break;
      }
    }

    const assistantMsg: Message = {
      id: makeId(),
      role: 'assistant',
      content: assistantContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: new Date().toISOString()
    };
    messages.push(assistantMsg);

    if (errored || finishReason !== 'tool_calls' || toolCalls.length === 0) {
      emit({ type: 'done' });
      return messages;
    }

    // Execute tools, append tool result messages, loop again
    for (const tc of toolCalls) {
      const result = await params.tools.execute(tc.name, tc.arguments);
      const resultWithId = { ...result, toolCallId: tc.id };
      emit({
        type: 'tool_result',
        toolCallId: tc.id,
        content: resultWithId.content,
        isError: resultWithId.isError ?? false
      });
      messages.push({
        id: makeId(),
        role: 'tool',
        content: resultWithId.content,
        toolCallId: tc.id,
        createdAt: new Date().toISOString()
      });
    }
  }

  throw new Error(`Agent loop exceeded max iterations (${maxIter})`);
}
```

- [ ] **Step 4: Verify passing**

```bash
pnpm test tests/agent/loop.test.ts
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/loop.ts tests/agent/loop.test.ts
git commit -m "feat(agent): implement multi-turn Agent Loop with tool calling"
```

---

## Task 10: 对话持久化

**Files:**
- Create: `src/main/conversations/store.ts`
- Create: `tests/conversations/store.test.ts`

- [ ] **Step 1: 写失败测试 `tests/conversations/store.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveConversation, loadConversation, listConversations, getConversationsDir } from '../../src/main/conversations/store';
import type { Message } from '../../src/shared/llm-types';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'opendeploy-conv-'));
  process.env.OPENDEPLOY_HOME = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
});

describe('conversation store', () => {
  it('saves and loads a conversation', async () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: 'hello', createdAt: '2026-04-20T10:00:00Z' },
      { id: 'a1', role: 'assistant', content: 'hi there', createdAt: '2026-04-20T10:00:02Z' }
    ];
    const id = await saveConversation({ title: 'test chat', messages: msgs });
    const loaded = await loadConversation(id);
    expect(loaded.title).toBe('test chat');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe('hello');
  });

  it('lists saved conversations with titles and timestamps', async () => {
    await saveConversation({ title: 'first', messages: [] });
    await new Promise(r => setTimeout(r, 5));
    await saveConversation({ title: 'second', messages: [] });
    const list = await listConversations();
    expect(list).toHaveLength(2);
    expect(list.map(c => c.title).sort()).toEqual(['first', 'second']);
  });

  it('creates directory on first save', async () => {
    const id = await saveConversation({ title: 'x', messages: [] });
    expect(id).toBeTruthy();
    expect(getConversationsDir()).toContain(testDir);
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
pnpm test tests/conversations/store.test.ts
```

- [ ] **Step 3: 实现 `src/main/conversations/store.ts`**

```typescript
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Message } from '@shared/llm-types';

export interface ConversationSummary {
  id: string;
  title: string;
  savedAt: string;
  messageCount: number;
}

export interface Conversation {
  id: string;
  title: string;
  savedAt: string;
  messages: Message[];
}

export function getConversationsDir(): string {
  const home = process.env.OPENDEPLOY_HOME ?? join(homedir(), '.opendeploy');
  return join(home, 'conversations');
}

function sanitizeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60);
}

function formatMessage(m: Message): string {
  const body = [`### [${m.createdAt}] ${m.role}`, '', m.content];
  if (m.toolCallId) body.splice(2, 0, `_(tool_call_id: ${m.toolCallId})_`, '');
  if (m.toolCalls && m.toolCalls.length > 0) {
    body.push('', '```tool-calls', JSON.stringify(m.toolCalls, null, 2), '```');
  }
  return body.join('\n');
}

function parseConversation(content: string): Conversation {
  const lines = content.split('\n');
  const frontmatter: Record<string, string> = {};
  let idx = 0;
  if (lines[0] === '---') {
    idx = 1;
    while (idx < lines.length && lines[idx] !== '---') {
      const match = lines[idx].match(/^(\w+):\s*(.*)$/);
      if (match) frontmatter[match[1]] = match[2];
      idx++;
    }
    idx++; // skip closing ---
  }
  const rest = lines.slice(idx).join('\n');
  const messages: Message[] = [];
  const turns = rest.split(/(?=^### \[)/gm).filter(t => t.trim().length > 0);
  for (const turn of turns) {
    const headMatch = turn.match(/^### \[([^\]]+)\] (\w+)/);
    if (!headMatch) continue;
    const [, createdAt, role] = headMatch;
    const bodyStart = turn.indexOf('\n', turn.indexOf(headMatch[0])) + 1;
    const body = turn.slice(bodyStart).replace(/```tool-calls[\s\S]*?```\s*$/, '').trim();
    messages.push({
      id: `loaded_${messages.length}`,
      role: role as Message['role'],
      content: body,
      createdAt
    });
  }
  return {
    id: frontmatter.id ?? '',
    title: frontmatter.title ?? '',
    savedAt: frontmatter.savedAt ?? '',
    messages
  };
}

export async function saveConversation(params: {
  id?: string;
  title: string;
  messages: Message[];
}): Promise<string> {
  const dir = getConversationsDir();
  await fs.mkdir(dir, { recursive: true });
  const now = new Date();
  const id = params.id ?? `${now.toISOString().replace(/[:.]/g, '-')}_${sanitizeFilename(params.title)}`;
  const path = join(dir, `${id}.md`);
  const content = [
    '---',
    `id: ${id}`,
    `title: ${params.title}`,
    `savedAt: ${now.toISOString()}`,
    `messageCount: ${params.messages.length}`,
    '---',
    '',
    ...params.messages.map(formatMessage)
  ].join('\n');
  await fs.writeFile(path, content, 'utf-8');
  return id;
}

export async function loadConversation(id: string): Promise<Conversation> {
  const path = join(getConversationsDir(), `${id}.md`);
  const content = await fs.readFile(path, 'utf-8');
  return parseConversation(content);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const dir = getConversationsDir();
  try {
    const files = await fs.readdir(dir);
    const results: ConversationSummary[] = [];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      try {
        const content = await fs.readFile(join(dir, f), 'utf-8');
        const conv = parseConversation(content);
        results.push({
          id: conv.id || f.replace(/\.md$/, ''),
          title: conv.title,
          savedAt: conv.savedAt,
          messageCount: conv.messages.length
        });
      } catch { /* skip malformed */ }
    }
    return results;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Verify passing**

```bash
pnpm test tests/conversations/store.test.ts
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/conversations/ tests/conversations/
git commit -m "feat(conversations): Markdown-based conversation persistence"
```

---

## Task 11: LLM IPC Handlers

**Files:**
- Modify: `src/main/ipc.ts`
- Create: `src/main/ipc-llm.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types/window.d.ts`

- [ ] **Step 1: 扩展 IpcApi in `src/shared/types.ts`**

Add after the existing `IpcApi` interface (append fields):

```typescript
export interface LlmChatRequest {
  conversationId?: string;
  providerId: string;
  apiKey?: string;
  userMessage: string;
}

export interface LlmStreamEvent {
  requestId: string;
  type: 'delta' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  toolCallName?: string;
  toolCallArgs?: string;
  error?: string;
}

export interface IpcApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getPlatform: () => Promise<NodeJS.Platform>;
  llmSendMessage: (req: LlmChatRequest) => Promise<{ requestId: string }>;
  llmOnStream: (cb: (ev: LlmStreamEvent) => void) => () => void;  // returns unsubscribe
  conversationsList: () => Promise<Array<{ id: string; title: string; savedAt: string; messageCount: number }>>;
  conversationsLoad: (id: string) => Promise<{ id: string; title: string; messages: Array<{ id: string; role: string; content: string; createdAt: string }> }>;
}
```

- [ ] **Step 2: 创建 `src/main/ipc-llm.ts`**

```typescript
import { ipcMain, type WebContents, type BrowserWindow } from 'electron';
import type { LlmChatRequest } from '@shared/types';
import { createLlmClient } from './llm/factory';
import { runAgentLoop } from './agent/loop';
import { ToolRegistry } from './agent/tools';
import { BUILTIN_TOOLS } from './agent/builtin-tools';
import { saveConversation, loadConversation, listConversations } from './conversations/store';
import type { Message } from '@shared/llm-types';

// In-memory conversation state keyed by conversationId
const activeConversations = new Map<string, Message[]>();

export function registerLlmIpc(getMainWindow: () => BrowserWindow | null): void {
  const registry = new ToolRegistry();
  for (const t of BUILTIN_TOOLS) registry.register(t);

  ipcMain.handle('llm:send', async (_event, req: LlmChatRequest) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Build message history
    let history: Message[] = req.conversationId && activeConversations.has(req.conversationId)
      ? [...activeConversations.get(req.conversationId)!]
      : [];
    const userMsg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: req.userMessage,
      createdAt: new Date().toISOString()
    };
    history.push(userMsg);

    const win = getMainWindow();
    const emit = (ev: any) => { if (win) win.webContents.send('llm:stream', { requestId, ...ev }); };

    // Run asynchronously — don't block IPC
    (async () => {
      try {
        const client = createLlmClient(req.providerId);
        const finalMessages = await runAgentLoop({
          client,
          tools: registry,
          initialMessages: history,
          providerId: req.providerId,
          apiKey: req.apiKey,
          onEvent: (e) => {
            if (e.type === 'delta') emit({ type: 'delta', content: e.content });
            else if (e.type === 'tool_call') emit({ type: 'tool_call', toolCallName: e.toolCall.name, toolCallArgs: JSON.stringify(e.toolCall.arguments) });
            else if (e.type === 'tool_result') emit({ type: 'tool_result', content: e.content });
          }
        });

        // Store updated history
        const convId = req.conversationId ?? requestId;
        activeConversations.set(convId, finalMessages);

        // Save to disk
        const titleGuess = req.userMessage.slice(0, 40);
        await saveConversation({ id: convId, title: titleGuess, messages: finalMessages });

        emit({ type: 'done' });
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return { requestId };
  });

  ipcMain.handle('conversations:list', async () => {
    return await listConversations();
  });

  ipcMain.handle('conversations:load', async (_event, id: string) => {
    return await loadConversation(id);
  });
}
```

- [ ] **Step 3: 修改 `src/main/index.ts` 注册新 IPC handlers**

Modify `src/main/index.ts` — after existing `registerIpcHandlers()` call, add:

```typescript
import { registerLlmIpc } from './ipc-llm';

// ... in app.whenReady().then(() => { ... }):
let mainWin: BrowserWindow | null = null;
app.whenReady().then(() => {
  registerIpcHandlers();
  registerLlmIpc(() => mainWin);
  mainWin = createMainWindow();
  // ...
});
```

Full revised file — overwrite `src/main/index.ts`:

```typescript
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { registerLlmIpc } from './ipc-llm';

let mainWin: BrowserWindow | null = null;

app.whenReady().then(() => {
  registerIpcHandlers();
  registerLlmIpc(() => mainWin);
  mainWin = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWin = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 4: 修改 `src/preload/index.ts`**

Full file contents:

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, IpcApi, LlmChatRequest, LlmStreamEvent } from '@shared/types';

const api: IpcApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  llmSendMessage: (req: LlmChatRequest) => ipcRenderer.invoke('llm:send', req),
  llmOnStream: (cb: (ev: LlmStreamEvent) => void) => {
    const listener = (_event: unknown, ev: LlmStreamEvent) => cb(ev);
    ipcRenderer.on('llm:stream', listener);
    return () => ipcRenderer.removeListener('llm:stream', listener);
  },
  conversationsList: () => ipcRenderer.invoke('conversations:list'),
  conversationsLoad: (id: string) => ipcRenderer.invoke('conversations:load', id)
};

contextBridge.exposeInMainWorld('opendeploy', api);
```

- [ ] **Step 5: Verify**

```bash
pnpm typecheck
pnpm test  # all existing tests still pass
```

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc-llm.ts src/main/index.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat(ipc): wire LLM chat + conversations through IPC with streaming"
```

---

## Task 12: Chat Store (Zustand)

**Files:**
- Create: `src/renderer/stores/chat-store.ts`

- [ ] **Step 1: 创建 `src/renderer/stores/chat-store.ts`**

```typescript
import { create } from 'zustand';
import type { LlmStreamEvent } from '@shared/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ name: string; args: string; result?: string }>;
  isStreaming?: boolean;
  createdAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  currentRequestId: string | null;
  conversationId: string | null;

  sendMessage: (text: string, providerId: string, apiKey: string | undefined) => Promise<void>;
  clear: () => void;
}

function makeId() { return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  error: null,
  currentRequestId: null,
  conversationId: null,

  sendMessage: async (text, providerId, apiKey) => {
    const userMsg: ChatMessage = {
      id: makeId(), role: 'user', content: text, createdAt: new Date().toISOString()
    };
    const assistantMsg: ChatMessage = {
      id: makeId(), role: 'assistant', content: '', isStreaming: true, createdAt: new Date().toISOString()
    };
    set({
      messages: [...get().messages, userMsg, assistantMsg],
      isStreaming: true, error: null
    });

    // Subscribe to stream events (unsubscribe when done)
    const unsubscribe = window.opendeploy.llmOnStream((ev: LlmStreamEvent) => {
      if (ev.requestId !== get().currentRequestId) return;

      if (ev.type === 'delta' && ev.content) {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: last.content + ev.content };
          set({ messages: msgs });
        }
      } else if (ev.type === 'tool_call') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          const tcs = [...(last.toolCalls ?? []), { name: ev.toolCallName ?? '?', args: ev.toolCallArgs ?? '' }];
          msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
          set({ messages: msgs });
        }
      } else if (ev.type === 'tool_result') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && last.toolCalls && last.toolCalls.length > 0) {
          const tcs = [...last.toolCalls];
          tcs[tcs.length - 1] = { ...tcs[tcs.length - 1], result: ev.content ?? '' };
          msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
          set({ messages: msgs });
        }
      } else if (ev.type === 'done') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last) msgs[msgs.length - 1] = { ...last, isStreaming: false };
        set({ messages: msgs, isStreaming: false, currentRequestId: null });
        unsubscribe();
      } else if (ev.type === 'error') {
        set({ error: ev.error ?? 'Unknown error', isStreaming: false, currentRequestId: null });
        unsubscribe();
      }
    });

    try {
      const { requestId } = await window.opendeploy.llmSendMessage({
        conversationId: get().conversationId ?? undefined,
        providerId, apiKey, userMessage: text
      });
      set({ currentRequestId: requestId, conversationId: get().conversationId ?? requestId });
    } catch (err) {
      unsubscribe();
      set({ error: err instanceof Error ? err.message : String(err), isStreaming: false });
    }
  },

  clear: () => set({ messages: [], conversationId: null, error: null })
}));
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/stores/chat-store.ts
git commit -m "feat(renderer): chat store with streaming IPC subscription"
```

---

## Task 13: Markdown + Code Highlighting

**Files:**
- Create: `src/renderer/components/MarkdownBlock.tsx`

- [ ] **Step 1: 安装依赖**

```bash
cd D:/Project/opendeploy
pnpm add react-markdown remark-gfm rehype-highlight highlight.js
```

- [ ] **Step 2: 创建 `src/renderer/components/MarkdownBlock.tsx`**

```typescript
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MarkdownBlockProps {
  content: string;
}

export function MarkdownBlock({ content }: MarkdownBlockProps) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: 验证**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/MarkdownBlock.tsx package.json pnpm-lock.yaml
git commit -m "feat(ui): add MarkdownBlock with GFM and code highlighting"
```

---

## Task 14: Message 和 MessageList 组件

**Files:**
- Create: `src/renderer/components/Message.tsx`
- Create: `src/renderer/components/MessageList.tsx`

- [ ] **Step 1: 创建 `src/renderer/components/Message.tsx`**

```typescript
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@renderer/stores/chat-store';
import { MarkdownBlock } from './MarkdownBlock';
import { Icons } from './icons';

interface MessageProps {
  message: ChatMessage;
}

export function Message({ message }: MessageProps) {
  const { t } = useTranslation();
  const who = message.role === 'user' ? 'user' : 'ai';
  const avatar = message.role === 'user' ? '乔' : 'AI';
  const name = message.role === 'user' ? t('messages.user') : t('messages.assistant');
  const time = new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <div className="turn">
      <div className="turn-head">
        <div className={`turn-av ${who}`}>{avatar}</div>
        <span className="turn-name">{name}</span>
        <span className="turn-time">{time}</span>
      </div>
      <div className="turn-body">
        {message.content && <MarkdownBlock content={message.content} />}
        {message.isStreaming && <span className="streaming-cursor">▍</span>}
        {message.toolCalls?.map((tc, i) => (
          <div key={i} className="tool">
            <div className="tool-head">
              <span className="tool-ic">{Icons.zap}</span>
              <span className="tool-name">{tc.name}</span>
              <span className="tool-args">{tc.args}</span>
              <span className={`tool-status ${tc.result ? 'ok' : 'running'}`}>
                {tc.result ? 'ok ✓' : 'running'}
              </span>
            </div>
            {tc.result && (
              <div className="tool-body">
                <pre style={{fontSize: 11, whiteSpace: 'pre-wrap'}}>{tc.result}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `src/renderer/components/MessageList.tsx`**

```typescript
import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@renderer/stores/chat-store';
import { Message } from './Message';

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-inner">
        {messages.map((m) => <Message key={m.id} message={m} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 添加 i18n keys**

Modify `src/renderer/i18n/locales/zh-CN/common.json` — add to the root object:
```json
"messages": {
  "user": "顾问",
  "assistant": "开达"
}
```

Similarly for `en-US/common.json`:
```json
"messages": {
  "user": "You",
  "assistant": "OpenDeploy"
}
```

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm test
```
Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Message.tsx src/renderer/components/MessageList.tsx src/renderer/i18n/
git commit -m "feat(ui): Message and MessageList components"
```

---

## Task 15: 接线 Composer 到 Chat Store

**Files:**
- Modify: `src/renderer/components/Composer.tsx`

- [ ] **Step 1: Read current Composer**

```bash
cat D:/Project/opendeploy/src/renderer/components/Composer.tsx
```

- [ ] **Step 2: 修改 Composer 接入 chat-store**

Overwrite `src/renderer/components/Composer.tsx` with this version (adjust imports as existing):

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDER_BY_ID } from '@renderer/data/providers';
import { Icons } from './icons';

interface ComposerProps {
  llmProviderId?: string;
  presetText?: string;
}

export function Composer({ llmProviderId, presetText }: ComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(presetText ?? '');
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const settings = useSettingsStore((s) => s.settings);

  const effectiveProviderId = llmProviderId ?? settings.llmProvider ?? 'deepseek';
  const provider = PROVIDER_BY_ID[effectiveProviderId];
  const apiKey = settings.apiKeys?.[effectiveProviderId];

  const submit = async () => {
    if (!text.trim() || isStreaming) return;
    const t = text;
    setText('');
    await sendMessage(t, effectiveProviderId, apiKey);
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="cbox">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={t('composer.placeholder')}
            disabled={isStreaming}
          />
          <div className="ctools">
            <button type="button" className="comp-chip" disabled>
              {Icons.attach} {t('composer.attach')}
            </button>
            <span className="spacer" />
            <button type="button" className="comp-chip">
              <span className={`prov-dot ${provider?.dot ?? ''}`}>{provider?.letter ?? '?'}</span>
              {provider?.short ?? '—'}
            </button>
            <button
              type="button"
              className="btn accent"
              onClick={() => void submit()}
              disabled={isStreaming || !text.trim()}
            >
              {t('composer.send')} {Icons.send}
            </button>
          </div>
        </div>
        <div className="chint">
          <span><span className="kbd">⌘K</span> {t('composer.hintLeft')}</span>
          <span>{t('composer.hintRight')}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Composer.tsx
git commit -m "feat(ui): wire Composer to chat-store for real LLM calls"
```

---

## Task 16: WorkspacePage 显示 MessageList

**Files:**
- Modify: `src/renderer/pages/WorkspacePage.tsx`

- [ ] **Step 1: 修改 WorkspacePage — show MessageList when messages exist, EmptyState when empty**

Rewrite `src/renderer/pages/WorkspacePage.tsx`:

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { Composer } from '@renderer/components/Composer';
import { MessageList } from '@renderer/components/MessageList';
import { Icons } from '@renderer/components/icons';

interface WorkspacePageProps {
  llmProviderId?: string;
}

export function WorkspacePage({ llmProviderId }: WorkspacePageProps) {
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const [presetText, setPresetText] = useState<string>('');

  return (
    <div className="ws">
      <div className="chat-col">
        {messages.length === 0 ? (
          <div className="chat-scroll">
            <div className="chat-inner">
              <EmptyState onPick={(t) => setPresetText(t)} />
            </div>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
        {error && (
          <div style={{padding: '8px 20px', color: 'var(--danger)', fontSize: 12}}>
            {error}
          </div>
        )}
        <Composer llmProviderId={llmProviderId} presetText={presetText} />
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();
  const prompts = [
    { tag: 'SAL', titleKey: 'workspace.prompt1Title', descKey: 'workspace.prompt1Desc' },
    { tag: 'BD',  titleKey: 'workspace.prompt2Title', descKey: 'workspace.prompt2Desc' },
    { tag: 'STK', titleKey: 'workspace.prompt3Title', descKey: 'workspace.prompt3Desc' },
    { tag: 'AP',  titleKey: 'workspace.prompt4Title', descKey: 'workspace.prompt4Desc' }
  ];

  return (
    <div style={{padding: '40px 0'}}>
      <h1 style={{fontSize: 28, letterSpacing: '-0.02em', margin: '0 0 6px'}}>
        <span style={{fontFamily: 'var(--font-serif)', fontWeight: 500}}>
          {t('workspace.emptyHeading')}
        </span>
      </h1>
      <p className="muted" style={{margin: '0 0 24px'}}>{t('workspace.emptyDesc')}</p>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24}}>
        {prompts.map((p, i) => (
          <button
            key={i}
            type="button"
            className="card"
            style={{textAlign: 'left', padding: '14px 16px', margin: 0, cursor: 'pointer'}}
            onClick={() => onPick(`${t(p.titleKey)}: ${t(p.descKey)}`)}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
              <span className="chip accent">{p.tag}</span>
              <span style={{fontWeight: 600, fontSize: 13}}>{t(p.titleKey)}</span>
            </div>
            <div className="muted" style={{fontSize: 12}}>{t(p.descKey)}</div>
          </button>
        ))}
      </div>
      <div className="card" style={{display: 'flex', gap: 10, alignItems: 'flex-start', margin: 0, padding: 12}}>
        <span style={{color: 'var(--accent-deep)', marginTop: 2}}>{Icons.shield}</span>
        <div style={{fontSize: 12, color: 'var(--muted)', lineHeight: 1.5}}>
          {t('workspace.securityReassurance')}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/WorkspacePage.tsx
git commit -m "feat(ui): WorkspacePage shows MessageList when chatting"
```

---

## Task 17: 端到端验证

**Files:** No file changes — manual verification.

- [ ] **Step 1: 构建检查**

```bash
cd D:/Project/opendeploy
pnpm typecheck  # must pass
pnpm test       # all tests pass
pnpm build      # must succeed
```

- [ ] **Step 2: 用户手动测试（dev模式）**

```bash
pnpm dev
```

用户在 Electron 窗口中手动验证：

1. 第一次启动过 wizard，选 DeepSeek（或任一有API Key的provider）
2. 在 Settings 页填入API Key，保存
3. 回到 Workspace
4. 输入 "你好，现在几点了？" 并回车
5. 预期看到：
   - 消息立即显示（user 和 assistant 两条）
   - assistant 消息内容流式逐字出现
   - AI 可能调用 `get_current_datetime` 工具（在消息里显示 tool block）
   - 最后 assistant 给出自然语言回答
6. 检查 `%USERPROFILE%/.opendeploy/conversations/` 是否有新的 .md 文件
7. 再输入第二条消息，测试多轮对话

- [ ] **Step 3: 如遇问题（非阻塞）**

记录任何 UI 或行为异常。小问题可以修复后再次提交；大问题报告出来待下一个修复task。

- [ ] **Step 4: 标记Plan 2完成**

```bash
git tag plan-2-done
git log --oneline | head -20
```

---

## Plan 2 完成标志

- [ ] LLM Provider 抽象 + 3 种实现（OpenAI兼容 / Anthropic / Ollama）
- [ ] SSE 流解析工具（覆盖 OpenAI 和 Anthropic 格式）
- [ ] Agent Loop：多轮 + 工具调用
- [ ] Tool 框架 + 示例工具（`get_current_datetime`）
- [ ] IPC 把 LLM/Agent 能力暴露给 renderer（含流式事件）
- [ ] Chat Store（Zustand）订阅流式事件
- [ ] MarkdownBlock（含代码高亮）
- [ ] Message + MessageList 组件
- [ ] Composer 真正发送消息
- [ ] WorkspacePage 在有对话时显示 MessageList
- [ ] 对话持久化到 Markdown 文件
- [ ] 所有新增单元测试通过（约 15+ 新增）
- [ ] 手动端到端测试：能收到 DeepSeek 的流式回复 ✅

---

## 后续 Plans

| Plan | 名称 | 预计工期 |
|---|---|---|
| Plan 3 | 知识库基础设施（GitHub同步 + 结构化查询Tools） | 1-2周 |
| Plan 4 | 金蝶BOS元数据只读连接 | 2-3周 |
| Plan 5 | Python代码生成 & Demo闭环 | 2-3周 |
| Plan 6 | 打包发布 & v0.1 Alpha Release | 1周 |

---

*Plan 2 · 17 个Task · 预计 2-3 周完成 · 2026-04-20*
