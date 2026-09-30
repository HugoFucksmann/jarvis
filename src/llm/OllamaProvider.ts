import {
  LLMProvider,
  ChatMessage,
  LLMOptions,
  StreamCallbacks,
  ModelInfo,
  ToolCall,
} from './types.js';
import { Logger } from '../logger/Logger.js';

export class OllamaProvider implements LLMProvider {
  public name = 'Ollama';
  private baseUrl: string;
  private currentModel: string;
  private logger = new Logger('OllamaProvider');

  constructor(baseUrl: string = 'http://127.0.0.1:11434', defaultModel: string = 'qwen3.5:9b') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.currentModel = defaultModel;
  }

  public getModel(): string {
    return this.currentModel;
  }

  public setModel(model: string): void {
    this.logger.info(`Switching active model to: ${model}`);
    this.currentModel = model;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Failed to list Ollama models: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        models: Array<{
          name: string;
          size: number;
          modified_at: string;
          details?: { family?: string; parameter_size?: string };
          capabilities?: string[];
        }>;
      };

      return (data.models || []).map((m) => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        family: m.details?.family,
        parameterSize: m.details?.parameter_size,
        capabilities: m.capabilities,
      }));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error listing models from ${this.baseUrl}: ${errMsg}`);
      return [];
    }
  }

  public async chat(
    messages: ChatMessage[],
    options?: LLMOptions,
    callbacks?: StreamCallbacks
  ): Promise<ChatMessage> {
    const url = `${this.baseUrl}/api/chat`;

    // Map messages to Ollama expected format
    const formattedMessages = messages.map((m) => {
      const msg: Record<string, unknown> = {
        role: m.role,
        content: m.content,
      };
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls;
      }
      return msg;
    });

    const payload: Record<string, unknown> = {
      model: this.currentModel,
      messages: formattedMessages,
      stream: true,
      think: options?.think !== undefined ? options.think : false, // Fast turbo mode by default
      keep_alive: '60m', // Keep in memory permanently to prevent cold-start reload latency
      options: {
        temperature: options?.temperature ?? 0.1,
        num_ctx: 8192,
      },
    };

    if (options?.tools && options.tools.length > 0) {
      payload.tools = options.tools;
    }

    this.logger.debug(`Sending chat request to Ollama (${this.currentModel})`, {
      messageCount: messages.length,
      toolsCount: options?.tools?.length || 0,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama request failed [${response.status}]: ${errorText || response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Ollama response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let fullContent = '';
    let fullThinking = '';
    let accumulatedToolCalls: ToolCall[] = [];
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const chunk = JSON.parse(trimmed) as {
              message?: {
                content?: string;
                thinking?: string;
                tool_calls?: Array<{
                  id?: string;
                  function?: {
                    name?: string;
                    arguments?: Record<string, unknown> | string;
                  };
                }>;
              };
              done?: boolean;
            };

            const msg = chunk.message;
            if (msg) {
              if (msg.thinking) {
                fullThinking += msg.thinking;
                callbacks?.onThinking?.(msg.thinking);
              }

              if (msg.content) {
                fullContent += msg.content;
                callbacks?.onToken?.(msg.content);
              }

              if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                for (const tc of msg.tool_calls) {
                  let parsedArgs: Record<string, unknown> = {};
                  if (typeof tc.function?.arguments === 'string') {
                    try {
                      parsedArgs = JSON.parse(tc.function.arguments);
                    } catch {
                      parsedArgs = {};
                    }
                  } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
                    parsedArgs = tc.function.arguments as Record<string, unknown>;
                  }

                  const standardizedToolCall: ToolCall = {
                    id: tc.id || `call_${Math.random().toString(36).substring(2, 10)}`,
                    function: {
                      name: tc.function?.name || '',
                      arguments: parsedArgs,
                    },
                  };

                  accumulatedToolCalls.push(standardizedToolCall);
                  callbacks?.onToolCall?.(standardizedToolCall);
                }
              }
            }
          } catch {
            // Partial JSON chunk, ignore and continue
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      role: 'assistant',
      content: fullContent,
      thinking: fullThinking || undefined,
      tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
    };
  }
}
