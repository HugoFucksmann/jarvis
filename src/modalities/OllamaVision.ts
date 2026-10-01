import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  VisionProvider,
  ImageInput,
  ScreenCaptureOptions,
  ScreenCaptureResult,
} from './VisionInterface.js';
import { Logger } from '../logger/Logger.js';
import { config } from '../config/index.js';

export type VisionComputeDevice = 'cpu' | 'gpu';

export interface OllamaVisionOptions {
  keepAlive?: string;
  maxWidth?: number;
  quality?: number;
  numThreads?: number;
  temperature?: number;
}

/**
 * Executes a PowerShell script safely via UTF-16LE Base64 -EncodedCommand.
 */
function runPowerShell(script: string, timeoutMs: number = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
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

export class OllamaVisionProvider implements VisionProvider {
  public readonly name = 'OllamaVision';
  private baseUrl: string;
  private modelName: string;
  private device: VisionComputeDevice;
  private options: Required<OllamaVisionOptions>;
  private logger = new Logger('OllamaVision');

  constructor(
    baseUrl: string = config.ollama.baseUrl,
    modelName: string = config.vision.model,
    device: VisionComputeDevice = config.vision.device,
    options?: OllamaVisionOptions
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.modelName = modelName;
    this.device = device;
    this.options = {
      keepAlive: options?.keepAlive ?? config.vision.keepAlive ?? '60m',
      maxWidth: options?.maxWidth ?? config.vision.maxWidth ?? 1920,
      quality: options?.quality ?? config.vision.quality ?? 85,
      numThreads: options?.numThreads ?? 8,
      temperature: options?.temperature ?? 0.2,
    };
  }

  public getDevice(): VisionComputeDevice {
    return this.device;
  }

  public setDevice(device: VisionComputeDevice): void {
    this.logger.info(`Switching vision model compute device to: ${device.toUpperCase()}`);
    this.device = device;
  }

  public getModelName(): string {
    return this.modelName;
  }

  public setModelName(name: string): void {
    this.logger.info(`Switching vision model to: ${name}`);
    this.modelName = name;
  }

  /**
   * Checks if Ollama is accessible and whether a vision-capable model is available.
   */
  public async isVisionSupported(modelName?: string): Promise<boolean> {
    const targetModel = modelName || this.modelName;
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return false;

      const data = (await res.json()) as {
        models?: Array<{
          name: string;
          details?: { family?: string };
          capabilities?: string[];
        }>;
      };

      const models = data.models || [];
      const found = models.find(
        (m) => m.name === targetModel || m.name.startsWith(targetModel.split(':')[0])
      );

      if (!found) {
        // Fallback: check if ANY installed model has vision keywords
        return models.some((m) => this.isKnownVisionModel(m.name));
      }

      // Check explicit capabilities or common vision model families
      if (found.capabilities && found.capabilities.includes('vision')) {
        return true;
      }

      return this.isKnownVisionModel(found.name) || (found.details?.family?.includes('clip') ?? false);
    } catch (err: unknown) {
      this.logger.warn(`Could not verify vision model availability: ${String(err)}`);
      return false;
    }
  }

  private isKnownVisionModel(name: string): boolean {
    const lower = name.toLowerCase();
    const visionKeywords = [
      'vl',
      'vision',
      'llava',
      'bakllava',
      'minicpm-v',
      'moondream',
      'qwen3.5',
      'qwen2.5-vl',
      'llama3.2-vision',
    ];
    return visionKeywords.some((keyword) => lower.includes(keyword));
  }

  /**
   * Clean old screenshot files to prevent disk bloating (keep last 25).
   */
  private async cleanOldScreenshots(dir: string, maxFiles: number = 25): Promise<void> {
    try {
      if (!fs.existsSync(dir)) return;
      const files = await fs.promises.readdir(dir);
      const screenshotFiles = files.filter((f) => f.startsWith('screenshot_'));
      if (screenshotFiles.length <= maxFiles) return;

      const fullPaths = screenshotFiles.map((f) => ({
        name: f,
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }));

      // Sort oldest first
      fullPaths.sort((a, b) => a.mtime - b.mtime);
      const toDelete = fullPaths.slice(0, fullPaths.length - maxFiles);

      for (const item of toDelete) {
        await fs.promises.unlink(item.path).catch(() => {});
      }
    } catch {
      // Non-critical background maintenance
    }
  }

  /**
   * Captures screen or active window.
   */
  public async captureScreen(options?: ScreenCaptureOptions): Promise<ScreenCaptureResult> {
    const target = options?.target === 'active_window' ? 'active_window' : 'screen';
    const format = options?.format === 'png' ? 'png' : 'jpeg';
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = options?.quality ?? this.options.quality;
    const maxWidth = options?.maxWidth ?? this.options.maxWidth;

    const baseDir = path.resolve(config.workspaceRoot, '.jarvis', 'screenshots');
    await fs.promises.mkdir(baseDir, { recursive: true });
    await this.cleanOldScreenshots(baseDir);

    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `screenshot_${target}_${timestampStr}.${format === 'png' ? 'png' : 'jpg'}`;
    const destinationPath = options?.savePath ? path.resolve(options.savePath) : path.join(baseDir, defaultFilename);

    // Make sure destination parent directory exists
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

    let width = 0;
    let height = 0;

    if (process.platform === 'win32') {
      const script = `
Add-Type -AssemblyName System.Drawing, System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinScreenNative {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

$target = "${target}"
$destPath = "${destinationPath.replace(/\\/g, '\\\\').replace(/"/g, '`"')}"
$maxWidth = ${maxWidth}
$qualityVal = ${quality}
$formatStr = "${format}"

$bounds = [System.Drawing.Rectangle]::Empty

if ($target -eq "active_window") {
    $fgHwnd = [WinScreenNative]::GetForegroundWindow()
    if ($fgHwnd -ne [IntPtr]::Zero) {
        $rect = New-Object WinScreenNative+RECT
        $ok = [WinScreenNative]::GetWindowRect($fgHwnd, [ref]$rect)
        $w = $rect.Right - $rect.Left
        $h = $rect.Bottom - $rect.Top
        if ($ok -and $w -gt 20 -and $h -gt 20) {
            $bounds = New-Object System.Drawing.Rectangle($rect.Left, $rect.Top, $w, $h)
        }
    }
}

if ($bounds.IsEmpty) {
    # Full primary screen
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
}

# Capture screen pixels into Bitmap
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()

$finalBmp = $bmp
$outWidth = $bounds.Width
$outHeight = $bounds.Height

# Downscale if wider than maxWidth to preserve memory and token budget
if ($outWidth -gt $maxWidth) {
    $scale = $maxWidth / $outWidth
    $newW = [int]($outWidth * $scale)
    $newH = [int]($outHeight * $scale)
    $scaledBmp = New-Object System.Drawing.Bitmap($newW, $newH)
    $gScaled = [System.Drawing.Graphics]::FromImage($scaledBmp)
    $gScaled.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gScaled.DrawImage($bmp, 0, 0, $newW, $newH)
    $gScaled.Dispose()
    $bmp.Dispose()
    $finalBmp = $scaledBmp
    $outWidth = $newW
    $outHeight = $newH
}

# Save image
if ($formatStr -eq "png") {
    $finalBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
} else {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$qualityVal)
    $finalBmp.Save($destPath, $codec, $encoderParams)
    $encoderParams.Dispose()
}

$finalBmp.Dispose()

$info = @{
    width = $outWidth
    height = $outHeight
    path = $destPath
}
$info | ConvertTo-Json -Compress
`;

      const { stdout, code, stderr } = await runPowerShell(script);
      if (code !== 0 || !fs.existsSync(destinationPath)) {
        throw new Error(`Screen capture failed on Windows: ${stderr || stdout}`);
      }

      try {
        const parsed = JSON.parse(stdout) as { width: number; height: number };
        width = parsed.width;
        height = parsed.height;
      } catch {
        // Fallback default
        width = 1920;
        height = 1080;
      }
    } else {
      // Linux / Unix fallback implementation
      width = 1920;
      height = 1080;

      // Try scrot, import (ImageMagick), or grim (Wayland)
      let captured = false;
      const candidates = [
        `scrot -z "${destinationPath}"`,
        `import -window root "${destinationPath}"`,
        `grim "${destinationPath}"`,
      ];

      for (const cmd of candidates) {
        try {
          const { execSync } = await import('child_process');
          execSync(cmd, { stdio: 'pipe', timeout: 5000 });
          if (fs.existsSync(destinationPath)) {
            captured = true;
            break;
          }
        } catch {
          // Continue to next candidate
        }
      }

      if (!captured) {
        throw new Error(
          'No se pudo capturar la pantalla en Linux: se requiere una sesión gráfica activa con una herramienta compatible (ej: scrot, imagemagick o grim).'
        );
      }
    }

    const fileBuffer = await fs.promises.readFile(destinationPath);
    const base64 = fileBuffer.toString('base64');
    const stat = await fs.promises.stat(destinationPath);

    this.logger.info(
      `Screen capture completed: ${destinationPath} (${width}x${height}, ${(stat.size / 1024).toFixed(1)} KB)`
    );

    return {
      path: destinationPath,
      base64,
      mimeType,
      width,
      height,
      target,
      timestamp: new Date().toISOString(),
      fileSizeBytes: stat.size,
    };
  }

  /**
   * Sends an image along with a user prompt to the local Ollama vision model.
   */
  public async describeImage(image: ImageInput, prompt: string): Promise<string> {
    const startTime = Date.now();
    let base64Image = '';

    if (image.base64) {
      base64Image = image.base64.replace(/^data:image\/\w+;base64,/, '').trim();
    } else if (image.buffer) {
      base64Image = image.buffer.toString('base64');
    } else if (image.path) {
      const resolved = path.resolve(image.path);
      if (!fs.existsSync(resolved)) {
        throw new Error(`El archivo de imagen especificado no existe: ${resolved}`);
      }
      const buf = await fs.promises.readFile(resolved);
      base64Image = buf.toString('base64');
    } else {
      throw new Error('Debe proporcionar una imagen válida en base64, buffer o ruta de archivo.');
    }

    const numGpu = this.device === 'gpu' ? -1 : 0;
    this.logger.info(
      `Analyzing image with model "${this.modelName}" on [${this.device.toUpperCase()}] (num_gpu: ${numGpu}). Prompt: "${prompt.slice(0, 70)}..."`
    );

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            {
              role: 'user',
              content: prompt,
              images: [base64Image],
            },
          ],
          stream: false,
          keep_alive: this.options.keepAlive,
          options: {
            num_gpu: numGpu,
            temperature: this.options.temperature,
            num_thread: this.options.numThreads,
          },
        }),
        signal: AbortSignal.timeout(60000), // 60s timeout for vision models
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Ollama Vision request failed [${response.status}]: ${errorText || response.statusText}`
        );
      }

      const data = (await response.json()) as {
        message?: { content?: string };
      };

      const analysis = data.message?.content?.trim() || 'No se obtuvo respuesta del modelo de visión.';
      const elapsedMs = Date.now() - startTime;
      this.logger.info(`Vision analysis completed in ${elapsedMs}ms (${analysis.length} chars).`);

      return analysis;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Vision analysis failed: ${errMsg}`);
      throw new Error(`Error en modelo de visión local: ${errMsg}`);
    }
  }
}
