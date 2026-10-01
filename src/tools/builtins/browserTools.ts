import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export class OpenUrlTool extends BaseTool {
  readonly name = 'open_url';
  readonly description = 'Abre una URL en el navegador predeterminado del sistema del usuario de forma VISIBLE (el usuario ve la página abrirse). Úsalo cuando el usuario pida "abrir", "buscar y abrir", "mostrar" o "ir a" una web en su navegador. Para scraping silencioso o extracción de contenido usa browse_web en su lugar.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['browser:open'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'La URL o página web a abrir (ej: "https://www.lanacion.com.ar" o "google.com").',
      },
    },
    required: ['url'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const rawUrl = (args.url as string) || '';

    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { success: false, error: 'URL parameter is required and cannot be empty.' };
    }

    let url = rawUrl.trim();
    // Auto-prefix protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    return new Promise((resolve) => {
      try {
        if (process.platform === 'win32') {
          // Use cmd /c start — the canonical Windows method to open URLs in the default browser.
          // PowerShell's Start-Process -FilePath does NOT work for URLs (it expects a file path).
          const child = spawn(
            'cmd.exe',
            ['/c', 'start', '""', url],
            { detached: true, stdio: 'ignore', windowsHide: true }
          );
          child.unref();

          let resolved = false;

          child.on('error', (err) => {
            if (resolved) return;
            resolved = true;
            resolve({ success: false, error: `Error al abrir el navegador: ${err.message}` });
          });

          child.on('close', (code) => {
            if (resolved) return;
            resolved = true;
            if (code === 0 || code === null) {
              resolve({
                success: true,
                data: { message: `URL abierta en el navegador del sistema: ${url}`, url },
              });
            } else {
              resolve({ success: false, error: `cmd /c start falló con código ${code}` });
            }
          });

          // Safety timeout in case neither event fires
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve({
                success: true,
                data: { message: `URL enviada al navegador del sistema: ${url}`, url },
              });
            }
          }, 1500);
        } else if (process.platform === 'darwin') {
          const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
          child.unref();
          child.on('error', (err) => resolve({ success: false, error: err.message }));
          setTimeout(() => resolve({ success: true, data: { message: `URL opened: ${url}`, url } }), 200);
        } else {
          const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
          child.unref();
          child.on('error', (err) => resolve({ success: false, error: err.message }));
          setTimeout(() => resolve({ success: true, data: { message: `URL opened: ${url}`, url } }), 200);
        }
      } catch (err: unknown) {
        resolve({ success: false, error: `Error launching browser: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  }
}

export class OpenApplicationTool extends BaseTool {
  readonly name = 'open_application';
  readonly description = 'Abre una aplicación instalada en el sistema (ej: "vs code", "cursor", "notepad", "calc", "chrome", "mspaint").';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['app:open'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      appName: {
        type: 'string',
        description: 'Nombre del ejecutable o aplicación a abrir (ej: "code", "cursor", "notepad", "calc").',
      },
      args: {
        type: 'string',
        description: 'Argumentos adicionales para la aplicación o archivo a abrir con ella (opcional).',
      },
    },
    required: ['appName'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const rawAppName = (args.appName as string) || '';
    const extraArgs = (args.args as string) || '';

    if (!rawAppName || typeof rawAppName !== 'string' || !rawAppName.trim()) {
      return { success: false, error: 'appName parameter is required.' };
    }

    const { target, note, notFound } = this.resolveApplication(rawAppName.trim());
    if (notFound) {
      return {
        success: false,
        error: `No se encontró la aplicación "${rawAppName}" instalada en el sistema.`,
      };
    }

    return new Promise((resolve) => {
      try {
        if (process.platform === 'win32') {
          // On Windows, use cmd /c start to support .exe, .cmd, .bat, and shell shortcuts
          const cmdArgs = ['/c', 'start', '""', target];
          if (extraArgs.trim()) {
            cmdArgs.push(extraArgs.trim());
          }

          const child = spawn('cmd.exe', cmdArgs, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          child.unref();

          child.on('error', (err) => {
            resolve({ success: false, error: `Failed to start application ${rawAppName}: ${err.message}` });
          });

          setTimeout(() => {
            const msg = note
              ? note
              : `Aplicación "${rawAppName}" iniciada correctamente.`;
            resolve({
              success: true,
              data: {
                message: msg,
                app: target,
                note,
              },
            });
          }, 350);
        } else {
          const child = spawn(target, extraArgs ? extraArgs.split(' ') : [], { detached: true, stdio: 'ignore' });
          child.unref();
          child.on('error', (err) => {
            resolve({ success: false, error: `Failed to start application: ${err.message}` });
          });
          setTimeout(() => {
            resolve({ success: true, data: { message: `Application ${rawAppName} launched successfully.` } });
          }, 300);
        }
      } catch (err: unknown) {
        resolve({ success: false, error: `Launch error: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  }

  private resolveApplication(appName: string): { target: string; note?: string; notFound?: boolean } {
    if (process.platform !== 'win32') {
      return { target: appName };
    }

    const norm = appName.trim().toLowerCase();

    // Map common names and aliases
    const aliases: Record<string, string[]> = {
      code: ['code', 'cursor', 'windsurf'],
      vscode: ['code', 'cursor', 'windsurf'],
      'vs code': ['code', 'cursor', 'windsurf'],
      'visual studio code': ['code', 'cursor', 'windsurf'],
      cursor: ['cursor'],
      windsurf: ['windsurf'],
      notepad: ['notepad'],
      'bloc de notas': ['notepad'],
      calc: ['calc'],
      calculadora: ['calc'],
      chrome: ['chrome'],
      'google chrome': ['chrome'],
      edge: ['msedge'],
      'microsoft edge': ['msedge'],
      brave: ['brave'],
      firefox: ['firefox'],
      explorer: ['explorer'],
      'explorador de archivos': ['explorer'],
      terminal: ['powershell', 'wt', 'cmd'],
      spotify: ['spotify'],
      discord: ['discord'],
    };

    const candidates = aliases[norm] || [norm];

    // Try finding candidate in PATH via where.exe
    for (const candidate of candidates) {
      try {
        const out = execSync(`where ${candidate}`, { encoding: 'utf-8', windowsHide: true });
        const first = out.trim().split('\n')[0]?.trim();
        if (first) {
          let note: string | undefined;
          if (candidate !== norm && (norm.includes('code') || norm.includes('vs'))) {
            note = `Visual Studio Code no está en PATH, pero se abrió ${candidate} (editor disponible).`;
          }
          return { target: first, note };
        }
      } catch {
        // Not found, continue
      }
    }

    // Try known direct file paths
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\' + (process.env.USERNAME || 'user');
    const directPaths: Record<string, string[]> = {
      code: [
        path.join(userProfile, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        path.join(userProfile, 'AppData', 'Local', 'Programs', 'cursor', 'Cursor.exe'),
        path.join(userProfile, 'AppData', 'Local', 'Programs', 'Windsurf', 'Windsurf.exe'),
      ],
      cursor: [
        path.join(userProfile, 'AppData', 'Local', 'Programs', 'cursor', 'Cursor.exe'),
      ],
      windsurf: [
        path.join(userProfile, 'AppData', 'Local', 'Programs', 'Windsurf', 'Windsurf.exe'),
      ],
    };

    const directList = directPaths[norm] || [];
    for (const p of directList) {
      if (fs.existsSync(p)) {
        let note: string | undefined;
        if (norm.includes('code') && !p.toLowerCase().includes('microsoft vs code')) {
          note = `Se abrió ${path.basename(p, '.exe')} como editor de código instalado en el sistema.`;
        }
        return { target: p, note };
      }
    }

    // If candidate isn't in PATH but might be a registered system verb or app (e.g., mspaint, taskmgr)
    return { target: norm };
  }
}
