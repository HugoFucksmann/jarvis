import { Router } from 'express';
import os from 'os';
import { AgentCore } from '../../agent/AgentCore.js';
import { config } from '../../config/index.js';

interface StatusRouteDeps {
  agentCore: AgentCore;
  getGpuName: () => Promise<string>;
}

export function createStatusRoutes({ agentCore, getGpuName }: StatusRouteDeps): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    const isOllamaUp = await agentCore.getLLM().isAvailable();
    const tools = agentCore.getTools().getAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      riskLevel: t.riskLevel,
    }));

    const cpus = os.cpus();
    const totalMem = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;
    const freeMem = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10;
    const usedMem = Math.round((totalMem - freeMem) * 10) / 10;
    const memPercentage = Math.round((usedMem / totalMem) * 100);
    const gpuName = await getGpuName();

    res.json({
      status: 'ONLINE',
      version: '1.0.0',
      ollama: {
        available: isOllamaUp,
        model: agentCore.getLLM().getModel(),
        baseUrl: config.ollama.baseUrl,
      },
      hardware: {
        os: `Windows 11 (${os.platform()} / ${os.arch()})`,
        cpu: cpus.length > 0 ? `${cpus[0].model.trim()} (${cpus.length} Cores)` : 'Unknown CPU',
        gpu: gpuName,
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

  router.get('/models', async (_req, res) => {
    const models = await agentCore.getLLM().listModels();
    res.json({
      current: agentCore.getLLM().getModel(),
      models,
    });
  });

  router.post('/models/select', async (req, res) => {
    const { model } = req.body as { model?: string };
    if (!model) {
      res.status(400).json({ error: 'Missing model parameter' });
      return;
    }
    await agentCore.setModel(model);
    res.json({ success: true, model: agentCore.getLLM().getModel() });
  });

  router.get('/audit', (_req, res) => {
    const auditLogs = agentCore.getPermissionManager().getRecentAudit(50);
    res.json({ logs: auditLogs });
  });

  router.post('/tools/execute', async (req, res) => {
    const { toolName, args } = req.body as { toolName?: string; args?: Record<string, unknown> };
    if (!toolName) {
      res.status(400).json({ success: false, error: 'Missing toolName parameter' });
      return;
    }
    const tool = agentCore.getTools().getTool(toolName);
    if (!tool) {
      res.status(404).json({ success: false, error: `Tool "${toolName}" not found` });
      return;
    }
    try {
      const result = await agentCore.getTools().executeTool(toolName, args || {}, {
        workspaceRoot: config.workspaceRoot,
      });
      res.json({ success: true, result });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
