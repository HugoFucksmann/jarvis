import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { spawn } from 'child_process';

/**
 * Helper to run a PowerShell script reliably via UTF-16LE Base64 -EncodedCommand
 */
function runPowerShell(script: string, timeoutMs: number = 8000): Promise<{ stdout: string; stderr: string; code: number }> {
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

const csharpDesktopHelper = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WinDesktopCtrl {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public static List<string> GetUserWindows() {
        var list = new List<string>();
        IntPtr hDesk = OpenDesktop("default", 0, false, 0x0140);
        if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, 0x0140);

        if (hDesk != IntPtr.Zero) {
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var sbTitle = new StringBuilder(256);
                    GetWindowText(hWnd, sbTitle, 256);
                    string title = sbTitle.ToString().Trim();

                    var sbClass = new StringBuilder(256);
                    GetClassName(hWnd, sbClass, 256);
                    string className = sbClass.ToString().Trim();

                    if (!string.IsNullOrEmpty(title) &&
                        !title.Equals("Default IME") &&
                        !title.Equals("MSCTFIME UI") &&
                        !title.StartsWith(".NET-Broadcast") &&
                        !title.StartsWith("GDI+ Window") &&
                        !className.Equals("Shell_TrayWnd") &&
                        !className.Equals("Progman") &&
                        !title.Equals("Program Manager") &&
                        !title.Equals("Experiencia de entrada de Windows") &&
                        !title.Equals("DesktopWindowXamlSource") &&
                        !title.Equals("PopupHost")) {

                        uint pid;
                        GetWindowThreadProcessId(hWnd, out pid);
                        list.Add(hWnd.ToString() + ":::" + pid.ToString() + ":::" + className + ":::" + title);
                    }
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
        }
        return list;
    }

    public static bool ForceForeground(IntPtr targetHwnd) {
        if (targetHwnd == IntPtr.Zero) return false;
        IntPtr fgWnd = GetForegroundWindow();
        uint dummy;
        uint fgThread = GetWindowThreadProcessId(fgWnd, out dummy);
        uint curThread = GetCurrentThreadId();

        // Bypass Windows 11 foreground lock restriction
        keybd_event(0x12, 0, 0, 0);
        keybd_event(0x12, 0, 2, 0);

        if (fgThread != 0 && fgThread != curThread) {
            AttachThreadInput(curThread, fgThread, true);
            ShowWindow(targetHwnd, 9); // SW_RESTORE
            SetForegroundWindow(targetHwnd);
            AttachThreadInput(curThread, fgThread, false);
        } else {
            ShowWindow(targetHwnd, 9);
            SetForegroundWindow(targetHwnd);
        }
        return true;
    }
}
"@
`;

export class WindowControlTool extends BaseTool {
  readonly name = 'manage_windows';
  readonly description =
    'Gestiona las ventanas de aplicaciones abiertas en el escritorio interactivo de Windows: listar ventanas visibles con su proceso y título, traer una ventana al frente ("focus"), minimizar ("minimize"), maximizar ("maximize"), restaurar ("restore") o cerrar ("close").';
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
          'Nombre del proceso o texto en el título de la ventana (ej: "Calculadora", "Calculator", "notepad", "code", "chrome", "WhatsApp"). Requerido para focus, minimize, maximize, restore y close.',
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
${csharpDesktopHelper}
$raw = [WinDesktopCtrl]::GetUserWindows()
$items = @()
$procCache = @{}

foreach ($entry in $raw) {
    $parts = $entry -split ":::"
    $hwnd = $parts[0]
    $pidVal = [int]$parts[1]
    $className = $parts[2]
    $title = $parts[3]

    if (-not $procCache.ContainsKey($pidVal)) {
        try {
            $procCache[$pidVal] = (Get-Process -Id $pidVal -ErrorAction SilentlyContinue).ProcessName
        } catch {
            $procCache[$pidVal] = ""
        }
    }
    $pName = $procCache[$pidVal]

    $items += [PSCustomObject]@{
        hwnd = $hwnd
        pid = $pidVal
        process = $pName
        title = $title
        className = $className
    }
}
$items | ConvertTo-Json -Compress
`;

        const { stdout, code, stderr } = await runPowerShell(script);
        if (code !== 0 || !stdout) {
          return {
            success: true,
            data: { windows: [], count: 0, message: 'No se detectaron ventanas abiertas en el escritorio o ' + stderr },
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

      const cleanTarget = target.replace(/'/g, "''");

      const script = `
${csharpDesktopHelper}
$raw = [WinDesktopCtrl]::GetUserWindows()
$target = '${cleanTarget}'.ToLower()

$foundHwnd = [IntPtr]::Zero
$foundPid = 0
$foundTitle = ""
$foundProcess = ""

foreach ($entry in $raw) {
    $parts = $entry -split ":::"
    $h = [IntPtr][int64]$parts[0]
    $procId = [int]$parts[1]   # NOTE: avoid $pId/$PID - reserved PowerShell automatic variable
    $cName = $parts[2]
    $t = $parts[3]
    $pName = ""
    try { $pName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName } catch {}

    $isMatch = $false
    if ($t.ToLower().Contains($target) -or $pName.ToLower().Contains($target)) {
        $isMatch = $true
    }
    # Special aliases: calc / calculadora
    if (($target -eq "calc" -or $target -eq "calculadora") -and ($pName -match "calc|calculator" -or $t -match "calc|calculadora")) {
        $isMatch = $true
    }
    # Special aliases: notepad / bloc de notas
    if (($target -eq "notepad" -or $target -eq "bloc de notas") -and ($pName -match "notepad" -or $t -match "bloc de notas")) {
        $isMatch = $true
    }

    if ($isMatch) {
        $foundHwnd = $h
        $foundPid = $procId
        $foundTitle = $t
        $foundProcess = $pName
        break
    }
}

# Fallback for UWP/modern apps not visible in desktop window list (e.g. CalculatorApp, Notepad)
# These apps may not have an HWND but can be found and killed by process name
if ($foundHwnd -eq [IntPtr]::Zero) {
    $uwpNames = @{
        "calc" = @("CalculatorApp", "Calculator")
        "calculadora" = @("CalculatorApp", "Calculator")
        "notepad" = @("Notepad", "notepad")
        "bloc de notas" = @("Notepad", "notepad")
    }
    $uwpCandidates = $uwpNames[$target]
    if ($uwpCandidates) {
        foreach ($candidate in $uwpCandidates) {
            $proc = Get-Process -Name $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($proc) {
                $foundPid = $proc.Id
                $foundProcess = $proc.ProcessName
                $foundTitle = $proc.MainWindowTitle
                if (-not $foundTitle) { $foundTitle = $candidate }
                # Mark as UWP (no HWND) by setting a special sentinel
                $foundHwnd = [IntPtr]-1
                break
            }
        }
    }
}

if ($foundHwnd -eq [IntPtr]::Zero) {
    Write-Output "NOT_FOUND"
    exit 0
}

$isUwpFallback = ($foundHwnd -eq [IntPtr]-1)

# Execute requested action
if ('${action}' -eq 'focus') {
    if (-not $isUwpFallback) {
        [void][WinDesktopCtrl]::ForceForeground($foundHwnd)
    } else {
        # UWP apps: bring to front by process name via explorer shell
        if ($foundProcess -match "calc|calculator") { Start-Process "calc:" }
        elseif ($foundProcess -match "notepad") { Start-Process "notepad.exe" }
    }
    Write-Output "OK:::$foundTitle:::$foundProcess:::$foundPid"
} elseif ('${action}' -eq 'minimize') {
    if (-not $isUwpFallback) { [void][WinDesktopCtrl]::ShowWindow($foundHwnd, 6) }
    Write-Output "OK:::$foundTitle:::$foundProcess:::$foundPid"
} elseif ('${action}' -eq 'maximize') {
    if (-not $isUwpFallback) { [void][WinDesktopCtrl]::ShowWindow($foundHwnd, 3) }
    Write-Output "OK:::$foundTitle:::$foundProcess:::$foundPid"
} elseif ('${action}' -eq 'restore') {
    if (-not $isUwpFallback) { [void][WinDesktopCtrl]::ShowWindow($foundHwnd, 9) }
    Write-Output "OK:::$foundTitle:::$foundProcess:::$foundPid"
} elseif ('${action}' -eq 'close') {
    if (-not $isUwpFallback) {
        # Post WM_CLOSE for regular windows
        [void][WinDesktopCtrl]::PostMessage($foundHwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 250
    }
    # Force terminate process (works for both UWP and unresponsive regular apps)
    $alive = Get-Process -Id $foundPid -ErrorAction SilentlyContinue
    if ($alive) {
        Stop-Process -Id $foundPid -Force -ErrorAction SilentlyContinue
    }
    Write-Output "OK:::$foundTitle:::$foundProcess:::$foundPid"
}
`;

      const { stdout, code, stderr } = await runPowerShell(script);
      if (code !== 0) {
        return { success: false, error: `Error gestionando ventana: ${stderr}` };
      }

      if (stdout.includes('NOT_FOUND')) {
        return {
          success: false,
          error: `No se encontró ninguna ventana activa en el escritorio que coincida con "${target}".`,
        };
      }

      let matchedTitle = target;
      let matchedProc = '';
      if (stdout.startsWith('OK:::')) {
        const parts = stdout.replace('OK:::', '').split(':::');
        matchedTitle = parts[0] || target;
        matchedProc = parts[1] || '';
      }

      return {
        success: true,
        data: {
          message: `Acción "${action}" ejecutada exitosamente sobre la ventana "${matchedTitle}" (${matchedProc || 'proceso activo'}).`,
          action,
          target: matchedTitle,
          process: matchedProc,
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
