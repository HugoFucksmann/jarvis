import { Router, Request, Response } from 'express';
import { getSharedPlaywrightManager } from '../../browser/PlaywrightManager.js';

export function createBrowserRoutes(): Router {
  const router = Router();
  const manager = getSharedPlaywrightManager();

  // GET /api/browser/status - Engine status and active page
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const status = manager.getStatus();
      res.json({ success: true, data: status });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // POST /api/browser/navigate - Navigate to URL
  router.post('/navigate', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'Parámetro "url" requerido.' });
        return;
      }
      const result = await manager.navigate(url);
      res.json({ success: result.success, data: result });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // POST /api/browser/extract - Extract clean page content
  router.post('/extract', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      const content = await manager.extractContent(url);
      res.json({ success: true, data: content });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // POST /api/browser/click - Click element
  router.post('/click', async (req: Request, res: Response) => {
    try {
      const { selector } = req.body;
      if (!selector) {
        res.status(400).json({ success: false, error: 'Parámetro "selector" requerido.' });
        return;
      }
      const result = await manager.click(selector);
      res.json({ success: result.success, data: result });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // POST /api/browser/close - Close session
  router.post('/close', async (_req: Request, res: Response) => {
    try {
      await manager.close();
      res.json({ success: true, message: 'Navegador cerrado con éxito.' });
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
