import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, updateVoiceDeviceConfig, updateThinkingConfig } from '../config/index.js';
import { AgentCore } from '../agent/AgentCore.js';
import { Logger } from '../logger/Logger.js';
import { AgentEvent } from '../agent/types.js';
import { RiskLevel } from '../tools/types.js';
import { OllamaASR, VoiceComputeDevice } from '../modalities/OllamaASR.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('Server');
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '50mb' }));

// Serve static frontend files
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

// Initialize Agent Core & Voice ASR
const agentCore = new AgentCore();
const voiceASR = new OllamaASR(
  config.ollama.baseUrl,
  config.voice.model,
  config.voice.device
);

// Store active pending approval promises: approvalId -> resolve callback
const pendingApprovals = new Map<string, (approved: boolean) => void>();

// REST APIs
let cachedGpuName = 'Detectando...';
try {
  if (process.platform === 'win32') {
    const { execSync } = await import('child_process');
    const out = execSync('powershell -Command "(Get-CimInstance Win32_VideoController).Name"', { encoding: 'utf-8', timeout: 3000 });
    cachedGpuName = out.trim().split('\r\n').filter(Boolean).join(', ');
  }
} catch {
  cachedGpuName = 'NVIDIA GeForce RTX 3070 Ti';
}

app.get('/api/status', async (_req, res) => {
  const osModule = await import('os');
  const isOllamaUp = await agentCore.getLLM().isAvailable();
  const tools = agentCore.getTools().getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    riskLevel: t.riskLevel,
  }));

  const cpus = osModule.default.cpus();
  const totalMem = Math.round((osModule.default.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;
  const freeMem = Math.round((osModule.default.freemem() / (1024 * 1024 * 1024)) * 10) / 10;
  const usedMem = Math.round((totalMem - freeMem) * 10) / 10;
  const memPercentage = Math.round((usedMem / totalMem) * 100);

  res.json({
    status: 'ONLINE',
    version: '1.0.0',
    ollama: {
      available: isOllamaUp,
      model: agentCore.getLLM().getModel(),
      baseUrl: config.ollama.baseUrl,
    },
    hardware: {
      os: `Windows 11 (${osModule.default.platform()} / ${osModule.default.arch()})`,
      cpu: cpus.length > 0 ? `${cpus[0].model.trim()} (${cpus.length} Cores)` : 'Intel Core i7-12700F',
      gpu: cachedGpuName || 'NVIDIA GeForce RTX 3070 Ti',
      ram: {
        totalGB: totalMem,
        usedGB: usedMem,
        freeGB: freeMem,
        percentage: memPercentage,
      },
    },
    toolsCount: tools.length,
    tools,
    workspaceRoot: config.workspaceRoot,
  });
});

app.get('/api/models', async (_req, res) => {
  const models = await agentCore.getLLM().listModels();
  res.json({
    current: agentCore.getLLM().getModel(),
    models,
  });
});

app.post('/api/models/select', async (req, res) => {
  const { model } = req.body as { model?: string };
  if (!model) {
    res.status(400).json({ error: 'Missing model parameter' });
    return;
  }
  await agentCore.setModel(model);
  res.json({ success: true, model: agentCore.getLLM().getModel() });
});

app.get('/api/audit', (_req, res) => {
  const auditLogs = agentCore.getPermissionManager().getRecentAudit(50);
  res.json({ logs: auditLogs });
});

app.get('/api/memory', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;
  const facts = await agentCore.getMemory().queryLongTermFacts(query);
  res.json({ facts });
});

app.post('/api/memory', async (req, res) => {
  const { category, content } = req.body as { category?: 'preference' | 'project' | 'environment' | 'general'; content?: string };
  if (!content) {
    res.status(400).json({ error: 'Missing content parameter' });
    return;
  }
  try {
    const fact = await agentCore.getMemory().addLongTermFact(category || 'general', content);
    res.json({ success: true, fact });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/memory/:id', async (req, res) => {
  const success = await agentCore.getMemory().deleteLongTermFact(req.params.id);
  res.json({ success });
});

// Voice Endpoints (Ollama frozenlab/qwen3-asr:0.6b)
app.get('/api/voice/status', async (_req, res) => {
  const isAvailable = await voiceASR.isAvailable();
  res.json({
    enabled: config.features.voiceEnabled,
    model: voiceASR.getModelName(),
    device: voiceASR.getDevice(),
    isAvailable,
    recommendation: 'CPU (Recomendado: 0 VRAM, evita desalojo/swapping con el modelo 9B en los 8GB de la GPU)',
  });
});

app.post('/api/voice/device', (req, res) => {
  const { device } = req.body as { device?: VoiceComputeDevice };
  if (device !== 'cpu' && device !== 'gpu') {
    res.status(400).json({ error: 'Device must be either "cpu" or "gpu"' });
    return;
  }
  voiceASR.setDevice(device);
  updateVoiceDeviceConfig(device);
  logger.info(`Voice compute device switched to: ${device.toUpperCase()}`);
  res.json({ success: true, device: voiceASR.getDevice() });
});

app.post('/api/voice/transcribe', async (req, res) => {
  const { audio } = req.body as { audio?: string };
  if (!audio) {
    res.status(400).json({ error: 'Missing audio base64 payload' });
    return;
  }

  try {
    const text = await voiceASR.transcribe(audio);
    res.json({ success: true, text, device: voiceASR.getDevice() });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errMsg });
  }
});

