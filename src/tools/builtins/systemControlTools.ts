import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Clipboard Tool
// ─────────────────────────────────────────────────────────────────────────────
export class ClipboardTool extends BaseTool {
  readonly name = 'manage_clipboard';
  readonly description =
    'Lee o modifica el contenido del portapapeles del sistema del usuario. Úsalo para obtener lo que el usuario copió recientemente o para colocar código, enlaces o texto directamente en su portapapeles.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:clipboard'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set', 'clear'],
        description: 'Acción a realizar: "get" (leer portapapeles), "set" (copiar texto nuevo), "clear" (vaciar).',
      },
      text: {
        type: 'string',
        description: 'Texto que se desea colocar en el portapapeles (requerido para "set").',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const text = (args.text as string) || '';

    try {
      if (process.platform === 'win32') {
        if (action === 'get') {
          const { stdout } = await execAsync('powershell -NoProfile -Command "Get-Clipboard"', {
            encoding: 'utf-8',
            timeout: 5000,
          });
          const content = stdout.trim();
          return {
            success: true,
            data: {
              content: content || '(El portapapeles está vacío o no contiene texto)',
              length: content.length,
            },
          };
        }

        if (action === 'set') {
          if (!text) {
            return { success: false, error: 'Se requiere el parámetro "text" para la acción "set".' };
          }
          // Use stdin pipe with Set-Clipboard to avoid escaping issues with complex characters
          return new Promise((resolve) => {
            const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Set-Clipboard'], {
              windowsHide: true,
            });
            child.stdin.write(text, 'utf-8');
            child.stdin.end();
            child.on('close', (code) => {
              if (code === 0) {
                resolve({
                  success: true,
                  data: {
                    message: 'Texto copiado exitosamente al portapapeles del sistema.',
                    preview: text.length > 80 ? text.substring(0, 80) + '...' : text,
                  },
                });
              } else {
                resolve({ success: false, error: `Error estableciendo portapapeles (código ${code})` });
              }
            });
            child.on('error', (err) => {
              resolve({ success: false, error: `Error en proceso de portapapeles: ${err.message}` });
            });
          });
        }

        if (action === 'clear') {
          await execAsync('powershell -NoProfile -Command "Set-Clipboard -Value $null"');
          return { success: true, data: { message: 'Portapapeles vaciado correctamente.' } };
        }
      } else {
        return { success: false, error: `Plataforma no soportada para portapapeles: ${process.platform}` };
      }

      return { success: false, error: `Acción no reconocida: ${action}` };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error gestionando portapapeles: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Volume Control Tool
