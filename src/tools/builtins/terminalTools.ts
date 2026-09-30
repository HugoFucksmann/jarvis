import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { spawn } from 'child_process';

export class RunCommandTool extends BaseTool {
  readonly name = 'run_command';
  readonly description = 'Ejecuta un comando en la terminal del sistema (PowerShell en Windows) de forma segura y devuelve su salida.';
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions = ['terminal:execute'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'El comando exacto a ejecutar en la terminal.',
      },
      cwd: {
        type: 'string',
        description: 'Directorio de trabajo donde ejecutar el comando (opcional).',
      },
      timeoutSeconds: {
        type: 'number',
        description: 'Tiempo límite de ejecución en segundos (por defecto 30).',
      },
    },
    required: ['command'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const command = args.command as string;
    const workingDir = (args.cwd as string) || context.workspaceRoot;
    const timeoutMs = ((args.timeoutSeconds as number) || 30) * 1000;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Use PowerShell on Windows
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: process.env,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        resolve({
          success: false,
          error: `Command timed out after ${timeoutMs / 1000} seconds. Partial stdout: ${stdout.slice(-1000)}`,
        });
      }, timeoutMs);

      if (context.signal) {
        context.signal.addEventListener('abort', () => {
          child.kill();
          clearTimeout(timer);
          resolve({
            success: false,
            error: 'Command execution aborted by user or timeout signal.',
          });
        });
      }

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
        // Limit stdout to avoid memory explosion
        if (stdout.length > 50000) {
          stdout = stdout.slice(-50000);
        }
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 20000) {
          stderr = stderr.slice(-20000);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          error: `Process spawning error: ${err.message}`,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        resolve({
          success: code === 0,
          data: {
            command,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          },
          error: code !== 0 ? `Command exited with status code ${code}` : undefined,
        });
      });
    });
  }
}

export class GetProcessesTool extends BaseTool {
  readonly name = 'get_processes';
  readonly description = 'Obtiene la lista de procesos en ejecución en el sistema, permitiendo filtrar por nombre.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:processes'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      filter: {
        type: 'string',
        description: 'Nombre o parte del nombre del proceso a buscar (opcional, ej: "node", "chrome").',
      },
      limit: {
        type: 'number',
        description: 'Número máximo de procesos a devolver (por defecto 20).',
      },
    },
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const filter = (args.filter as string) || '';
    const limit = (args.limit as number) || 20;

    const command = filter
      ? `Get-Process | Where-Object { $_.ProcessName -like "*${filter}*" } | Select-Object -First ${limit} -Property Id, ProcessName, WorkingSet64, CPU | ConvertTo-Json`
      : `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${limit} -Property Id, ProcessName, WorkingSet64, CPU | ConvertTo-Json`;

    const runner = new RunCommandTool();
    const result = await runner.execute({ command, timeoutSeconds: 10 }, context);

    if (!result.success) {
      return result;
    }

    try {
      const output = (result.data as { stdout: string }).stdout;
      if (!output) {
        return { success: true, data: { count: 0, processes: [] } };
      }
      const parsed = JSON.parse(output);
      const list = Array.isArray(parsed) ? parsed : [parsed];

      const formatted = list.map((p: { Id: number; ProcessName: string; WorkingSet64: number; CPU?: number }) => ({
        id: p.Id,
        name: p.ProcessName,
        memoryMB: Math.round(p.WorkingSet64 / (1024 * 1024)),
        cpu: p.CPU ? Math.round(p.CPU * 10) / 10 : undefined,
      }));

      return {
        success: true,
        data: {
          count: formatted.length,
          processes: formatted,
        },
      };
    } catch {
      return {
        success: true,
        data: { raw: (result.data as { stdout: string }).stdout },
      };
    }
  }
}
