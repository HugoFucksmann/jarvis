import fs from 'fs';
import path from 'path';
import { LLMProvider, ChatMessage } from '../llm/types.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { TaskToolContext } from '../tools/TaskToolContext.js';
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
import { MCPRegistry } from '../mcp/MCPRegistry.js';

export interface AgentLoopOptions {
  llm: LLMProvider;
  tools: ToolRegistry;
  memory: MemoryStore;
  workspaceRoot: string;
  mcpRegistry?: MCPRegistry;
  maxIterations?: number;
  timeoutSeconds?: number;
  thinking?: boolean;
  onEvent?: (event: AgentEvent) => void;
  requestApproval?: (
    toolName: string,
    args: Record<string, unknown>,
    risk: RiskLevel,
    reason: string
  ) => Promise<boolean>;
}

export class AgentLoop {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private memory: MemoryStore;
  private workspaceRoot: string;
  private mcpRegistry?: MCPRegistry;
  private maxIterations: number;
  private timeoutSeconds: number;
  private thinking: boolean;
  private onEvent?: (event: AgentEvent) => void;
  private requestApproval?: (
    toolName: string,
    args: Record<string, unknown>,
    risk: RiskLevel,
    reason: string
  ) => Promise<boolean>;

  private logger = new Logger('AgentLoop');

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm;
    this.tools = options.tools;
    this.memory = options.memory;
    this.workspaceRoot = options.workspaceRoot;
    this.mcpRegistry = options.mcpRegistry;
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
        this.logger.error(
          `Error in event callback: ${String(err)}`
        );
      }
    }
  }

  private getRecentTaskSnippet(): string {
    try {
      const tasksFile = path.join(
        this.workspaceRoot,
        '.jarvis',
        'tasks.json'
      );

      if (fs.existsSync(tasksFile)) {
        const raw = fs.readFileSync(
          tasksFile,
          'utf-8'
        );

        const tasks = JSON.parse(raw);

        if (
          Array.isArray(tasks) &&
          tasks.length > 0
        ) {
          const last =
            tasks[tasks.length - 1];

          return `- Última tarea ejecutada: "${last.prompt}" -> Resultado: ${last.summary} (Éxito: ${last.success})`;
        }
      }
    } catch {
      // Ignore read errors.
    }

    return '';
  }

  private shouldPersistTask(
    prompt: string,
    executedTools: string[]
  ): boolean {
    const pureActionTools = new Set([
      'control_media',
      'control_volume',
      'open_url',
      'open_application',
      'manage_clipboard',
      'manage_power',
      'simulate_input',
      'manage_windows',
      'send_notification',
    ]);

    if (
      executedTools.length > 0 &&
      executedTools.every((tool) =>
        pureActionTools.has(tool)
      )
    ) {
      return false;
    }

    const normalized =
      prompt.trim().toLowerCase();

    if (
      /^(ok|gracias|listo|entendido|de nada|chau|adios)$/.test(
        normalized
      )
    ) {
      return false;
    }

    return true;
  }

  public async run(
    task: AgentTaskRequest
  ): Promise<AgentTaskResult> {
    const startTime = Date.now();

    let iteration = 0;
    let toolCallsCount = 0;

    const executedTools: string[] = [];
    const pastActionsHash: string[] = [];

    this.logger.info(
      `Starting task ${task.taskId}: "${task.prompt.substring(
        0,
        80
      )}..."`
    );

    this.emit({
      type: 'state_change',
      state: AgentState.UNDERSTANDING,
      message:
        'Comprendiendo solicitud y consultando contexto del sistema...',
    });

    const timeoutController =
      new AbortController();

    const timeoutTimer = setTimeout(() => {
      timeoutController.abort(
        new Error(
          `Agent loop reached timeout of ${this.timeoutSeconds}s`
        )
      );
    }, this.timeoutSeconds * 1000);

    const onExternalAbort = () => {
      timeoutController.abort(
        new Error('Task cancelled by user')
      );
    };

    task.signal?.addEventListener(
      'abort',
      onExternalAbort
    );

    try {
      /*
       * ------------------------------------------------------------
       * CONTEXT
       * ------------------------------------------------------------
       */

      const contextNeeds =
        ContextBuilder.detectContextNeeds(
          task.prompt
        );

      const relevantFacts =
        contextNeeds.needsPersistentMemory
          ? await this.memory.queryLongTermFacts(
            task.prompt
          )
          : [];

      const systemPrompt =
        ContextBuilder.buildSystemPrompt({
          workspaceRoot:
            this.workspaceRoot,
          longTermFacts:
            relevantFacts,
          modelName:
            this.llm.getModel(),
          includePersistentMemory:
            contextNeeds.needsPersistentMemory,
        });

      const history =
        contextNeeds.needsRecentHistory
          ? await this.memory.getShortTermMessages(
            task.sessionId,
            4
          )
          : [];

      const taskContextSnippet =
        contextNeeds.needsTaskContext
          ? this.getRecentTaskSnippet()
          : '';

      const finalSystemContent =
        taskContextSnippet
          ? `${systemPrompt}\n\n## Contexto de Tarea Previa Relevante:\n${taskContextSnippet}`
          : systemPrompt;

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: finalSystemContent,
        },
        ...history,
        {
          role: 'user',
          content: task.prompt,
        },
      ];

      /*
       * ------------------------------------------------------------
       * TASK TOOL SCOPE
       * ------------------------------------------------------------
       *
       * IMPORTANT:
       * No se envían todas las tools globales al modelo.
       *
       * TaskToolContext combina:
       *
       *   ToolRegistry
       *      -> tools locales relevantes
       *
       *   MCPRegistry
       *      -> discovery tools relevantes
       *
       *   Discovery
       *      -> tools MCP específicas descubiertas durante la tarea
       *
       * Esto mantiene pequeño el contexto enviado a Qwen.
       */

      const taskTools =
        new TaskToolContext(
          this.tools,
          this.mcpRegistry
        );

      taskTools.addRelevantLocalTools(
        task.prompt
      );

      taskTools.addRelevantMCPTools(
        task.prompt
      );

      this.logger.info(
        `Task tool scope initialized with ${taskTools.size} tools: ${taskTools
          .getToolNames()
          .join(', ')}`
      );

      let finalResponse = '';

      /*
       * ------------------------------------------------------------
       * AGENT LOOP
       * ------------------------------------------------------------
       */

      while (
        iteration < this.maxIterations
      ) {
        if (
          timeoutController.signal.aborted
        ) {
          throw new Error(
            timeoutController.signal.reason?.message ||
            'Task aborted'
          );
        }

        iteration++;

        this.logger.debug(
          `Iteration ${iteration}/${this.maxIterations}`
        );

        this.emit({
          type: 'state_change',
          state: AgentState.PLANNING,
          message:
            iteration === 1
              ? 'Analizando requerimiento y planificando acciones...'
              : 'Evaluando observaciones y razonando siguiente paso...',
        });

        /*
         * Solo enviamos las tools del scope actual.
         *
         * Después de un discovery MCP este scope puede crecer
         * dinámicamente con las tools descubiertas.
         */

        const toolDefinitions =
          taskTools.getDefinitions();

        this.logger.debug(
          `Sending ${toolDefinitions.length} tools to LLM: ${taskTools
            .getToolNames()
            .join(', ')}`
        );

        let assistantMessage: ChatMessage;

        try {
          assistantMessage =
            await this.llm.chat(
              messages,
              {
                tools: toolDefinitions,
                temperature: 0.1,
                think: this.thinking,
                signal:
                  timeoutController.signal,
              },
              {
                onToken: (token) => {
                  this.emit({
                    type: 'token',
                    token,
                  });
                },

                onThinking: (
                  thinkingChunk
                ) => {
                  if (
                    thinkingChunk.includes(
                      'tool'
                    ) ||
                    thinkingChunk.includes(
                      'file'
                    ) ||
                    thinkingChunk.includes(
                      'command'
                    )
                  ) {
                    this.emit({
                      type: 'thinking_summary',
                      summary:
                        'Planificando invocación de herramientas...',
                    });
                  }
                },
              }
            );
          this.logger.info(
            `LLM response iteration ${iteration}: ${JSON.stringify(
              assistantMessage,
              null,
              2
            )}`
          );
        } catch (err: unknown) {
          if (
            timeoutController.signal
              .aborted
          ) {
            throw new Error(
              'Task was cancelled.'
            );
          }

          throw err;
        }

        messages.push(
          assistantMessage
        );

        const toolCalls =
          assistantMessage.tool_calls;

        /*
         * No hay tool calls:
         * el modelo terminó la tarea.
         */

        if (
          !toolCalls ||
          toolCalls.length === 0
        ) {
          finalResponse =
            assistantMessage.content ||
            'Tarea completada con éxito.';

          break;
        }

        /*
         * ----------------------------------------------------------
         * LOOP DETECTION
         * ----------------------------------------------------------
         */

        const actionSignature =
          JSON.stringify(
            toolCalls.map((toolCall) => ({
              name:
                toolCall.function.name,
              args:
                toolCall.function.arguments,
            }))
          );

        const recentRepeats =
          pastActionsHash.filter(
            (hash) =>
              hash === actionSignature
          ).length;

        if (recentRepeats >= 2) {
          this.logger.warn(
            `Loop detected! Same tool call sequence repeated 3 times: ${actionSignature}`
          );

          messages.push({
            role: 'system',
            content:
              'Advertencia del sistema: Has ejecutado la misma llamada a herramienta repetidamente sin progresar. No vuelvas a llamar la misma herramienta con los mismos argumentos. Concluye la tarea o prueba un enfoque diferente.',
          });

          pastActionsHash.push(
            actionSignature
          );

          continue;
        }

        pastActionsHash.push(
          actionSignature
        );

        /*
         * ----------------------------------------------------------
         * TOOL EXECUTION
         * ----------------------------------------------------------
         */

        for (const tc of toolCalls) {
          if (
            timeoutController.signal
              .aborted
          ) {
            throw new Error(
              'Task cancelled during tool execution.'
            );
          }

          toolCallsCount++;

          const toolName =
            tc.function.name;

          const toolArgs =
            tc.function.arguments;

          executedTools.push(
            toolName
          );

          /*
           * La tool DEBE estar en el scope actual.
           *
           * Esto evita que el modelo pueda ejecutar una tool
           * que no fue proporcionada en esta tarea.
           */

          const toolObj =
            taskTools.getTool(
              toolName
            );

          const riskLevel =
            toolObj
              ? toolObj.riskLevel
              : RiskLevel.LOW;

          this.emit({
            type: 'tool_call_start',
            toolName,
            args: toolArgs,
            riskLevel,
            callId: tc.id,
          });

          this.emit({
            type: 'state_change',
            state:
              AgentState.EXECUTING_TOOL,
            message:
              `Ejecutando herramienta: ${toolName}...`,
          });

          const execContext = {
            workspaceRoot:
              this.workspaceRoot,

            signal:
              timeoutController.signal,

            requestApproval:
              async (
                tName: string,
                tArgs: Record<
                  string,
                  unknown
                >,
                rLevel: RiskLevel,
                reason: string
              ) => {
                const approvalId =
                  `appr_${Date.now()}_${Math.random()
                    .toString(36)
                    .substring(2, 6)}`;

                this.emit({
                  type: 'state_change',
                  state:
                    AgentState.AWAITING_APPROVAL,
                  message:
                    `Esperando autorización del usuario para: ${tName} (${rLevel})...`,
                });

                this.emit({
                  type: 'approval_requested',
                  toolName: tName,
                  args: tArgs,
                  riskLevel: rLevel,
                  reason,
                  approvalId,
                });

                if (
                  this.requestApproval
                ) {
                  const approved =
                    await this.requestApproval(
                      tName,
                      tArgs,
                      rLevel,
                      reason
                    );

                  this.emit({
                    type: 'approval_resolved',
                    approvalId,
                    approved,
                  });

                  return approved;
                }

                return false;
              },
          };

          /*
           * Ejecutamos contra el scope de la tarea,
           * no directamente contra todas las tools globales.
           */

          const result =
            await taskTools.executeTool(
              toolName,
              toolArgs,
              execContext
            );

          this.emit({
            type: 'tool_call_result',
            callId: tc.id,
            toolName,
            result,
          });

          this.emit({
            type: 'state_change',
            state:
              AgentState.OBSERVING,
            message:
              `Observando resultado de ${toolName}...`,
          });

          /*
           * --------------------------------------------------------
           * MCP DISCOVERY
           * --------------------------------------------------------
           *
           * Ejemplo:
           *
           * google__gmail_discover
           *
           * El resultado puede contener las tools concretas de
           * Gmail. Las incorporamos al scope de ESTA tarea.
           *
           * No se registran globalmente.
           */

          if (
            result.success &&
            toolName.includes('__') &&
            toolName
              .toLowerCase()
              .includes('discover') &&
            this.mcpRegistry
          ) {
            const separator =
              toolName.indexOf(
                '__'
              );

            if (separator > 0) {
              const serverName =
                toolName.substring(
                  0,
                  separator
                );

              const added =
                taskTools.addDiscoveredMCPTools(
                  serverName,
                  result,
                  task.prompt
                );

              messages.push({
                role: 'system',
                content:
                  'La tarea original aún no está completada. La herramienta de discovery solo sirvió para encontrar herramientas concretas. Ahora debes utilizar la herramienta disponible que corresponda para completar la solicitud original. No expliques qué herramientas existen ni preguntes nuevamente qué hacer.',
              });

              this.logger.info(
                'MCP discovery processed for current task scope.'
              );
            }
          }

          /*
           * El resultado se incorpora al contexto del LLM.
           */

          messages.push({
            role: 'tool',
            name: toolName,
            tool_call_id: tc.id,
            content:
              JSON.stringify(result),
          });
        }
      }

      /*
       * ------------------------------------------------------------
       * MAX ITERATIONS
       * ------------------------------------------------------------
       */

      if (
        iteration >=
        this.maxIterations &&
        !finalResponse
      ) {
        finalResponse =
          'Se alcanzó el límite máximo de iteraciones configuradas para la tarea sin llegar a una conclusión definitiva.';
      }

      /*
       * ------------------------------------------------------------
       * MEMORY
       * ------------------------------------------------------------
       */

      if (
        this.shouldPersistTask(
          task.prompt,
          executedTools
        )
      ) {
        await this.memory.saveShortTermMessage(
          task.sessionId,
          {
            role: 'user',
            content: task.prompt,
          }
        );

        await this.memory.saveShortTermMessage(
          task.sessionId,
          {
            role: 'assistant',
            content: finalResponse,
          }
        );
      } else {
        this.logger.debug(
          `Task ${task.taskId} was a standalone action (${executedTools.join(
            ', '
          ) || 'action'}). Skipped short-term chat persistence.`
        );
      }

      /*
       * ------------------------------------------------------------
       * COMPLETED
       * ------------------------------------------------------------
       */

      this.emit({
        type: 'state_change',
        state: AgentState.COMPLETED,
        message: 'Tarea finalizada.',
      });

      this.emit({
        type: 'task_complete',
        response: finalResponse,
      });

      const durationMs =
        Date.now() - startTime;

      this.logger.info(
        `Task completed in ${durationMs}ms with ${toolCallsCount} tool calls across ${iteration} iterations.`
      );

      return {
        taskId: task.taskId,
        success: true,
        response: finalResponse,
        toolCallsCount,
        iterations: iteration,
        durationMs,
      };
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? err.message
          : String(err);

      this.logger.error(
        `Task failed: ${errMsg}`
      );

      if (
        errMsg.includes('cancelled') ||
        errMsg.includes('aborted')
      ) {
        this.emit({
          type: 'state_change',
          state: AgentState.CANCELLED,
          message:
            'Tarea cancelada por el usuario.',
        });

        this.emit({
          type: 'task_cancelled',
        });
      } else {
        this.emit({
          type: 'state_change',
          state: AgentState.ERROR,
          message:
            `Error durante la ejecución: ${errMsg}`,
        });

        this.emit({
          type: 'task_error',
          error: errMsg,
        });
      }

      return {
        taskId: task.taskId,
        success: false,
        response: '',
        toolCallsCount,
        iterations: iteration,
        durationMs:
          Date.now() - startTime,
        error: errMsg,
      };
    } finally {
      clearTimeout(timeoutTimer);

      task.signal?.removeEventListener(
        'abort',
        onExternalAbort
      );
    }
  }
}