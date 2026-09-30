import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { AgentCore } from '../../agent/AgentCore.js';
import { config } from '../../config/index.js';

export function createMemoryRoutes(agentCore: AgentCore): Router {
  const router = Router();

  // GET /api/memory?q=query — query structured long-term facts
  router.get('/', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const facts = await agentCore.getMemory().queryLongTermFacts(query);
    res.json({ facts });
  });

  // POST /api/memory — add a structured fact
  router.post('/', async (req, res) => {
    const { category, content } = req.body as {
      category?: 'preference' | 'project' | 'environment' | 'general';
      content?: string;
    };
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

  // DELETE /api/memory/:id — remove a specific fact
  router.delete('/:id', async (req, res) => {
    const success = await agentCore.getMemory().deleteLongTermFact(req.params.id);
    res.json({ success });
  });

  // GET /api/memory/raw — read MEMORY.md as free-form text (for the UI editor)
  router.get('/raw', async (_req, res) => {
    const content = await agentCore.getMemory().getRawPersistentMemory();
    res.json({ content });
  });

  // POST /api/memory/raw — overwrite MEMORY.md from the UI editor
  router.post('/raw', async (req, res) => {
    const { content } = req.body as { content?: string };
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' });
      return;
    }
    await agentCore.getMemory().saveRawPersistentMemory(content);
    res.json({ success: true });
  });

  return router;
}
