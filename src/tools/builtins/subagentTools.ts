import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { getSharedSubagentManager } from '../../subagents/SubagentManager.js';
import { SubagentType } from '../../subagents/types.js';

export class DelegateSubagentTool extends BaseTool {
  readonly name = 'delegate_subagent';
  readonly description =
    'Delega una tarea pesada, script o investigación a un subagente en segundo plano (background) para no bloquear el chat ni el HUD. Notifica proactivamente al usuario por voz y notificación flotante al finalizar.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['agent:delegate'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Título corto y claro de la tarea (ej: "Auditoría de seguridad", "Compilación de proyecto", "Descarga de video").',
      },
      taskPrompt: {
        type: 'string',
        description: 'Objetivo detallado o instrucción que el subagente debe resolver de forma autónoma.',
      },
      type: {
        type: 'string',
        enum: ['llm_worker', 'shell_worker'],
        description: 'Tipo de subagente: "llm_worker" para razonamiento y uso de herramientas en background, o "shell_worker" para ejecutar comandos de terminal largos.',
      },
      command: {
        type: 'string',
        description: 'Comando de terminal a ejecutar en caso de subagente "shell_worker" (ej: "npm run build" o "python script.py").',
      },
      notifyChannels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Canales por donde notificar al finalizar: ["toast", "voice", "hud"]. Por defecto activa los tres.',
      },
    },
    required: ['title', 'taskPrompt'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const title = (args.title as string)?.trim();
      const taskPrompt = (args.taskPrompt as string)?.trim();
      const type = (args.type as SubagentType) || (args.command ? 'shell_worker' : 'llm_worker');
      const command = (args.command as string)?.trim();
      const notifyChannels = (args.notifyChannels as string[]) || ['toast', 'voice', 'hud'];

      if (!title || !taskPrompt) {
        return { success: false, error: 'Los parámetros "title" y "taskPrompt" son obligatorios.' };
      }

      const manager = getSharedSubagentManager();
      const record = manager.spawnSubagent({
        title,
        taskPrompt,
        type,
        command,
        notifyChannels,
      });

      return {
        success: true,
        data: {
          message: `Subagente iniciado con éxito en segundo plano.`,
          subagentId: record.id,
          title: record.title,
          type: record.type,
          status: record.status,
          hint: 'Puedes continuar interactuando con el usuario. Se le notificará por voz y notificación nativa en cuanto el subagente termine su tarea.',
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error al delegar tarea a subagente: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

export class ListSubagentsTool extends BaseTool {
  readonly name = 'list_subagents';
  readonly description = 'Lista todos los subagentes y tareas en segundo plano (activas, completadas o fallidas) junto con su estado.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['agent:list'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: ['all', 'running', 'completed', 'failed', 'cancelled'],
        description: 'Filtrar por estado del subagente. Por defecto lista todos los recientes.',
      },
    },
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const statusFilter = (args.status as string) || 'all';
      const manager = getSharedSubagentManager();
      let list = manager.listSubagents();

      if (statusFilter !== 'all') {
        list = list.filter((s) => s.status === statusFilter);
      }

      return {
        success: true,
        data: {
          count: list.length,
          subagents: list.map((s) => ({
            id: s.id,
            title: s.title,
            type: s.type,
            status: s.status,
            progress: s.progress,
            durationMs: s.durationMs,
            result: s.result ? (s.result.length > 100 ? `${s.result.slice(0, 100)}...` : s.result) : undefined,
            error: s.error,
          })),
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error al listar subagentes: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

export class GetSubagentOutputTool extends BaseTool {
  readonly name = 'get_subagent_output';
  readonly description = 'Obtiene los logs detallados de terminal o el resultado generado por un subagente en segundo plano.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['agent:inspect'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      subagentId: {
        type: 'string',
        description: 'ID único del subagente a inspeccionar.',
      },
    },
    required: ['subagentId'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const subagentId = (args.subagentId as string)?.trim();
      if (!subagentId) {
        return { success: false, error: 'subagentId es requerido.' };
      }

      const manager = getSharedSubagentManager();
      const record = manager.getSubagent(subagentId);

      if (!record) {
        return { success: false, error: `No se encontró ningún subagente con el ID "${subagentId}".` };
      }

      return {
        success: true,
        data: {
          id: record.id,
          title: record.title,
          type: record.type,
          status: record.status,
          result: record.result,
          error: record.error,
          recentLogs: record.logs.slice(-20),
          totalLogsCount: record.logs.length,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error al consultar salida del subagente: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

export class CancelSubagentTool extends BaseTool {
  readonly name = 'cancel_subagent';
  readonly description = 'Cancela inmediatamente un subagente o proceso en segundo plano en ejecución.';
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions = ['agent:cancel'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      subagentId: {
        type: 'string',
        description: 'ID único del subagente que se desea cancelar.',
      },
    },
    required: ['subagentId'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const subagentId = (args.subagentId as string)?.trim();
      if (!subagentId) {
        return { success: false, error: 'subagentId es requerido.' };
      }

      const manager = getSharedSubagentManager();
      const cancelled = manager.cancelSubagent(subagentId);

      if (!cancelled) {
        return {
          success: false,
          error: `No se pudo cancelar el subagente "${subagentId}" (puede que no exista o que ya haya finalizado).`,
        };
      }

      return {
        success: true,
        data: {
          message: `El subagente [${subagentId}] fue cancelado exitosamente.`,
          subagentId,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error al cancelar subagente: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
