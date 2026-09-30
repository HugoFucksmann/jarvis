import { Router } from 'express';
import { AgentCore } from '../../agent/AgentCore.js';

export function createSecurityRoutes(agentCore: AgentCore): Router {
  const router = Router();

  router.get('/permissions', (_req, res) => {
    res.json({
      rules: agentCore.getPermissionManager().getSecurityRules(),
    });
  });

  router.post('/permissions', (req, res) => {
    const updated = agentCore.getPermissionManager().saveSecurityRules(req.body);
    res.json({ success: true, rules: updated });
  });

  return router;
}