// Performance & Thinking Mode settings
app.get('/api/settings', (_req, res) => {
  res.json({
    thinking: config.ollama.thinking,
    model: config.ollama.model,
    numCtx: config.ollama.numCtx,
    voiceDevice: config.voice.device,
  });
});

app.post('/api/settings/thinking', (req, res) => {
  const { thinking } = req.body as { thinking?: boolean };
  if (typeof thinking !== 'boolean') {
    res.status(400).json({ error: 'thinking must be a boolean' });
    return;
  }
  updateThinkingConfig(thinking);
  logger.info(`Reasoning mode changed: ${thinking ? 'DEEP THINKING' : 'TURBO (<1s)'}`);
  res.json({ success: true, thinking: config.ollama.thinking });
});

// WebSocket Handler
wss.on('connection', (ws: WebSocket) => {
  logger.info('WebSocket client connected to JARVIS interface.');
  let currentTaskId: string | null = null;

  const send = (type: string, payload: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  };

  ws.on('message', async (data: string) => {
    try {
      const message = JSON.parse(data.toString()) as {
        type: string;
        payload: Record<string, unknown>;
      };

      if (message.type === 'chat_message') {
        const prompt = message.payload.prompt as string;
        const sessionId = (message.payload.sessionId as string) || 'default';

        if (!prompt || !prompt.trim()) return;

        logger.info(`Received prompt from client: "${prompt.substring(0, 50)}..."`);

        // Execute task with real-time streaming and approval hooks
        const resultPromise = agentCore.runTask(prompt, sessionId, {
          onEvent: (event: AgentEvent) => {
            send('agent_event', event as unknown as Record<string, unknown>);
          },
          requestApproval: async (toolName: string, args: Record<string, unknown>, risk: RiskLevel, reason: string) => {
            const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            send('approval_required', {
              approvalId,
              toolName,
              args,
              riskLevel: risk,
              reason,
            });

            return new Promise<boolean>((resolve) => {
              pendingApprovals.set(approvalId, resolve);

              // 60-second auto-reject timeout if user doesn't respond
              setTimeout(() => {
                if (pendingApprovals.has(approvalId)) {
                  pendingApprovals.delete(approvalId);
                  resolve(false);
                }
              }, 60000);
            });
          },
        });

        const taskResult = await resultPromise;
        currentTaskId = taskResult.taskId;
        send('task_finished', taskResult as unknown as Record<string, unknown>);
      } else if (message.type === 'approval_response') {
        const { approvalId, approved } = message.payload as { approvalId: string; approved: boolean };
        const resolver = pendingApprovals.get(approvalId);
        if (resolver) {
          resolver(approved);
          pendingApprovals.delete(approvalId);
          logger.info(`User responded to approval [${approvalId}]: ${approved ? 'APPROVED' : 'DENIED'}`);
        }
      } else if (message.type === 'cancel_task') {
        if (currentTaskId) {
          agentCore.cancelTask(currentTaskId);
          send('task_cancelled', { taskId: currentTaskId });
        }
      }
    } catch (err: unknown) {
      logger.error(`Error processing WebSocket message: ${err instanceof Error ? err.message : String(err)}`);
      send('error', { message: 'Internal server error processing command.' });
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket client disconnected.');
  });
});

// Start Server
const PORT = config.server.port;
server.listen(PORT, config.server.host, () => {
  logger.info(`====================================================`);
  logger.info(`  J.A.R.V.I.S. Core Interface Online                `);
  logger.info(`  Server running at: http://${config.server.host}:${PORT}`);
  logger.info(`  LLM Provider: Ollama (${config.ollama.model})      `);
  logger.info(`  Workspace: ${config.workspaceRoot}               `);
  logger.info(`====================================================`);
});