// ─────────────────────────────────────────────────────────────────────────────
export class VolumeControlTool extends BaseTool {
  readonly name = 'control_volume';
  readonly description =
    'Controla el volumen de audio maestro del sistema: subir volumen, bajar volumen, o silenciar/desmutear (mute/unmute).';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:audio'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['up', 'down', 'mute', 'unmute'],
        description: 'Acción a realizar: "up" (subir volumen), "down" (bajar volumen), "mute" (silenciar), "unmute" (activar sonido).',
      },
      steps: {
        type: 'number',
        description: 'Cantidad de pasos a subir o bajar (cada paso representa aprox. 2% de volumen, default: 5 pasos = ~10%).',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const steps = Math.min(Math.max(Number(args.steps) || 5, 1), 50);

    try {
      if (process.platform === 'win32') {
        let charCode: number;
        let loopCount = 1;

        if (action === 'up') {
          charCode = 175; // VK_VOLUME_UP
          loopCount = steps;
        } else if (action === 'down') {
          charCode = 174; // VK_VOLUME_DOWN
          loopCount = steps;
        } else if (action === 'mute' || action === 'unmute') {
          charCode = 173; // VK_VOLUME_MUTE
          loopCount = 1;
        } else {
          return { success: false, error: `Acción no válida: ${action}` };
        }

        const script = `
          $w = New-Object -ComObject WScript.Shell
          for ($i = 0; $i -lt ${loopCount}; $i++) {
            $w.SendKeys([char]${charCode})
            Start-Sleep -Milliseconds 20
          }
        `;

        await execAsync(`powershell -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, {
          timeout: 5000,
        });

        const actionText =
          action === 'up'
            ? `Volumen incrementado en ~${steps * 2}%.`
            : action === 'down'
            ? `Volumen reducido en ~${steps * 2}%.`
            : 'Estado de silencio conmutado.';

        return { success: true, data: { message: actionText, action, steps } };
      }

      return { success: false, error: `Plataforma no soportada para audio: ${process.platform}` };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error controlando volumen: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Notification Tool
// ─────────────────────────────────────────────────────────────────────────────
export class NotificationTool extends BaseTool {
  readonly name = 'send_notification';
  readonly description =
    'Envía una notificación Toast nativa al escritorio de Windows del usuario con sonido de sistema. Úsala para notificar avisos importantes, recordatorios o cuando finalice una tarea relevante.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:notification'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'Cuerpo del mensaje de la notificación.',
      },
      title: {
        type: 'string',
        description: 'Título de la notificación (opcional, default: "J.A.R.V.I.S.").',
      },
    },
    required: ['message'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const rawMessage = (args.message as string) || '';
    const title = (args.title as string) || 'J.A.R.V.I.S.';

    if (!rawMessage.trim()) {
      return { success: false, error: 'El parámetro "message" no puede estar vacío.' };
    }

    try {
      if (process.platform === 'win32') {
        const cleanTitle = title.replace(/'/g, "''");
        const cleanMsg = rawMessage.trim().replace(/'/g, "''");

        const psScript = `
          [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
          $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
          $xml = [xml]$template.GetXml()
          $xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${cleanTitle}')) | Out-Null
          $xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('${cleanMsg}')) | Out-Null
          $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
          $doc.LoadXml($xml.OuterXml)
          $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
          [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('JARVIS').Show($toast)
        `;

        await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, ' ')}"`, {
          timeout: 6000,
        });

        return {
          success: true,
          data: {
            message: `Notificación enviada con éxito: "${title} - ${rawMessage}"`,
          },
        };
      }

      return { success: false, error: `Plataforma no soportada para notificaciones: ${process.platform}` };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error enviando notificación: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. System Power & Session Tool
// ─────────────────────────────────────────────────────────────────────────────
export class SystemPowerTool extends BaseTool {
  readonly name = 'manage_power';
  readonly description =
    'Administra la sesión y el estado de energía del equipo: bloquear pantalla ("lock"), suspender ("sleep"), reiniciar ("restart") o apagar ("shutdown"). Las acciones destructivas o de reinicio/apagado exigen autorización previa del usuario.';
  readonly riskLevel = RiskLevel.HIGH;
  readonly requiredPermissions = ['system:power'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['lock', 'sleep', 'restart', 'shutdown'],
        description: 'Acción de energía a ejecutar: "lock" (bloquear pantalla), "sleep" (suspender equipo), "restart" (reiniciar), "shutdown" (apagar).',
      },
      delaySeconds: {
        type: 'number',
        description: 'Segundos de gracia antes del apagado o reinicio (opcional, default 30).',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const delay = Math.max(Number(args.delaySeconds) || 30, 0);

    try {
      if (process.platform === 'win32') {
        if (action === 'lock') {
          // Bloquear pantalla es seguro y reversible inmediatamente por el usuario
          await execAsync('rundll32.exe user32.dll,LockWorkStation');
          return {
            success: true,
            data: { message: 'Estación de trabajo bloqueada exitosamente.' },
          };
        }

        // Acciones críticas exigen aprobación explícita si el requestApproval está disponible
        if (context.requestApproval) {
          const approved = await context.requestApproval(
            this.name,
            args,
            RiskLevel.HIGH,
            `Se solicitó ejecutar la acción de energía del sistema: "${action.toUpperCase()}". Esta acción cerrará programas y sesiones.`
          );
          if (!approved) {
            return {
              success: false,
              error: `La acción de energía "${action}" fue rechazada por el usuario.`,
            };
          }
        }

        if (action === 'sleep') {
          await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
          return { success: true, data: { message: 'El equipo ha entrado en estado de suspensión.' } };
        }

        if (action === 'restart') {
          await execAsync(`shutdown.exe /r /t ${delay} /c "Reinicio solicitado por directiva de JARVIS"`);
          return {
            success: true,
            data: { message: `Reinicio programado en ${delay} segundos. Puedes cancelarlo con "shutdown /a".` },
          };
        }

        if (action === 'shutdown') {
          await execAsync(`shutdown.exe /s /t ${delay} /c "Apagado solicitado por directiva de JARVIS"`);
          return {
            success: true,
            data: { message: `Apagado del equipo programado en ${delay} segundos. Puedes cancelarlo con "shutdown /a".` },
          };
        }
      }

      return { success: false, error: `Plataforma no soportada para gestión de energía: ${process.platform}` };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error en gestión de energía: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
