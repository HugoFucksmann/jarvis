import { Router } from 'express';
import { OllamaASR, VoiceComputeDevice } from '../../modalities/OllamaASR.js';
import { config, updateVoiceDeviceConfig } from '../../config/index.js';
import { Logger } from '../../logger/Logger.js';

const logger = new Logger('VoiceRoutes');

export function createVoiceRoutes(voiceASR: OllamaASR): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    const isAvailable = await voiceASR.isAvailable();
    res.json({
      enabled: config.features.voiceEnabled,
      model: voiceASR.getModelName(),
      device: voiceASR.getDevice(),
      isAvailable,
      recommendation:
        'CPU (Recomendado: 0 VRAM, evita desalojo/swapping con el modelo 9B en los 8GB de la GPU)',
    });
  });

  router.post('/device', (req, res) => {
    const { device } = req.body as { device?: VoiceComputeDevice };
    if (device !== 'cpu' && device !== 'gpu') {
      res.status(400).json({ error: 'Device must be either "cpu" or "gpu"' });
      return;
    }
    voiceASR.setDevice(device);
    updateVoiceDeviceConfig(device);
    logger.info(`Voice compute device switched to: ${device.toUpperCase()}`);
    res.json({ success: true, device: voiceASR.getDevice() });
  });

  router.post('/transcribe', async (req, res) => {
    const { audio } = req.body as { audio?: string };
    if (!audio) {
      res.status(400).json({ error: 'Missing audio base64 payload' });
      return;
    }

    try {
      const text = await voiceASR.transcribe(audio);
      res.json({ success: true, text, device: voiceASR.getDevice() });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: errMsg });
    }
  });

  router.get('/wakeword', (_req, res) => {
    res.json({
      enabled: config.wakeWord.enabled,
      keywords: config.wakeWord.keywords,
      autoDismissSeconds: config.wakeWord.autoDismissSeconds,
    });
  });

  router.post('/wakeword/toggle', (req, res) => {
    const { enabled } = req.body as { enabled?: boolean };
    const newStatus = enabled !== undefined ? !!enabled : !config.wakeWord.enabled;
    config.wakeWord.enabled = newStatus;
    logger.info(`Wake word detection toggled: ${newStatus ? 'ENABLED' : 'DISABLED'}`);
    res.json({ success: true, enabled: config.wakeWord.enabled });
  });

  return router;
}
