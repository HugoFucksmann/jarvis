import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { spawn } from 'child_process';

function runPowerShell(script: string, timeoutMs: number = 8000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
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

    child.stdin.write(script, 'utf-8');
    child.stdin.end();
  });
}

export class WindowControlTool extends BaseTool {
  readonly name = 'manage_windows';
  readonly description =
    'Gestiona las ventanas de aplicaciones abiertas en el escritorio de Windows: listar ventanas visibles, traer una ventana al frente ("focus"), minimizar ("minimize"), maximizar ("maximize"), restaurar ("restore") o cerrar ("close").';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:windows'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'focus', 'minimize', 'maximize', 'restore', 'close'],
        description:
          'Acción de ventana: "list" (listar ventanas abiertas), "focus" (poner al frente), "minimize" (minimizar), "maximize" (maximizar), "restore" (restaurar), "close" (cerrar ventana).',
      },
      target: {
        type: 'string',
        description:
          'Nombre del proceso o texto en el título de la ventana (ej: "Calculadora", "Calculator", "notepad", "code", "chrome"). Requerido para focus, minimize, maximize, restore y close.',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const target = ((args.target as string) || '').trim();

    if (process.platform !== 'win32') {
      return { success: false, error: `Control de ventanas no implementado para: ${process.platform}` };
    }

    try {
      if (action === 'list') {
        const script = `
          Add-Type @"
          using System;
          using System.Collections.Generic;
          using System.Runtime.InteropServices;
          using System.Text;

          public class WindowEnumerator {
              [DllImport("user32.dll")]
              private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
              [DllImport("user32.dll")]
              private static extern bool IsWindowVisible(IntPtr hWnd);
              [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
              private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
              [DllImport("user32.dll")]
              private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

              private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

              public static List<string> GetOpenWindows() {
                  var results = new List<string>();
                  EnumWindows((hWnd, lParam) => {
                      if (IsWindowVisible(hWnd)) {
                          var sb = new StringBuilder(256);
                          GetWindowText(hWnd, sb, 256);
                          string title = sb.ToString().Trim();
                          if (!string.IsNullOrEmpty(title) && title != "Program Manager" && title != "Settings" && title != "Windows Input Experience") {
                              uint pid;
                              GetWindowThreadProcessId(hWnd, out pid);
                              results.Add(pid + ":::" + title);
                          }
                      }
                      return true;
                  }, IntPtr.Zero);
                  return results;
              }
          }
"@
          $raw = [WindowEnumerator]::GetOpenWindows()
          $items = @()
          foreach ($entry in $raw) {
              $parts = $entry -split ":::"
              $pidVal = $parts[0]
              $title = $parts[1]
              $pName = ""
              try {
                  $pName = (Get-Process -Id $pidVal -ErrorAction SilentlyContinue).ProcessName
              } catch {}
              $items += [PSCustomObject]@{
                  id = [int]$pidVal
                  process = $pName
                  title = $title
              }
          }
          $items | ConvertTo-Json -Compress
        `;

        const { stdout, code } = await runPowerShell(script);
        if (code !== 0 || !stdout) {
          // Fallback simple list
          return {
            success: true,
            data: { windows: [], count: 0, message: 'No se encontraron ventanas con título accesible.' },
          };
        }

        try {
          const parsed = JSON.parse(stdout);
          const windows = Array.isArray(parsed) ? parsed : [parsed];
          return {
            success: true,
            data: {
              windows,
              count: windows.length,
            },
          };
        } catch {
          return { success: true, data: { raw: stdout } };
        }
      }

      if (!target) {
        return { success: false, error: `Se requiere el parámetro "target" para la acción "${action}".` };
      }

      // Actions: focus, minimize, maximize, restore, close
      const cleanTarget = target.replace(/'/g, "''");

      let winApiAction = '';
      if (action === 'focus') {
        winApiAction = `
          [WinUtil]::ShowWindow($hWnd, 9) # SW_RESTORE
          [WinUtil]::SetForegroundWindow($hWnd)
        `;
      } else if (action === 'minimize') {
        winApiAction = `[WinUtil]::ShowWindow($hWnd, 6) # SW_MINIMIZE`;
      } else if (action === 'maximize') {
        winApiAction = `[WinUtil]::ShowWindow($hWnd, 3) # SW_MAXIMIZE`;
      } else if (action === 'restore') {
        winApiAction = `[WinUtil]::ShowWindow($hWnd, 9) # SW_RESTORE`;
      } else if (action === 'close') {
        winApiAction = `[WinUtil]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) # WM_CLOSE`;
      }

      const script = `
        Add-Type @"
        using System;
        using System.Collections.Generic;
        using System.Runtime.InteropServices;
        using System.Text;

        public class WinUtil {
            [DllImport("user32.dll")]
            public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
            [DllImport("user32.dll")]
            public static extern bool IsWindowVisible(IntPtr hWnd);
            [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
            [DllImport("user32.dll")]
            public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        }
"@

        $targetSearch = '${cleanTarget}'.ToLower()
        $foundHwnd = [IntPtr]::Zero
        $matchedTitle = ""

        # First try finding by exact or partial WScript.Shell AppActivate
        $wsh = New-Object -ComObject WScript.Shell
        $ok = $wsh.AppActivate('${cleanTarget}')

        if (-not $ok) {
            # Search by window enumeration (matching title or process name)
            [WinUtil]::EnumWindows({
                param($h, $l)
                if ([WinUtil]::IsWindowVisible($h)) {
                    $sb = New-Object System.Text.StringBuilder 256
                    [WinUtil]::GetWindowText($h, $sb, 256) | Out-Null
                    $t = $sb.ToString().Trim()
                    if ($t.Length -gt 0) {
                        $pId = 0
                        [WinUtil]::GetWindowThreadProcessId($h, [ref]$pId) | Out-Null
                        $pName = ""
                        try { $pName = (Get-Process -Id $pId -ErrorAction SilentlyContinue).ProcessName } catch {}

                        if ($t.ToLower().Contains($targetSearch) -or $pName.ToLower().Contains($targetSearch)) {
                            $script:foundHwnd = $h
                            $script:matchedTitle = $t
                            return $false
                        }
                    }
                }
                return $true
            }, [IntPtr]::Zero) | Out-Null

            if ($script:foundHwnd -ne [IntPtr]::Zero) {
                $hWnd = $script:foundHwnd
                ${winApiAction}
                Write-Output "OK:::$($script:matchedTitle)"
            } else {
                Write-Output "NOT_FOUND"
            }
        } else {
            Write-Output "OK:::${cleanTarget}"
        }
      `;

      const { stdout, code, stderr } = await runPowerShell(script);
      if (code !== 0) {
        return { success: false, error: `Error ejecutando acción de ventana: ${stderr}` };
      }

      if (stdout.includes('NOT_FOUND')) {
        return {
          success: false,
          error: `No se encontró ninguna ventana abierta que coincida con "${target}".`,
        };
      }

      const match = stdout.startsWith('OK:::') ? stdout.replace('OK:::', '') : target;
      return {
        success: true,
        data: {
          message: `Acción "${action}" ejecutada exitosamente sobre la ventana "${match}".`,
          action,
          target: match,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error gestionando ventanas: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
