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
