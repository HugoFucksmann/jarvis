import { Router } from 'express';
import { MediaControlTool } from '../../tools/builtins/mediaTools.js';
import { config } from '../../config/index.js';
import { Logger } from '../../logger/Logger.js';

const logger = new Logger('MediaRoutes');
const mediaTool = new MediaControlTool();

export function createMediaRoutes(): Router {
  const router = Router();

  /**
   * Get currently playing track from Spotify or browsers
   */
  router.get('/now-playing', async (_req, res) => {
    try {
      const result = await mediaTool.execute(
        { action: 'now_playing' },
        { workspaceRoot: config.workspaceRoot }
      );
      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /**
   * Trigger media transport controls (play_pause, next, previous, stop)
   */
  router.post('/control', async (req, res) => {
    const { action } = req.body as { action?: string };
    if (!action || !['play_pause', 'next', 'previous', 'stop'].includes(action)) {
      res.status(400).json({
        success: false,
        error: 'Invalid action. Must be one of: "play_pause", "next", "previous", "stop".',
      });
      return;
    }

    try {
      const result = await mediaTool.execute(
        { action },
        { workspaceRoot: config.workspaceRoot }
      );
      logger.info(`Media transport action executed: ${action}`);
      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /**
   * Play or search on Spotify
   */
  router.post('/spotify', async (req, res) => {
    const { query, targetApp } = req.body as { query?: string; targetApp?: 'app' | 'web' };
    if (!query) {
      res.status(400).json({ success: false, error: 'Missing "query" parameter' });
      return;
    }

    try {
      const result = await mediaTool.execute(
        { action: 'play_spotify', query, targetApp: targetApp || 'app' },
        { workspaceRoot: config.workspaceRoot }
      );
      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /**
   * Play or search on YouTube / YouTube Music
   */
  router.post('/youtube', async (req, res) => {
    const { query, service } = req.body as { query?: string; service?: 'youtube' | 'youtube_music' };
    if (!query) {
      res.status(400).json({ success: false, error: 'Missing "query" parameter' });
      return;
    }

    try {
      const result = await mediaTool.execute(
        { action: 'play_youtube', query, service: service || 'youtube' },
        { workspaceRoot: config.workspaceRoot }
      );
      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  return router;
}
