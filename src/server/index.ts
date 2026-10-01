import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { AgentCore } from '../agent/AgentCore.js';
import { Logger } from '../logger/Logger.js';
import { OllamaASR } from '../modalities/OllamaASR.js';

// Route modules
import { createStatusRoutes } from './routes/statusRoutes.js';
import { createSecurityRoutes } from './routes/securityRoutes.js';
import { createTaskRoutes } from './routes/taskRoutes.js';
import { createMemoryRoutes } from './routes/memoryRoutes.js';
import { createVoiceRoutes } from './routes/voiceRoutes.js';
import { createVisionRoutes } from './routes/visionRoutes.js';
import { createMediaRoutes } from './routes/mediaRoutes.js';
import { createSchedulerRoutes } from './routes/schedulerRoutes.js';
import { createSettingsRoutes } from './routes/settingsRoutes.js';
import { createSubagentRoutes } from './routes/subagentRoutes.js';
import { createBrowserRoutes } from './routes/browserRoutes.js';
import { attachWsHandler } from './ws/wsHandler.js';
import { getSharedVisionProvider } from '../tools/builtins/visionTools.js';
import { setSchedulerWebSocketBroadcaster } from '../scheduler/channels/HudChannels.js';
import { getSharedSubagentManager } from '../subagents/SubagentManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('Server');

// ─── HTTP + WebSocket server ─────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '50mb' }));

// Static frontend assets
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

// ─── Core services ───────────────────────────────────────────────────────────
const agentCore = new AgentCore();
const voiceASR = new OllamaASR(
  config.ollama.baseUrl,
  config.voice.model,
  config.voice.device,
  {
    numThreads: config.voice.numThreads,
    keepAlive: config.voice.keepAlive,
    numPredict: config.voice.numPredict,
    numCtx: config.voice.numCtx,
  }
);

// GPU name is resolved asynchronously in the background, never blocking API routes.
let _cachedGpuName = 'Detectando GPU...';
if (process.platform === 'win32') {
  import('child_process').then(({ exec }) => {
    exec(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join \', \'"',
      { timeout: 3000 },
      (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          _cachedGpuName = stdout.trim();
        } else {
          _cachedGpuName = 'GPU de Sistema';
        }
      }
    );
  }).catch(() => {
    _cachedGpuName = 'GPU de Sistema';
  });
} else {
  _cachedGpuName = 'N/A';
}

function getGpuName(): Promise<string> {
  return Promise.resolve(_cachedGpuName);
}

// ─── API routes ──────────────────────────────────────────────────────────────
app.use('/api', createStatusRoutes({ agentCore, getGpuName }));
app.use('/api/security', createSecurityRoutes(agentCore));
app.use('/api/tasks', createTaskRoutes(agentCore));
app.use('/api/memory', createMemoryRoutes(agentCore));
app.use('/api/voice', createVoiceRoutes(voiceASR));
app.use('/api/vision', createVisionRoutes(getSharedVisionProvider()));
app.use('/api/media', createMediaRoutes());
app.use('/api/scheduler', createSchedulerRoutes());
app.use('/api/settings', createSettingsRoutes());
app.use('/api/subagents', createSubagentRoutes());
app.use('/api/browser', createBrowserRoutes());

// ─── WebSocket ───────────────────────────────────────────────────────────────
attachWsHandler(wss, agentCore);

// Connect scheduler alerts to all open WebSocket connections in real time
setSchedulerWebSocketBroadcaster((type, payload) => {
  const data = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(data);
    }
  });
});

// Connect subagent events to all open WebSocket connections in real time
const subagentManager = getSharedSubagentManager(() => agentCore);
subagentManager.on('event', (event) => {
  const data = JSON.stringify({ type: 'subagent_event', payload: event });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(data);
    }
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = config.server.port;
server.listen(PORT, config.server.host, () => {
  logger.info(`====================================================`);
  logger.info(`  J.A.R.V.I.S. Core Interface Online                `);
  logger.info(`  Server running at: http://${config.server.host}:${PORT}`);
  logger.info(`  LLM Provider: Ollama (${config.ollama.model})      `);
  logger.info(`  Workspace: ${config.workspaceRoot}               `);
  logger.info(`====================================================`);
});
