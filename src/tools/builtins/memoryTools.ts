import fs from 'fs';
import path from 'path';
import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';

export class ManageMemoryTool extends BaseTool {
  readonly name = 'manage_memory';
  readonly description =
    'Lee, actualiza o añade notas a la memoria general persistente de JARVIS (.jarvis/MEMORY.md). Úsala para recordar preferencias del usuario, detalles de proyectos o notas permanentes a través de todos los chats.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = [];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'append', 'overwrite'],
        description: 'Acción a realizar: "read" (leer memoria actual), "append" (añadir nota o hecho), "overwrite" (reescribir contenido completo).',
      },
      content: {
        type: 'string',
        description: 'Texto a añadir o nuevo contenido para la memoria (requerido para "append" u "overwrite").',
      },
      section: {
        type: 'string',
        description: 'Sección opcional bajo la cual añadir la nota (ej. "Preferencias", "Proyectos", "Notas").',
      },
    },
    required: ['action'],
  };

  private memoryPath(workspaceRoot: string): string {
    const jarvisDir = path.join(workspaceRoot, '.jarvis');
    if (!fs.existsSync(jarvisDir)) {
      fs.mkdirSync(jarvisDir, { recursive: true });
    }
    return path.join(jarvisDir, 'MEMORY.md');
  }

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const content = (args.content as string) || '';
    const section = (args.section as string) || '';
    const file = this.memoryPath(context.workspaceRoot);

    try {
      if (action === 'read') {
        if (!fs.existsSync(file)) {
          return { success: true, data: { text: 'La memoria general aún está vacía.' } };
        }
        const current = fs.readFileSync(file, 'utf-8');
        return { success: true, data: { content: current } };
      }

      if (action === 'append') {
        if (!content.trim()) {
          return { success: false, error: 'Se requiere el parámetro "content" para añadir información.' };
        }

        let existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '# J.A.R.V.I.S. — Memoria General Persistente\n';
        const formatted = section
          ? `\n### ${section}\n- ${content.trim()}\n`
          : `\n- ${content.trim()}\n`;

        fs.writeFileSync(file, existing + formatted, 'utf-8');
        return {
          success: true,
          data: {
            message: `Información guardada exitosamente en la memoria general persistente (${file}). Se recordará en todos los chats futuros.`,
          },
        };
      }

      if (action === 'overwrite') {
        if (!content.trim()) {
          return { success: false, error: 'Se requiere el contenido para sobrescribir la memoria.' };
        }
        fs.writeFileSync(file, content, 'utf-8');
        return { success: true, data: { message: 'Memoria general actualizada por completo.' } };
      }

      return { success: false, error: `Acción no reconocida: ${action}` };
    } catch (err: unknown) {
      return { success: false, error: `Error gestionando memoria: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
