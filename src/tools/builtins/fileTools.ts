import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import fs from 'fs';
import path from 'path';

function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const resolved = path.isAbsolute(targetPath)
    ? path.normalize(targetPath)
    : path.normalize(path.join(workspaceRoot, targetPath));
  return resolved;
}

export class ListFilesTool extends BaseTool {
  readonly name = 'list_files';
  readonly description = 'Lista archivos y subdirectorios dentro de una ruta especificada.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['fs:read'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del directorio a inspeccionar (por defecto la raíz del proyecto).',
      },
      recursive: {
        type: 'boolean',
        description: 'Si es true, busca en subdirectorios hasta 2 niveles de profundidad.',
      },
    },
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const dirPath = resolveSafePath(context.workspaceRoot, (args.path as string) || '.');
    const recursive = Boolean(args.recursive);

    if (!fs.existsSync(dirPath)) {
      return { success: false, error: `Directory does not exist: ${dirPath}` };
    }

    try {
      const results: Array<{ name: string; isDirectory: boolean; size?: number; relativePath: string }> = [];

      const scan = (current: string, depth: number) => {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') {
            continue;
          }
          const full = path.join(current, entry.name);
          const isDir = entry.isDirectory();
          let size: number | undefined;

          if (!isDir) {
            try {
              size = fs.statSync(full).size;
            } catch {
              // ignore
            }
          }

          results.push({
            name: entry.name,
            isDirectory: isDir,
            size,
            relativePath: path.relative(dirPath, full),
          });

          if (isDir && recursive && depth < 2) {
            scan(full, depth + 1);
          }
        }
      };

      scan(dirPath, 0);

      return {
        success: true,
        data: {
          directory: dirPath,
          totalEntries: results.length,
          entries: results.slice(0, 100), // Max 100 entries for safety
        },
      };
    } catch (err: unknown) {
      return { success: false, error: `Failed to list files: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

export class ReadFileTool extends BaseTool {
  readonly name = 'read_file';
  readonly description = 'Lee el contenido de un archivo de texto.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['fs:read'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a leer.',
      },
      maxLines: {
        type: 'number',
        description: 'Número máximo de líneas a leer (opcional, por defecto 500).',
      },
    },
    required: ['path'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const filePath = resolveSafePath(context.workspaceRoot, args.path as string);
    const maxLines = typeof args.maxLines === 'number' ? args.maxLines : 500;

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 2 * 1024 * 1024) {
        return { success: false, error: `File is too large (${Math.round(stats.size / 1024)} KB). Max supported is 2MB.` };
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const truncated = lines.length > maxLines;
      const returnedContent = truncated ? lines.slice(0, maxLines).join('\n') : content;

      return {
        success: true,
        data: {
          path: filePath,
          totalLines: lines.length,
          truncated,
          content: returnedContent,
        },
      };
    } catch (err: unknown) {
      return { success: false, error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

export class WriteFileTool extends BaseTool {
  readonly name = 'write_file';
  readonly description = 'Crea o sobrescribe un archivo con el contenido especificado.';
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions = ['fs:write'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a crear o sobrescribir.',
      },
      content: {
        type: 'string',
        description: 'Contenido completo a escribir en el archivo.',
      },
    },
    required: ['path', 'content'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const filePath = resolveSafePath(context.workspaceRoot, args.path as string);
    const content = args.content as string;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      return {
        success: true,
        data: {
          path: filePath,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          message: `File written successfully at ${filePath}`,
        },
      };
    } catch (err: unknown) {
      return { success: false, error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

export class EditFileTool extends BaseTool {
  readonly name = 'edit_file';
  readonly description = 'Modifica un archivo existente reemplazando un texto específico con otro.';
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions = ['fs:write'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a modificar.',
      },
      targetText: {
        type: 'string',
        description: 'Texto exacto que se desea reemplazar.',
      },
      replacementText: {
        type: 'string',
        description: 'Nuevo texto con el cual reemplazar.',
      },
    },
    required: ['path', 'targetText', 'replacementText'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const filePath = resolveSafePath(context.workspaceRoot, args.path as string);
    const targetText = args.targetText as string;
    const replacementText = args.replacementText as string;

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes(targetText)) {
        return { success: false, error: `Target text was not found in ${filePath}. Check exact whitespace and content.` };
      }

      const updated = content.replace(targetText, replacementText);
      fs.writeFileSync(filePath, updated, 'utf-8');

      return {
        success: true,
        data: {
          path: filePath,
          message: 'File successfully modified',
        },
      };
    } catch (err: unknown) {
      return { success: false, error: `Failed to edit file: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

export class SearchFilesTool extends BaseTool {
  readonly name = 'search_files';
  readonly description = 'Busca archivos en el workspace que coincidan con un nombre o patrón.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['fs:read'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Término o extensión a buscar (ej: ".ts", "config", "test").',
      },
      path: {
        type: 'string',
        description: 'Directorio base donde buscar (por defecto la raíz).',
      },
    },
    required: ['query'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const root = resolveSafePath(context.workspaceRoot, (args.path as string) || '.');
    const query = (args.query as string).toLowerCase();
    const matches: string[] = [];

    const search = (dir: string, depth: number) => {
      if (depth > 5 || matches.length >= 50) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
          const full = path.join(dir, entry.name);
          if (entry.name.toLowerCase().includes(query)) {
            matches.push(path.relative(context.workspaceRoot, full));
          }
          if (entry.isDirectory()) {
            search(full, depth + 1);
          }
        }
      } catch {
        // ignore permission errors
      }
    };

    search(root, 0);

    return {
      success: true,
      data: {
        query,
        count: matches.length,
        results: matches,
      },
    };
  }
}

export class DeleteFileTool extends BaseTool {
  readonly name = 'delete_file';
  readonly description = 'Elimina un archivo del sistema de archivos. Acción de alto riesgo que requiere confirmación.';
  readonly riskLevel = RiskLevel.HIGH;
  readonly requiredPermissions = ['fs:delete'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a eliminar.',
      },
    },
    required: ['path'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const filePath = resolveSafePath(context.workspaceRoot, args.path as string);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    try {
      fs.unlinkSync(filePath);
      return {
        success: true,
        data: {
          path: filePath,
          message: 'File successfully deleted',
        },
      };
    } catch (err: unknown) {
      return { success: false, error: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
