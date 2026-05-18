// ── Message types (OpenAI-compatible) ──────────────────────────────────────

export interface TextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolCallMessage {
  role: 'assistant';
  content: null;
  tool_calls: ToolCall[];
}

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export type Message = TextMessage | ToolCallMessage | ToolResultMessage;

// ── Tool call structures ────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ── Streaming chunks ────────────────────────────────────────────────────────

export type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; arguments_delta: string }
  | { type: 'finish'; finish_reason: 'stop' | 'tool_calls' | 'length' };

// ── Tool interfaces ─────────────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

// ── Provider interface ──────────────────────────────────────────────────────

export interface RequestOptions {
  model: string;
  maxTokens: number;
  temperature: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: string;
  stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk>;
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface SeekCodeConfig {
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  baseURL: string;
}

// ── Agent ───────────────────────────────────────────────────────────────────

export interface AgentRunOptions {
  task: string;
  cwd: string;
  config: SeekCodeConfig;
  provider: LLMProvider;
  context?: import('./core/context/manager.js').ContextManager;
  onText?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  signal?: AbortSignal;
}
