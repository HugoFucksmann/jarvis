import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config();

export interface JarvisConfig {
  ollama: {
    baseUrl: string;
    model: string;
    temperature: number;
    numCtx: number;
    keepAlive: string;
    thinking: boolean;
  };
  server: {
    port: number;
    host: string;
  };
  agent: {
    maxIterations: number;
    timeoutSeconds: number;
  };
  features: {
    memoryEnabled: boolean;
    webSearchEnabled: boolean;
    voiceEnabled: boolean;
    visionEnabled: boolean;
  };
  voice: {
    model: string;
    device: 'cpu' | 'gpu';
    numThreads: number;
    keepAlive: string;
    numPredict: number;
    numCtx: number;
  };
  security: {
    autoApproveLowRisk: boolean;
    autoApproveMediumRisk: boolean;
    autoApproveHighRisk: boolean;
  };
  workspaceRoot: string;
}

export const config: JarvisConfig = {
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL || 'qwen3.5:9b',
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.1'),
    numCtx: parseInt(process.env.OLLAMA_NUM_CTX || '8192', 10),
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '60m',
    thinking: process.env.OLLAMA_THINKING === 'true', // Turbo by default (false = 22x faster)
  },
  voice: {
    model: process.env.VOICE_MODEL || 'frozenlab/qwen3-asr:0.6b',
    device: (process.env.VOICE_DEVICE === 'gpu' ? 'gpu' : 'cpu') as 'cpu' | 'gpu',
    numThreads: parseInt(process.env.VOICE_NUM_THREADS || '8', 10),
    keepAlive: process.env.VOICE_KEEP_ALIVE || '60m',
    numPredict: parseInt(process.env.VOICE_NUM_PREDICT || '128', 10),
    numCtx: parseInt(process.env.VOICE_NUM_CTX || '2048', 10),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '127.0.0.1',
  },
  agent: {
    maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS || '15', 10),
    timeoutSeconds: parseInt(process.env.AGENT_TIMEOUT_SECONDS || '180', 10),
  },
  features: {
    memoryEnabled: process.env.MEMORY_ENABLED !== 'false',
    webSearchEnabled: process.env.WEB_SEARCH_ENABLED !== 'false',
    voiceEnabled: process.env.VOICE_ENABLED !== 'false',
    visionEnabled: process.env.VISION_ENABLED === 'true',
  },
  security: {
    autoApproveLowRisk: process.env.AUTO_APPROVE_LOW_RISK !== 'false',
    autoApproveMediumRisk: process.env.AUTO_APPROVE_MEDIUM_RISK === 'true',
    autoApproveHighRisk: process.env.AUTO_APPROVE_HIGH_RISK === 'true',
  },
  workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT || process.cwd()),
};

export function updateModelConfig(newModel: string): void {
  config.ollama.model = newModel;
}

export function updateVoiceDeviceConfig(device: 'cpu' | 'gpu'): void {
  config.voice.device = device;
}

export function updateThinkingConfig(thinking: boolean): void {
  config.ollama.thinking = thinking;
}
