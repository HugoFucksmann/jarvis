import { spawn } from 'child_process';

/**
 * Shared helper: runs a PowerShell script safely via UTF-16LE Base64 -EncodedCommand.
 * Automatically prepends `$ProgressPreference = 'SilentlyContinue'` to suppress progress bars.
 *
 * @param script    - The PowerShell script to execute.
 * @param timeoutMs - Milliseconds before the process is killed (default: 6000).
 */
export function runPowerShell(
  script: string,
  timeoutMs: number = 6000
): Promise<{ stdout: string; stderr: string; code: number }> {
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
