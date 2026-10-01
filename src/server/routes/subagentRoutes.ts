import { Router, Request, Response } from 'express';
import { getSharedSubagentManager } from '../../subagents/SubagentManager.js';
import { SubagentConfig } from '../../subagents/types.js';

export function createSubagentRoutes(): Router {
  const router = Router();
  const manager = getSharedSubagentManager();

  // GET /api/subagents - List all background subagents
  router.get('/', (req: Request, res: Response) => {
    try {
      const statusFilter = (req.query.status as string) || 'all';
      let list = manager.listSubagents();

      if (statusFilter !== 'all') {
        list = list.filter((s) => s.status === statusFilter);
      }

      res.json({
        success: true,
        data: {
          count: list.length,
          subagents: list,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /api/subagents/:id - Get subagent details with logs
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const record = manager.getSubagent(req.params.id);
      if (!record) {
        res.status(404).json({ success: false, error: 'Subagente no encontrado.' });
        return;
      }

      res.json({
        success: true,
        data: record,
      });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // POST /api/subagents/delegate - Spawn a subagent
  router.post('/delegate', (req: Request, res: Response) => {
    try {
      const { title, taskPrompt, type, command, notifyChannels } = req.body as SubagentConfig;

      if (!title || !taskPrompt) {
        res.status(400).json({
          success: false,
          error: 'Campos requeridos: "title" y "taskPrompt".',
        });
        return;
      }

      const record = manager.spawnSubagent({
        title,
        taskPrompt,
        type,
        command,
        notifyChannels,
      });

      res.status(201).json({
        success: true,
        data: record,
      });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // POST /api/subagents/:id/cancel - Cancel a running subagent
  router.post('/:id/cancel', (req: Request, res: Response) => {
    try {
      const cancelled = manager.cancelSubagent(req.params.id);
      if (!cancelled) {
        res.status(400).json({
          success: false,
          error: 'No se pudo cancelar el subagente (no encontrado o ya finalizado).',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Subagente cancelado correctamente.',
      });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
