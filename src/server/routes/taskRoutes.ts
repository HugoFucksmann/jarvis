import { Router } from 'express';
import { AgentCore } from '../../agent/AgentCore.js';

export function createTaskRoutes(agentCore: AgentCore): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
    const tasks = agentCore.getTaskHistory().getRecentTasks(limit);
    res.json({ tasks });
  });

  router.delete('/', (_req, res) => {
    agentCore.getTaskHistory().clearTasks();
    res.json({ success: true });
  });

  return router;
}
