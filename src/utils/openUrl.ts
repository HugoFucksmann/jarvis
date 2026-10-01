import { spawn } from 'child_process';

/**
 * Shared helper: opens a URL in the default system browser.
 *
 * - Windows: uses `cmd /c start ""` (canonical method — Start-Process does NOT work for URLs).
 * - macOS:   uses `open`.
 * - Linux:   uses `xdg-open`.
 *
 * The promise resolves when the launch command has been dispatched (fire-and-forget).
 * It does not wait for the browser to finish loading.
 */
export function openUrlInBrowser(url: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        const child = spawn('cmd.exe', ['/c', 'start', '""', url], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        resolve();
      } else if (process.platform === 'darwin') {
        const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
        child.unref();
        resolve();
      } else {
        const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
        child.unref();
        resolve();
      }
    } catch {
      resolve();
    }
  });
}
