import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { spawn } from 'child_process';

/**
 * Helper to run a PowerShell script safely via UTF-16LE Base64 -EncodedCommand
 */
function runPowerShellScript(script: string, timeoutMs: number = 6000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const fullScript = `$ProgressPreference = 'SilentlyContinue'\n${script}`;
    const encoded = Buffer.from(fullScript, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve({ stdout, stderr: 'Execution timed out', code: -1 });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: -1 });
    });
  });
}

export class InputSimulationTool extends BaseTool {
  readonly name = 'simulate_input';
  readonly description =
    'Simula interacción humana de teclado y mouse en el sistema operativo: tipear texto en la ventana activa, pulsar teclas o atajos (Enter, Esc, Ctrl+S, Alt+F4, etc.), mover el mouse y hacer clics (izquierdo, derecho, doble clic).';
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions = ['system:input'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['type_text', 'press_key', 'click', 'move_mouse'],
        description:
          'Acción a realizar: "type_text" (tipear texto en la app activa), "press_key" (pulsar tecla o atajo), "click" (hacer clic de mouse), "move_mouse" (mover cursor).',
      },
      text: {
        type: 'string',
        description: 'Texto a tipear en la ventana activa (requerido para "type_text").',
      },
      key: {
        type: 'string',
        description:
          'Tecla o atajo a presionar (requerido para "press_key"). Ejemplos: "enter", "esc", "tab", "backspace", "space", "ctrl+s", "ctrl+c", "ctrl+v", "ctrl+a", "alt+f4", "alt+tab", "up", "down", "left", "right".',
      },
      button: {
        type: 'string',
        enum: ['left', 'right', 'double'],
        description: 'Botón del mouse a accionar para "click" (default: "left").',
      },
      x: {
        type: 'number',
        description: 'Coordenada horizontal X en píxeles de pantalla (opcional para "click" y "move_mouse").',
      },
      y: {
        type: 'number',
        description: 'Coordenada vertical Y en píxeles de pantalla (opcional para "click" y "move_mouse").',
      },
      delayMs: {
        type: 'number',
        description: 'Pausa en milisegundos antes de ejecutar la acción (opcional, útil para dar tiempo de foco).',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const text = (args.text as string) || '';
    const key = (args.key as string) || '';
    const button = (args.button as string) || 'left';
    const x = args.x !== undefined ? Number(args.x) : null;
    const y = args.y !== undefined ? Number(args.y) : null;
    const delay = Math.max(Number(args.delayMs) || 100, 0);

    if (process.platform !== 'win32') {
      return { success: false, error: `Simulación de input no soportada en: ${process.platform}` };
    }

    try {
      if (action === 'type_text') {
        if (!text) {
          return { success: false, error: 'Se requiere el parámetro "text" para la acción "type_text".' };
        }

        // Escape SendKeys special characters: +, ^, %, ~, (, ), [, ], {, }
        const escaped = text
          .replace(/\{/g, '{{}')
          .replace(/\}/g, '{}}')
          .replace(/\+/g, '{+}')
          .replace(/\^/g, '{^}')
          .replace(/%/g, '{%}')
          .replace(/~/g, '{~}')
          .replace(/\(/g, '{(}')
          .replace(/\)/g, '{)}')
          .replace(/\[/g, '{[}')
          .replace(/\]/g, '{]}');

        const script = `
          Start-Sleep -Milliseconds ${delay}
          $wsh = New-Object -ComObject WScript.Shell
          $wsh.SendKeys(@'
${escaped}
'@)
        `;

        const { code, stderr } = await runPowerShellScript(script);
        if (code !== 0) {
          return { success: false, error: `Fallo al tipear texto: ${stderr}` };
        }

        return {
          success: true,
          data: {
            message: `Texto tipeado exitosamente (${text.length} caracteres).`,
            preview: text.length > 60 ? text.substring(0, 60) + '...' : text,
          },
        };
      }

      if (action === 'press_key') {
        if (!key) {
          return { success: false, error: 'Se requiere el parámetro "key" para la acción "press_key".' };
        }

        const sendKeySequence = this.mapSpecialKey(key.trim());
        if (!sendKeySequence) {
          return { success: false, error: `Tecla o combinación no reconocida: "${key}"` };
        }

        const script = `
          Start-Sleep -Milliseconds ${delay}
          $wsh = New-Object -ComObject WScript.Shell
          $wsh.SendKeys('${sendKeySequence}')
        `;

        const { code, stderr } = await runPowerShellScript(script);
        if (code !== 0) {
          return { success: false, error: `Fallo al presionar tecla: ${stderr}` };
        }

        return {
          success: true,
          data: {
            message: `Tecla/combinación "${key}" ejecutada correctamente.`,
            sequence: sendKeySequence,
          },
        };
      }

      if (action === 'move_mouse' || action === 'click') {
        let mouseMoveCode = '';
        if (x !== null && y !== null) {
          mouseMoveCode = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
          `;
        }

        let clickCode = '';
        if (action === 'click') {
          // mouse_event constants:
          // MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004
          // MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010
          let downFlag = 0x0002;
          let upFlag = 0x0004;
          let isDouble = button === 'double';

          if (button === 'right') {
            downFlag = 0x0008;
            upFlag = 0x0010;
          }

          clickCode = `
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class MouseSim {
                [DllImport("user32.dll", SetLastError = true)]
                public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
            }
"@
            Start-Sleep -Milliseconds 50
            [MouseSim]::mouse_event(${downFlag}, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 30
            [MouseSim]::mouse_event(${upFlag}, 0, 0, 0, 0)
            ${
              isDouble
                ? `
            Start-Sleep -Milliseconds 80
            [MouseSim]::mouse_event(${downFlag}, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 30
            [MouseSim]::mouse_event(${upFlag}, 0, 0, 0, 0)
            `
                : ''
            }
          `;
        }

        const script = `
          Start-Sleep -Milliseconds ${delay}
          ${mouseMoveCode}
          ${clickCode}
        `;

        const { code, stderr } = await runPowerShellScript(script);
        if (code !== 0) {
          return { success: false, error: `Fallo en acción de mouse: ${stderr}` };
        }

        const details =
          action === 'click'
            ? `Clic (${button}) ejecutado correctamente${x !== null && y !== null ? ` en posición (${x}, ${y})` : ''}.`
            : `Cursor desplazado a (${x}, ${y}).`;

        return { success: true, data: { message: details, action, x, y, button } };
      }

      return { success: false, error: `Acción no reconocida: ${action}` };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error en simulación de input: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private mapSpecialKey(key: string): string | null {
    const k = key.toLowerCase().trim();

    // Map common shortcuts
    if (k === 'enter' || k === 'return') return '{ENTER}';
    if (k === 'esc' || k === 'escape') return '{ESC}';
    if (k === 'tab') return '{TAB}';
    if (k === 'backspace') return '{BACKSPACE}';
    if (k === 'delete' || k === 'del') return '{DELETE}';
    if (k === 'space') return ' ';
    if (k === 'up') return '{UP}';
    if (k === 'down') return '{DOWN}';
    if (k === 'left') return '{LEFT}';
    if (k === 'right') return '{RIGHT}';
    if (k === 'home') return '{HOME}';
    if (k === 'end') return '{END}';
    if (k === 'pageup' || k === 'pgup') return '{PGUP}';
    if (k === 'pagedown' || k === 'pgdn') return '{PGDN}';
    if (k === 'f1') return '{F1}';
    if (k === 'f2') return '{F2}';
    if (k === 'f3') return '{F3}';
    if (k === 'f4') return '{F4}';
    if (k === 'f5') return '{F5}';
    if (k === 'f6') return '{F6}';
    if (k === 'f7') return '{F7}';
    if (k === 'f8') return '{F8}';
    if (k === 'f9') return '{F9}';
    if (k === 'f10') return '{F10}';
    if (k === 'f11') return '{F11}';
    if (k === 'f12') return '{F12}';

    // Key Combinations
    // Ctrl + key
    if (k.startsWith('ctrl+') || k.startsWith('control+')) {
      const sub = k.split('+')[1]?.trim();
      if (!sub) return null;
      if (sub.length === 1) return `^${sub.toLowerCase()}`;
      const mapped = this.mapSpecialKey(sub);
      return mapped ? `^${mapped}` : null;
    }

    // Alt + key
    if (k.startsWith('alt+')) {
      const sub = k.split('+')[1]?.trim();
      if (!sub) return null;
      if (sub === 'f4') return '%{F4}';
      if (sub === 'tab') return '%{TAB}';
      if (sub.length === 1) return `%${sub.toLowerCase()}`;
      const mapped = this.mapSpecialKey(sub);
      return mapped ? `%${mapped}` : null;
    }

    // Shift + key
    if (k.startsWith('shift+')) {
      const sub = k.split('+')[1]?.trim();
      if (!sub) return null;
      if (sub.length === 1) return `+${sub.toUpperCase()}`;
      const mapped = this.mapSpecialKey(sub);
      return mapped ? `+${mapped}` : null;
    }

    // Ctrl + Shift + key
    if (k.startsWith('ctrl+shift+') || k.startsWith('control+shift+')) {
      const sub = k.split('+')[2]?.trim();
      if (!sub) return null;
      return `^+${sub.toLowerCase()}`;
    }

    // If single character
    if (k.length === 1) return k;

    return null;
  }
}
