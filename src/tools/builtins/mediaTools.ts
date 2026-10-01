import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult, ActionState } from '../types.js';
import { runPowerShell } from './_powershellHelper.js';
import { openUrlInBrowser } from '../../utils/openUrl.js';

/**
 * Searches YouTube directly and returns the first direct watch URL found
 * (youtube.com/watch?v=...) plus the video title.
 * Falls back to search results if nothing is found.
 */
async function searchYouTubeDirect(query: string, preferMusic: boolean): Promise<{
  url: string;
  title: string;
  videoId: string | null;
  state: ActionState;
}> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  };

  try {
    const res = await fetch(searchUrl, {
      headers,
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const html = await res.text();

      // Priority 1: Match videoRenderer which contains both videoId and title
      const rendererMatch = html.match(
        /"videoRenderer":\s*\{"videoId":"([a-zA-Z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"/
      );
      if (rendererMatch) {
        const videoId = rendererMatch[1];
        const title = rendererMatch[2].replace(/\\u0026/g, '&').replace(/&#39;/g, "'").trim();
        const finalUrl = preferMusic
          ? `https://music.youtube.com/watch?v=${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`;
        return { url: finalUrl, title, videoId, state: 'started' };
      }

      // Priority 2: Simple videoId match
      const simpleMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      if (simpleMatch) {
        const videoId = simpleMatch[1];
        const finalUrl = preferMusic
          ? `https://music.youtube.com/watch?v=${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`;
        return { url: finalUrl, title: query, videoId, state: 'started' };
      }
    }
  } catch {
    // Ignore and proceed to fallback
  }

  // Fallback: open results page (state: requested — not yet playing)
  const fallbackUrl = preferMusic
    ? `https://music.youtube.com/search?q=${encodeURIComponent(query)}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  return {
    url: fallbackUrl,
    title: query,
    videoId: null,
    state: 'requested',
  };
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
          // Try native Spotify URI protocol handler via cmd start (works for spotify: URIs and https:// alike)
          const escapedUri = appUri.replace(/"/g, '');
          const escapedWeb = webUrl.replace(/"/g, '');
          const script = `
try {
    Start-Process "${escapedUri}" -ErrorAction Stop
    Write-Output "OK_APP"
} catch {
    Start-Process "${escapedWeb}"
    Write-Output "OK_WEB"
}
`;
          const { stdout } = await runPowerShell(script);
          const usedApp = stdout.includes('OK_APP');
          return {
            success: true,
            state: 'started' as ActionState,
            data: {
              message: `Búsqueda iniciada en Spotify para "${query}" (${usedApp ? 'App de escritorio' : 'Reproductor web'}).`,
              query,
              mode: usedApp ? 'desktop_app' : 'web_browser',
              url: usedApp ? appUri : webUrl,
              // state 'started': Spotify received the URI. Track may take 1-2s to begin.
            },
          };
        } else {
          // Web fallback
          await openUrlInBrowser(webUrl);
          return {
            success: true,
            state: 'requested' as ActionState,
            data: {
              message: `Reproductor web de Spotify abierto buscando: "${query}". El usuario debe seleccionar la pista.`,
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
            state: 'failed' as ActionState,
            error: 'Se requiere el parámetro "query" para buscar y reproducir en YouTube.',
          };
        }

        const isMusic = service === 'youtube_music';

        // Step 1: find the direct video URL via DuckDuckGo
        const found = await searchYouTubeDirect(query, isMusic);

        // Step 2: open the direct video (or results fallback)
        await openUrlInBrowser(found.url);

        const serviceName = isMusic ? 'YouTube Music' : 'YouTube';
        const isDirectVideo = found.videoId !== null;

        return {
          success: true,
          state: found.state,
          data: {
            message: isDirectVideo
              ? `Reproduciendo en ${serviceName}: "${found.title}".`
              : `No se encontró un video directo. Se abrió la búsqueda en ${serviceName} para: "${query}". El usuario debe seleccionar el video manualmente.`,
            query,
            service: isMusic ? 'youtube_music' : 'youtube',
            title: found.title,
            url: found.url,
            videoId: found.videoId,
            // 'started' = direct video opened; 'requested' = only search results opened
            directVideo: isDirectVideo,
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
