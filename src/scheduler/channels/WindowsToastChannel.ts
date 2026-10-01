import { INotificationChannel, NotificationPayload } from '../types.js';
import { spawn } from 'child_process';
import { Logger } from '../../logger/Logger.js';

export class WindowsToastChannel implements INotificationChannel {
  public readonly name = 'windows_toast';
  private logger = new Logger('WindowsToastChannel');

  public isEnabled(): boolean {
    return process.platform === 'win32';
  }

  public async send(payload: NotificationPayload): Promise<boolean> {
    if (process.platform !== 'win32') {
      this.logger.debug('Windows toast skipped on non-Windows platform.');
      return false;
    }

    const title = payload.title.replace(/'/g, "''");
    const body = (payload.message || 'Alerta de recordatorio de JARVIS').replace(/'/g, "''");

    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null

$template = @"
<toast duration="short">
    <visual>
        <binding template="ToastGeneric">
            <text>${title}</text>
            <text>${body}</text>
            <text placement="attribution">J.A.R.V.I.S. Core</text>
        </binding>
    </visual>
    <audio src="ms-winsoundevent:Notification.Reminder"/>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("JARVIS").Show($toast)
`;

    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    return new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          // Fallback simple balloon tip if UWP Toast not accessible
          const fallbackScript = `
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.ShowBalloonTip(5000, '${title}', '${body}', [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Milliseconds 1500
$n.Dispose()
`;
          const fbEncoded = Buffer.from(fallbackScript, 'utf16le').toString('base64');
          spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', fbEncoded], {
            windowsHide: true,
          }).on('close', () => resolve(true));
        }
      });

      child.on('error', () => resolve(false));
    });
  }
}
