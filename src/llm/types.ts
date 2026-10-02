export interface ToolFunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolDefinition {
  type: 'function';
  function: ToolFunctionDefinition;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LLMOptions {
  temperature?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  think?: boolean;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onThinking?: (thinking: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
}

export interface ModelInfo {
  name: string;
  size: number;
  modifiedAt: string;
  family?: string;
  parameterSize?: string;
  capabilities?: string[];
}

export interface LLMProvider {
  name: string;
  getModel(): string;
  setModel(model: string): void;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  chat(
    messages: ChatMessage[],
    options?: LLMOptions,
    callbacks?: StreamCallbacks
  ): Promise<ChatMessage>;
}