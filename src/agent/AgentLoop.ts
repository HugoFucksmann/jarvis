import { LLMProvider, ChatMessage, ToolCall } from '../llm/types.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { MemoryStore } from '../memory/MemoryStore.js';
import { Logger } from '../logger/Logger.js';
import {
  AgentEvent,
  AgentState,
  AgentTaskRequest,
  AgentTaskResult,
} from './types.js';
import { ContextBuilder } from './contextBuilder.js';
import { RiskLevel } from '../tools/types.js';

export interface AgentLoopOptions {
  llm: LLMProvider;
  tools: ToolRegistry;
  memory: MemoryStore;
  workspaceRoot: string;
  maxIterations?: number;
  timeoutSeconds?: number;
  thinking?: boolean;
  onEvent?: (event: AgentEvent) => void;
  requestApproval?: (toolName: string, args: Record<string, unknown>, risk: RiskLevel, reason: string) => Promise<boolean>;
}

export class AgentLoop {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private memory: MemoryStore;
  private workspaceRoot: string;
  private maxIterations: number;
  private timeoutSeconds: number;
  private thinking: boolean;
  private onEvent?: (event: AgentEvent) => void;
  private requestApproval?: (toolName: string, args: Record<string, unknown>, risk: RiskLevel, reason: string) => Promise<boolean>;
  private logger = new Logger('AgentLoop');

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm;
    this.tools = options.tools;
    this.memory = options.memory;
    this.workspaceRoot = options.workspaceRoot;
    this.maxIterations = options.maxIterations || 15;
    this.timeoutSeconds = options.timeoutSeconds || 180;
    this.thinking = options.thinking ?? false;
    this.onEvent = options.onEvent;
    this.requestApproval = options.requestApproval;
  }

  private emit(event: AgentEvent): void {
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch (err) {
        this.logger.error(`Error in event callback: ${String(err)}`);
      }
    }
  }

  public async run(task: AgentTaskRequest): Promise<AgentTaskResult> {
    const startTime = Date.now();
    let iteration = 0;
    let toolCallsCount = 0;
    const pastActionsHash: string[] = [];

    this.logger.info(`Starting task ${task.taskId}: "${task.prompt.substring(0, 80)}..."`);
    this.emit({
      type: 'state_change',
      state: AgentState.UNDERSTANDING,
      message: 'Comprendiendo solicitud y consultando contexto del sistema...',
    });

    // Setup abort timeout
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => {
      timeoutController.abort(new Error(`Agent loop reached timeout of ${this.timeoutSeconds}s`));
    }, this.timeoutSeconds * 1000);

    // Link incoming external signal with timeout signal
    const onExternalAbort = () => {
      timeoutController.abort(new Error('Task cancelled by user'));
    };
    task.signal?.addEventListener('abort', onExternalAbort);

    try {
      // 1. Retrieve long term memory facts relevant to user prompt
      const relevantFacts = await this.memory.queryLongTermFacts(task.prompt);

      // 2. Build system prompt
      const systemPrompt = ContextBuilder.buildSystemPrompt({
        workspaceRoot: this.workspaceRoot,
        longTermFacts: relevantFacts,
        modelName: this.llm.getModel(),
      });

      // 3. Retrieve short-term history for this session
      const history = await this.memory.getShortTermMessages(task.sessionId, 12);

      // 4. Assemble message sequence
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: task.prompt },
      ];

      // Save user prompt in short-term memory
      await this.memory.saveShortTermMessage(task.sessionId, {
        role: 'user',
        content: task.prompt,
      });

      let finalResponse = '';

      // 5. Execution loop
      while (iteration < this.maxIterations) {
        if (timeoutController.signal.aborted) {
          throw new Error(timeoutController.signal.reason?.message || 'Task aborted');
        }

        iteration++;
        this.logger.debug(`Iteration ${iteration}/${this.maxIterations}`);

        this.emit({
          type: 'state_change',
          state: AgentState.PLANNING,
          message: iteration === 1 ? 'Analizando requerimiento y planificando acciones...' : 'Evaluando observaciones y razonando siguiente paso...',
        });

        const toolDefinitions = this.tools.getDefinitions();

        // Call LLM with tool definitions
        let assistantMessage: ChatMessage;
        try {
          assistantMessage = await this.llm.chat(
            messages,
            {
              tools: toolDefinitions,
              temperature: 0.1,
              think: this.thinking,
              signal: timeoutController.signal,
            },
            {
              onToken: (token) => {
                this.emit({ type: 'token', token });
              },
              onThinking: (thinkingChunk) => {
                // We emit concise summaries or keep UI informed without showing raw internal monologue
                if (thinkingChunk.includes('tool') || thinkingChunk.includes('file') || thinkingChunk.includes('command')) {
                  this.emit({
                    type: 'thinking_summary',
                    summary: 'Planificando invocación de herramientas...',
                  });
                }
              },
            }
          );
        } catch (err: unknown) {
          if (timeoutController.signal.aborted) {
            throw new Error('Task was cancelled.');
          }
          throw err;
        }

        // Add assistant message to internal working history
        messages.push(assistantMessage);

        // Check if LLM requested tools
        const toolCalls = assistantMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          // No more tools needed: task finished!
          finalResponse = assistantMessage.content || 'Tarea completada con éxito.';
          break;
        }

        // Loop detection: check if identical tool calls are repeating uncontrollably
        const actionSignature = JSON.stringify(toolCalls.map((t) => ({ name: t.function.name, args: t.function.arguments })));
        const recentRepeats = pastActionsHash.filter((h) => h === actionSignature).length;
        if (recentRepeats >= 2) {
          this.logger.warn(`Loop detected! Same tool call sequence repeated 3 times: ${actionSignature}`);
          messages.push({
            role: 'system',
            content: 'Advertencia del sistema: Has ejecutado la misma llamada a herramienta repetidamente sin progresar. No vuelvas a llamar la misma herramienta con los mismos argumentos. Concluye la tarea o prueba un enfoque diferente.',
          });
          pastActionsHash.push(actionSignature);
          continue;
        }
        pastActionsHash.push(actionSignature);

        // Execute all requested tool calls
        for (const tc of toolCalls) {
          if (timeoutController.signal.aborted) {
            throw new Error('Task was cancelled during tool execution.');
          }

          toolCallsCount++;
          const toolName = tc.function.name;
          const toolArgs = tc.function.arguments;
          const toolObj = this.tools.getTool(toolName);
          const riskLevel = toolObj ? toolObj.riskLevel : RiskLevel.LOW;

          this.emit({
            type: 'tool_call_start',
            toolName,
            args: toolArgs,
            riskLevel,
            callId: tc.id,
          });

          this.emit({
            type: 'state_change',
            state: AgentState.EXECUTING_TOOL,
            message: `Ejecutando herramienta: ${toolName}...`,
          });

          // Context for tool execution
          const execContext = {
            workspaceRoot: this.workspaceRoot,
            signal: timeoutController.signal,
            requestApproval: async (tName: string, tArgs: Record<string, unknown>, rLevel: RiskLevel, reason: string) => {
              const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
              this.emit({
                type: 'state_change',
                state: AgentState.AWAITING_APPROVAL,
                message: `Esperando autorización del usuario para: ${tName} (${rLevel})...`,
              });

              this.emit({
                type: 'approval_requested',
                toolName: tName,
                args: tArgs,
                riskLevel: rLevel,
                reason,
                approvalId,
              });

              if (this.requestApproval) {
                const approved = await this.requestApproval(tName, tArgs, rLevel, reason);
                this.emit({ type: 'approval_resolved', approvalId, approved });
                return approved;
              }
              return false;
            },
          };

          // Execute tool via registry (passes through PermissionManager)
          const result = await this.tools.executeTool(toolName, toolArgs, execContext);

          this.emit({
            type: 'tool_call_result',
            callId: tc.id,
            toolName,
            result,
          });

          this.emit({
            type: 'state_change',
            state: AgentState.OBSERVING,
            message: `Observando resultado de ${toolName}...`,
          });

          // Append tool result message to conversation
          messages.push({
            role: 'tool',
            name: toolName,
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Check if loop ended due to max iterations
      if (iteration >= this.maxIterations && !finalResponse) {
        finalResponse = 'Se alcanzó el límite máximo de iteraciones configuradas para la tarea sin llegar a una conclusión definitiva.';
      }

      // Save final assistant response to short term memory
      await this.memory.saveShortTermMessage(task.sessionId, {
        role: 'assistant',
        content: finalResponse,
      });

      this.emit({
        type: 'state_change',
        state: AgentState.COMPLETED,
        message: 'Tarea finalizada.',
      });

      this.emit({
        type: 'task_complete',
        response: finalResponse,
      });

      const durationMs = Date.now() - startTime;
      this.logger.info(`Task completed in ${durationMs}ms with ${toolCallsCount} tool calls across ${iteration} iterations.`);

      return {
        taskId: task.taskId,
        success: true,
        response: finalResponse,
        toolCallsCount,
        iterations: iteration,
        durationMs,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Task failed: ${errMsg}`);

      if (errMsg.includes('cancelled') || errMsg.includes('aborted')) {
        this.emit({
          type: 'state_change',
          state: AgentState.CANCELLED,
          message: 'Tarea cancelada por el usuario.',
        });
        this.emit({ type: 'task_cancelled' });
      } else {
        this.emit({
          type: 'state_change',
          state: AgentState.ERROR,
          message: `Error durante la ejecución: ${errMsg}`,
        });
        this.emit({ type: 'task_error', error: errMsg });
      }

      return {
        taskId: task.taskId,
        success: false,
        response: '',
        toolCallsCount,
        iterations: iteration,
        durationMs: Date.now() - startTime,
        error: errMsg,
      };
    } finally {
      clearTimeout(timeoutTimer);
      task.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}
