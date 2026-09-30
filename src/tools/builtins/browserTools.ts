import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { exec } from 'child_process';

export class OpenUrlTool extends BaseTool {
  readonly name = 'open_url';
  readonly description = 'Abre una dirección URL en el navegador predeterminado del sistema.';
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions = ['browser:open'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'La URL completa que se desea abrir (debe comenzar con http:// o https://).',
      },
    },
    required: ['url'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const url = args.url as string;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, error: 'URL must start with http:// or https://' };
    }

    return new Promise((resolve) => {
      const cmd = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;

      exec(cmd, (error) => {
        if (error) {
          resolve({ success: false, error: `Failed to open URL: ${error.message}` });
        } else {
          resolve({ success: true, data: { message: `URL opened in browser: ${url}` } });
        }
      });
    });
  }
}

export class OpenApplicationTool extends BaseTool {
  readonly name = 'open_application';
  readonly description = 'Abre una aplicación instalada en el sistema (ej: notepad, calc, code, mspaint).';
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions = ['app:open'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      appName: {
        type: 'string',
        description: 'Nombre del ejecutable o aplicación a abrir (ej: "notepad", "calc", "code").',
      },
      args: {
        type: 'string',
        description: 'Argumentos adicionales para la aplicación (opcional).',
      },
    },
    required: ['appName'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const appName = args.appName as string;
    const extraArgs = (args.args as string) || '';

    return new Promise((resolve) => {
      const cmd = process.platform === 'win32'
        ? `powershell -Command "Start-Process '${appName}' ${extraArgs ? `'${extraArgs}'` : ''}"`
        : `${appName} ${extraArgs}`;

      exec(cmd, (error) => {
        if (error) {
          resolve({ success: false, error: `Failed to start application ${appName}: ${error.message}` });
        } else {
          resolve({ success: true, data: { message: `Application ${appName} launched successfully.` } });
        }
      });
    });
  }
}
