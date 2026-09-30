import { SpeechToText, AudioBufferData } from './SpeechInterface.js';
import { Logger } from '../logger/Logger.js';

export type VoiceComputeDevice = 'cpu' | 'gpu';

export interface OllamaASROptions {
  numThreads?: number;
  keepAlive?: string;
  numPredict?: number;
  numCtx?: number;
}

export class OllamaASR implements SpeechToText {
  private baseUrl: string;
  private modelName: string;
  private device: VoiceComputeDevice;
  private options: Required<OllamaASROptions>;
  private logger = new Logger('OllamaASR');

  constructor(
    baseUrl: string = 'http://127.0.0.1:11434',
    modelName: string = 'frozenlab/qwen3-asr:0.6b',
    initialDevice: VoiceComputeDevice = 'cpu',
    options?: OllamaASROptions
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.modelName = modelName;
    this.device = initialDevice;
    this.options = {
      numThreads: options?.numThreads ?? 8,
      keepAlive: options?.keepAlive ?? '60m',
      numPredict: options?.numPredict ?? 128,
      numCtx: options?.numCtx ?? 2048,
    };
  }

  public getDevice(): VoiceComputeDevice {
    return this.device;
  }

  public setDevice(device: VoiceComputeDevice): void {
    this.logger.info(`Switching voice model compute device to: ${device.toUpperCase()}`);
    this.device = device;
  }

  public getModelName(): string {
    return this.modelName;
  }

  public setModelName(name: string): void {
    this.modelName = name;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return (data.models || []).some((m) => m.name.includes('qwen3-asr') || m.name === this.modelName);
    } catch {
      return false;
    }
  }

  /**
   * Cleans raw output from frozenlab/qwen3-asr:0.6b.
   * Model outputs format: "language Spanish<asr_text>Hola JARVIS</asr_text>"
   */
  private cleanTranscript(raw: string): string {
    if (!raw) return '';

    let text = raw.trim();

    // 1. Extract content from <asr_text> ... </asr_text>
    if (text.includes('<asr_text>')) {
      const parts = text.split('<asr_text>');
      text = parts.length > 1 ? parts[1] : parts[0];
      if (text.includes('</asr_text>')) {
        text = text.split('</asr_text>')[0];
      }
    }

    // 2. Remove language indicators if still present
    text = text.replace(/^language\s+\w+\s*/i, '');

    // 3. Remove any remaining XML/ASR tags
    text = text.replace(/<[^>]+>/g, '').trim();

    // 4. Remove common hallucinations or punctuation artifacts on silent audio
    if (text === '嗯。' || text === '嗯' || text === '...' || text === '.') {
      return '';
    }

    return text;
  }

  /**
   * Transcribe an audio payload (base64 string of 16kHz mono WAV or buffer) using local Ollama qwen3-asr.
   * Controls execution on CPU vs GPU via num_gpu option.
   */
  public async transcribe(audio: AudioBufferData | Buffer | string): Promise<string> {
    const startTime = Date.now();
    let base64Audio: string;

    if (typeof audio === 'string') {
      base64Audio = audio.replace(/^data:audio\/\w+;base64,/, '').trim();
    } else if (Buffer.isBuffer(audio)) {
      base64Audio = audio.toString('base64');
    } else if ('data' in audio && Buffer.isBuffer(audio.data)) {
      base64Audio = audio.data.toString('base64');
    } else {
      throw new Error('Unsupported audio format for transcription');
    }

    // num_gpu: 0 forces 100% CPU inference (preserving 100% VRAM for main LLM)
    // num_gpu: -1 offloads all layers to NVIDIA GPU
    const numGpu = this.device === 'gpu' ? -1 : 0;

    this.logger.info(`Transcribing audio via ${this.modelName} on [${this.device.toUpperCase()}] (num_gpu: ${numGpu})`);

    try {
      // Use /api/chat as specified in official frozenlab/qwen3-asr Ollama packaging
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
              content: '',
              images: [base64Audio],
            },
          ],
          stream: false,
          keep_alive: this.options.keepAlive,
          options: {
            num_gpu: numGpu,
            num_thread: this.options.numThreads,
            num_predict: this.options.numPredict,
            num_ctx: this.options.numCtx,
            temperature: 0.0,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Ollama ASR request failed [${response.status}]: ${errorText || response.statusText}`);
      }

      const data = (await response.json()) as { message?: { content?: string } };
      const rawContent = data.message?.content || '';
      const transcript = this.cleanTranscript(rawContent);
      const elapsedMs = Date.now() - startTime;

      this.logger.info(`Transcription complete in ${elapsedMs}ms on ${this.device.toUpperCase()}: "${transcript}" (raw: "${rawContent}")`);
      return transcript;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Transcription failed on ${this.device.toUpperCase()}: ${errMsg}`);
      throw new Error(`ASR Error: ${errMsg}`);
    }
  }
}
