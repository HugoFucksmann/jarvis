import { Router } from 'express';
import { config, updateThinkingConfig } from '../../config/index.js';
import { Logger } from '../../logger/Logger.js';

const logger = new Logger('SettingsRoutes');

export function createSettingsRoutes(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      thinking: config.ollama.thinking,
      model: config.ollama.model,
      numCtx: config.ollama.numCtx,
      voiceDevice: config.voice.device,
    });
  });

  router.post('/thinking', (req, res) => {
    const { thinking } = req.body as { thinking?: boolean };
    if (typeof thinking !== 'boolean') {
      res.status(400).json({ error: 'thinking must be a boolean' });
      return;
    }
    updateThinkingConfig(thinking);
    logger.info(`Reasoning mode changed: ${thinking ? 'DEEP THINKING' : 'TURBO (<1s)'}`);
    res.json({ success: true, thinking: config.ollama.thinking });
  });

  return router;
}
