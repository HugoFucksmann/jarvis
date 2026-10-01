import { Router } from 'express';
import { OllamaVisionProvider, VisionComputeDevice } from '../../modalities/OllamaVision.js';
import {
  config,
  updateVisionDeviceConfig,
  updateVisionModelConfig,
} from '../../config/index.js';
import { Logger } from '../../logger/Logger.js';

const logger = new Logger('VisionRoutes');

export function createVisionRoutes(visionProvider: OllamaVisionProvider): Router {
  const router = Router();

  /**
   * Status and capabilities of the local vision subsystem
   */
  router.get('/status', async (_req, res) => {
    const isSupported = await visionProvider.isVisionSupported();
    res.json({
      enabled: config.features.visionEnabled,
      model: visionProvider.getModelName(),
      device: visionProvider.getDevice(),
      isAvailable: isSupported,
      maxWidth: config.vision.maxWidth,
      quality: config.vision.quality,
      recommendation:
        visionProvider.getDevice() === 'gpu'
          ? 'GPU (Máxima velocidad de inferencia visual)'
          : 'CPU (Ahorra VRAM si el modelo principal está cargado en GPU)',
    });
  });

  /**
   * Switch vision compute device (CPU vs GPU)
   */
  router.post('/device', (req, res) => {
    const { device } = req.body as { device?: VisionComputeDevice };
    if (device !== 'cpu' && device !== 'gpu') {
      res.status(400).json({ error: 'Device must be either "cpu" or "gpu"' });
      return;
    }
    visionProvider.setDevice(device);
    updateVisionDeviceConfig(device);
    logger.info(`Vision compute device switched to: ${device.toUpperCase()}`);
    res.json({ success: true, device: visionProvider.getDevice() });
  });

  /**
   * Switch vision model
   */
  router.post('/model', (req, res) => {
    const { model } = req.body as { model?: string };
    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "model" parameter' });
      return;
    }
    visionProvider.setModelName(model);
    updateVisionModelConfig(model);
    logger.info(`Vision model switched to: ${model}`);
    res.json({ success: true, model: visionProvider.getModelName() });
  });

  /**
   * Direct screenshot capture endpoint
   */
  router.post('/screenshot', async (req, res) => {
    const { target, format, analyzePrompt } = req.body as {
      target?: 'screen' | 'active_window';
      format?: 'png' | 'jpeg';
      analyzePrompt?: string;
    };

    try {
      const captureResult = await visionProvider.captureScreen({
        target: target === 'active_window' ? 'active_window' : 'screen',
        format: format === 'png' ? 'png' : 'jpeg',
      });

      let analysis: string | undefined;
      if (analyzePrompt && typeof analyzePrompt === 'string') {
        try {
          analysis = await visionProvider.describeImage(
            { path: captureResult.path },
            analyzePrompt
          );
        } catch (visionErr: unknown) {
          analysis = `[Aviso: Análisis falló: ${visionErr instanceof Error ? visionErr.message : String(visionErr)}]`;
        }
      }

      res.json({
        success: true,
        path: captureResult.path,
        dimensions: `${captureResult.width}x${captureResult.height}`,
        target: captureResult.target,
        mimeType: captureResult.mimeType,
        fileSizeBytes: captureResult.fileSizeBytes,
        timestamp: captureResult.timestamp,
        base64: `data:${captureResult.mimeType};base64,${captureResult.base64}`,
        analysis,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Screenshot route error: ${errMsg}`);
      res.status(500).json({ success: false, error: errMsg });
    }
  });

  /**
   * Direct image analysis endpoint
   */
  router.post('/analyze', async (req, res) => {
    const { path: imagePath, image: base64Image, prompt } = req.body as {
      path?: string;
      image?: string;
      prompt?: string;
    };

    if (!prompt) {
      res.status(400).json({ error: 'Missing "prompt" parameter' });
      return;
    }

    if (!imagePath && !base64Image) {
      res.status(400).json({ error: 'Must provide either "path" or "image" (base64)' });
      return;
    }

    try {
      const input = imagePath ? { path: imagePath } : { base64: base64Image };
      const analysis = await visionProvider.describeImage(input, prompt);
      res.json({ success: true, analysis });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: errMsg });
    }
  });

  return router;
}
