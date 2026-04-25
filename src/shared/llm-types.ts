import type { MessageBlock } from './blocks';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  role: Role;
  content: string;
  toolCallId?: string;         // set when role === 'tool'
  toolCalls?: ToolCall[];      // set on assistant messages that invoke tools
  /**
   * Internal reasoning (thinking) text produced by models that expose it —
   * DeepSeek V4 / Qwen3 思考 / GLM 5.1 / Kimi K2.6 / Claude extended
   * thinking etc. Must be round-tripped back to the LLM in subsequent
   * tool-use turns or those providers reject the request (DeepSeek V4
   * returns HTTP 400 "reasoning_content must be passed back"). Not shown
   * to end-user by default; UI can opt-in a "show thinking" toggle.
   */
  reasoningContent?: string;
  /**
   * Anthropic extended-thinking block signature — an opaque, integrity-
   * protected token the server emits alongside the thinking text. Claude
   * requires the exact signature + text to be passed back verbatim in
   * subsequent turns, otherwise it drops the thinking chain.
   */
  reasoningSignature?: string;
  /**
   * Ordered stream of text / tool_use blocks as they arrived. Set on
   * assistant messages so persistence can round-trip the "said X → did
   * tool → said Y" interleaving the LLM actually produced. Not sent to the
   * LLM API (which only consumes content + toolCalls).
   */
  blocks?: MessageBlock[];
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
  | { type: 'reasoning_delta'; content: string }
  | { type: 'reasoning_signature'; signature: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'usage'; outputTokens: number }
  | { type: 'done'; finishReason: 'stop' | 'tool_calls' | 'length' | 'error'; usage?: TokenUsage }
  | { type: 'error'; error: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
