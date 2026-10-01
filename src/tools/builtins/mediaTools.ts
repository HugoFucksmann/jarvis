import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { spawn } from 'child_process';

/**
 * Runs a PowerShell script safely via UTF-16LE Base64 -EncodedCommand.
 */
function runPowerShell(script: string, timeoutMs: number = 6000): Promise<{ stdout: string; stderr: string; code: number }> {
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

function openUrlCrossPlatform(url: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        const escaped = url.replace(/'/g, "''");
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${escaped}'`],
          { detached: true, stdio: 'ignore', windowsHide: true }
        );
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

export class MediaControlTool extends BaseTool {
  readonly name = 'control_media';
  readonly description =
    'Controla la reproducción multimedia y música del sistema: reproducir/pausar ("play_pause"), siguiente pista ("next"), pista anterior ("previous"), detener ("stop"), consultar qué pista o video está sonando actualmente ("now_playing"), y buscar y reproducir música o podcasts en Spotify ("play_spotify") o videos/música en YouTube / YouTube Music ("play_youtube").';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['system:media'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['play_pause', 'next', 'previous', 'stop', 'now_playing', 'play_spotify', 'play_youtube'],
        description:
          'Acción multimedia: "play_pause" (alternar play y pausa), "next" (siguiente canción o video), "previous" (canción o video anterior), "stop" (detener), "now_playing" (identificar qué está sonando), "play_spotify" (buscar y reproducir en Spotify), "play_youtube" (buscar y reproducir en YouTube o YouTube Music).',
      },
      query: {
        type: 'string',
        description:
          'Término de búsqueda de la canción, artista, álbum, playlist o video (requerido para "play_spotify" y "play_youtube"). Ejemplos: "Daft Punk Get Lucky", "Queen Bohemian Rhapsody", "lofi chill hop", "ac/dc back in black".',
      },
      service: {
        type: 'string',
        enum: ['youtube', 'youtube_music', 'spotify'],
        description:
          'Servicio destino opcional. Para "play_youtube", permite elegir entre "youtube" (default) o "youtube_music".',
      },
      targetApp: {
        type: 'string',
        enum: ['app', 'web'],
        description:
          'Para Spotify: "app" intenta abrir la aplicación de escritorio nativa instalada (default), "web" abre el reproductor web en el navegador.',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const action = args.action as string;
    const query = ((args.query as string) || '').trim();
    const service = (args.service as string) || 'youtube';
    const targetApp = (args.targetApp as string) || 'app';

    try {
      // ── 1. SPOTIFY INTEGRATION ──────────────────────────────────────────────
      if (action === 'play_spotify') {
        if (!query) {
          return {
            success: false,
            error: 'Se requiere el parámetro "query" para buscar y reproducir en Spotify.',
          };
        }

        const encodedQuery = encodeURIComponent(query);
        const webUrl = `https://open.spotify.com/search/${encodedQuery}`;
        const appUri = `spotify:search:${encodedQuery}`;

        if (process.platform === 'win32' && targetApp !== 'web') {
          // Try native Spotify protocol handler first
          const script = `
try {
    Start-Process -FilePath "${appUri}" -ErrorAction Stop
    Write-Output "OK_APP"
} catch {
    Start-Process -FilePath "${webUrl}"
    Write-Output "OK_WEB"
}
`;
          const { stdout } = await runPowerShell(script);
          const usedApp = stdout.includes('OK_APP');
          return {
            success: true,
            data: {
              message: `Búsqueda iniciada en Spotify para "${query}" (${usedApp ? 'App de escritorio' : 'Reproductor web'}).`,
              query,
              mode: usedApp ? 'desktop_app' : 'web_browser',
              url: usedApp ? appUri : webUrl,
            },
          };
        } else {
          // Web fallback
          await openUrlCrossPlatform(webUrl);
          return {
            success: true,
            data: {
              message: `Reproductor web de Spotify abierto buscando: "${query}".`,
              query,
              mode: 'web_browser',
              url: webUrl,
            },
          };
        }
      }

      // ── 2. YOUTUBE INTEGRATION ──────────────────────────────────────────────
      if (action === 'play_youtube') {
        if (!query) {
          return {
            success: false,
            error: 'Se requiere el parámetro "query" para buscar y reproducir en YouTube.',
          };
        }

        const encodedQuery = encodeURIComponent(query);
        const isMusic = service === 'youtube_music';
        const targetUrl = isMusic
          ? `https://music.youtube.com/search?q=${encodedQuery}`
          : `https://www.youtube.com/results?search_query=${encodedQuery}`;

        await openUrlCrossPlatform(targetUrl);

        return {
          success: true,
          data: {
            message: `${isMusic ? 'YouTube Music' : 'YouTube'} abierto buscando: "${query}".`,
            query,
            service: isMusic ? 'youtube_music' : 'youtube',
            url: targetUrl,
          },
        };
      }

      // ── 3. NOW PLAYING DETECTION ────────────────────────────────────────────
      if (action === 'now_playing') {
        if (process.platform === 'win32') {
          const script = `
$res = [PSCustomObject]@{
    playing = $false
    service = "Ninguno detectado"
    title = ""
    artist = ""
    track = ""
    raw = ""
}

# 1. Check Spotify desktop app
$spotProc = Get-Process spotify -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -and
    $_.MainWindowTitle -ne 'Spotify' -and
    $_.MainWindowTitle -ne 'Spotify Premium' -and
    $_.MainWindowTitle -ne 'Spotify Free'
} | Select-Object -First 1

if ($spotProc) {
    $raw = $spotProc.MainWindowTitle.Trim()
    $res.playing = $true
    $res.service = "Spotify"
    $res.raw = $raw

    # Format usually: "Artist - Track" or "Spotify - Artist - Track"
    $clean = $raw -replace '^Spotify\\s*-\\s*', ''
    if ($clean -match '^(.+?)\\s*-\\s*(.+)$') {
        $res.artist = $matches[1].Trim()
        $res.track = $matches[2].Trim()
        $res.title = "$($res.artist) - $($res.track)"
    } else {
        $res.track = $clean
        $res.title = $clean
    }
} else {
    # 2. Check Browsers playing YouTube or YouTube Music
    $browsers = Get-Process chrome, msedge, firefox, brave, opera -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowTitle -match 'YouTube'
    } | Select-Object -First 1

    if ($browsers) {
        $raw = $browsers.MainWindowTitle.Trim()
        $res.playing = $true
        $isMusic = $raw -match 'YouTube Music'
        $res.service = if ($isMusic) { "YouTube Music" } else { "YouTube" }
        $res.raw = $raw

        # Remove browser suffix e.g. " - YouTube - Google Chrome"
        $clean = $raw -replace '\\s*-\\s*YouTube.*$', '' -replace '\\s*-\\s*(Google Chrome|Microsoft Edge|Firefox|Brave|Opera).*$', ''
        $res.title = $clean.Trim()
        if ($res.title -match '^(.+?)\\s*-\\s*(.+)$') {
            $res.artist = $matches[1].Trim()
            $res.track = $matches[2].Trim()
        }
    }
}

$res | ConvertTo-Json -Compress
`;

          const { stdout, code } = await runPowerShell(script);
          if (code === 0 && stdout) {
            try {
              const data = JSON.parse(stdout) as {
                playing: boolean;
                service: string;
                title: string;
                artist?: string;
                track?: string;
              };

              if (data.playing) {
                return {
                  success: true,
                  data: {
                    message: `Reproduciendo actualmente en ${data.service}: "${data.title}".`,
                    service: data.service,
                    title: data.title,
                    artist: data.artist || undefined,
                    track: data.track || undefined,
                  },
                };
              } else {
                return {
                  success: true,
                  data: {
                    message: 'No se detectó ninguna pista sonando activamente en Spotify o navegadores.',
                    playing: false,
                  },
                };
              }
            } catch {
              // fallback
            }
          }
        }

        // Generic fallback
        return {
          success: true,
          data: {
            message: 'Información de reproducción en curso no disponible en esta sesión.',
            playing: false,
          },
        };
      }

      // ── 4. GLOBAL PLAY / PAUSE / NEXT / PREV / STOP ─────────────────────────
      if (['play_pause', 'next', 'previous', 'stop'].includes(action)) {
        if (process.platform === 'win32') {
          // Virtual Key Codes in Windows:
          // VK_MEDIA_NEXT_TRACK = 176 (0xB0)
          // VK_MEDIA_PREV_TRACK = 177 (0xB1)
          // VK_MEDIA_STOP = 178 (0xB2)
          // VK_MEDIA_PLAY_PAUSE = 179 (0xB3)
          let charCode: number;
          let actionLabel = '';

          switch (action) {
            case 'play_pause':
              charCode = 179;
              actionLabel = 'Reproducción / Pausa conmutada';
              break;
            case 'next':
              charCode = 176;
              actionLabel = 'Siguiente pista';
              break;
            case 'previous':
              charCode = 177;
              actionLabel = 'Pista anterior';
              break;
            case 'stop':
              charCode = 178;
              actionLabel = 'Reproducción detenida';
              break;
            default:
              charCode = 179;
              actionLabel = 'Acción multimedia';
          }

          const script = `
$w = New-Object -ComObject WScript.Shell
$w.SendKeys([char]${charCode})
`;
          const { code, stderr } = await runPowerShell(script);
          if (code !== 0) {
            return { success: false, error: `Fallo al enviar señal multimedia: ${stderr}` };
          }

          return {
            success: true,
            data: {
              message: `${actionLabel} correctamente en el reproductor activo (Spotify / YouTube / Sistema).`,
              action,
              virtualKey: charCode,
            },
          };
        } else if (process.platform === 'linux') {
          // Linux playerctl fallback
          const playerctlCmd =
            action === 'play_pause'
              ? 'play-pause'
              : action === 'next'
              ? 'next'
              : action === 'previous'
              ? 'previous'
              : 'stop';

          const { exec } = await import('child_process');
          await new Promise<void>((res) => {
            exec(`playerctl ${playerctlCmd} 2>/dev/null || true`, () => res());
          });

          return {
            success: true,
            data: {
              message: `Comando multimedia "${action}" enviado en Linux.`,
              action,
            },
          };
        } else {
          return {
            success: false,
            error: `Acción multimedia no soportada en plataforma: ${process.platform}`,
          };
        }
      }

      return {
        success: false,
        error: `Acción multimedia no reconocida: ${action}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error en control multimedia: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
