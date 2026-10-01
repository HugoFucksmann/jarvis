import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { getSharedScheduler } from '../../scheduler/TaskScheduler.js';
import { PriorityLevel, RecurrenceType } from '../../scheduler/types.js';

export class ScheduleTaskTool extends BaseTool {
  readonly name = 'manage_schedule';
  readonly description =
    'Gestiona la agenda, recordatorios, temporizadores de tiempo relativo o absoluto, notas fijadas y tareas programadas de JARVIS. Permite programar avisos que notificarán al usuario por voz, notificación Toast nativa del SO y en el HUD cuando venza el tiempo, así como consultar la lista de pendientes, completarlos o posponerlos.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:schedule'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: [
          'create_reminder',
          'list_reminders',
          'complete_reminder',
          'snooze_reminder',
          'cancel_reminder',
          'create_note',
          'list_notes',
          'delete_note',
        ],
        description:
          'Acción a realizar: "create_reminder" (crear recordatorio/alarma), "list_reminders" (ver pendientes), "complete_reminder" (marcar como hecho), "snooze_reminder" (posponer), "cancel_reminder" (eliminar alarma), "create_note" (guardar nota rápida), "list_notes" (ver notas), "delete_note" (borrar nota).',
      },
      title: {
        type: 'string',
        description: 'Título o concepto del recordatorio/nota (ej: "Sacar pizza del horno", "Reunión con el equipo", "Comprar café").',
      },
      message: {
        type: 'string',
        description: 'Detalle o descripción adicional del recordatorio (opcional).',
      },
      delayMinutes: {
        type: 'number',
        description: 'Tiempo relativo en minutos a partir de ahora (ej: 15 para "en 15 minutos", 60 para "en una hora").',
      },
      time: {
        type: 'string',
        description: 'Hora fija para el recordatorio en formato "HH:mm" (ej: "18:30", "09:00") o fecha ISO.',
      },
      reminderId: {
        type: 'string',
        description: 'Identificador del recordatorio (requerido para "complete_reminder", "snooze_reminder", "cancel_reminder").',
      },
      snoozeMinutes: {
        type: 'number',
        description: 'Minutos a posponer para la acción "snooze_reminder" (por defecto: 5 minutos).',
      },
      priority: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'critical'],
        description: 'Nivel de prioridad del aviso (por defecto: "normal").',
      },
      recurring: {
        type: 'string',
        enum: ['hourly', 'daily', 'weekly'],
        description: 'Patrón de repetición opcional para recordatorios recurrentes ("hourly", "daily", "weekly").',
      },
      actionCommand: {
        type: 'string',
        description: 'Comando de agente o acción diferida opcional a ejecutar automáticamente cuando venza el temporizador.',
      },
      noteContent: {
        type: 'string',
        description: 'Cuerpo o texto de la nota (requerido para "create_note").',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const scheduler = getSharedScheduler();

    try {
      if (action === 'create_reminder') {
        const title = ((args.title as string) || '').trim();
        if (!title) {
          return { success: false, error: 'Se requiere el parámetro "title" para crear un recordatorio.' };
        }

        const delayMinutes = args.delayMinutes !== undefined ? Number(args.delayMinutes) : undefined;
        const time = args.time as string | undefined;

        const reminder = scheduler.createReminder({
          title,
          message: (args.message as string) || undefined,
          delayMinutes,
          time,
          priority: (args.priority as PriorityLevel) || 'normal',
          recurring: (args.recurring as RecurrenceType) || undefined,
          actionCommand: (args.actionCommand as string) || undefined,
        });

        const dueFormatted = new Date(reminder.dueAt).toLocaleString();

        return {
          success: true,
          data: {
            message: `Recordatorio programado con éxito: "${reminder.title}" para el ${dueFormatted}.`,
            reminder,
          },
        };
      }

      if (action === 'list_reminders') {
        const reminders = scheduler.listReminders({ completed: false });
        const completedReminders = scheduler.listReminders({ completed: true, limit: 5 });

        return {
          success: true,
          data: {
            count: reminders.length,
            pending: reminders,
            recentCompleted: completedReminders,
          },
        };
      }

      if (action === 'complete_reminder') {
        const id = (args.reminderId as string) || '';
        if (!id) return { success: false, error: 'Se requiere "reminderId" para completar.' };

        const ok = scheduler.completeReminder(id);
        if (!ok) return { success: false, error: `No se encontró el recordatorio con id: ${id}` };

        return {
          success: true,
          data: { message: `Recordatorio [${id}] marcado como completado.` },
        };
      }

      if (action === 'snooze_reminder') {
        const id = (args.reminderId as string) || '';
        const minutes = Number(args.snoozeMinutes) || 5;
        if (!id) return { success: false, error: 'Se requiere "reminderId" para posponer.' };

        const updated = scheduler.snoozeReminder(id, minutes);
        if (!updated) return { success: false, error: `No se encontró el recordatorio con id: ${id}` };

        return {
          success: true,
          data: {
            message: `Recordatorio pospuesto por ${minutes} minutos. Nueva hora: ${new Date(updated.dueAt).toLocaleTimeString()}.`,
            reminder: updated,
          },
        };
      }

      if (action === 'cancel_reminder') {
        const id = (args.reminderId as string) || '';
        if (!id) return { success: false, error: 'Se requiere "reminderId" para cancelar.' };

        const ok = scheduler.deleteReminder(id);
        if (!ok) return { success: false, error: `No se encontró el recordatorio con id: ${id}` };

        return {
          success: true,
          data: { message: `Recordatorio [${id}] cancelado y eliminado.` },
        };
      }

      if (action === 'create_note') {
        const title = ((args.title as string) || '').trim() || 'Nota sin título';
        const content = ((args.noteContent as string) || (args.message as string) || '').trim();
        if (!content) {
          return { success: false, error: 'Se requiere contenido de la nota ("noteContent" o "message").' };
        }

        const note = scheduler.addNote(title, content);
        return {
          success: true,
          data: {
            message: `Nota guardada exitosamente: "${note.title}".`,
            note,
          },
        };
      }

      if (action === 'list_notes') {
        const notes = scheduler.listNotes();
        return {
          success: true,
          data: {
            count: notes.length,
            notes,
          },
        };
      }

      if (action === 'delete_note') {
        const id = (args.reminderId as string) || (args.title as string) || '';
        const ok = scheduler.deleteNote(id);
        return {
          success: ok,
          data: { message: ok ? `Nota [${id}] eliminada.` : `No se encontró la nota [${id}].` },
        };
      }

      return {
        success: false,
        error: `Acción no reconocida en manage_schedule: ${action}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error en agenda y recordatorios: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
