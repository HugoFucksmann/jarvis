import { INotificationChannel, NotificationPayload } from '../types.js';
import { Logger } from '../../logger/Logger.js';

export type WebSocketBroadcaster = (type: string, payload: Record<string, unknown>) => void;

let globalBroadcaster: WebSocketBroadcaster | null = null;

export function setSchedulerWebSocketBroadcaster(broadcaster: WebSocketBroadcaster): void {
  globalBroadcaster = broadcaster;
}

export class HudWebSocketChannel implements INotificationChannel {
  public readonly name = 'hud_websocket';
  private logger = new Logger('HudWebSocketChannel');

  public isEnabled(): boolean {
    return true;
  }

  public async send(payload: NotificationPayload): Promise<boolean> {
    if (globalBroadcaster) {
      globalBroadcaster('scheduler_reminder_alert', {
        id: payload.id,
        title: payload.title,
        message: payload.message,
        priority: payload.priority,
        timestamp: payload.timestamp,
        metadata: payload.metadata,
      });
      this.logger.debug(`Broadcasted reminder alert to WebSocket clients: "${payload.title}"`);
      return true;
    }
    return false;
  }
}

export class VoiceTTSChannel implements INotificationChannel {
  public readonly name = 'voice_tts';
  private logger = new Logger('VoiceTTSChannel');

  public isEnabled(): boolean {
    return true;
  }

  public async send(payload: NotificationPayload): Promise<boolean> {
    // When enabled, sends a voice instruction to WebSocket or audio subsystem to speak
    const speechText = `Señor, recordatorio: ${payload.title}. ${payload.message || ''}`.trim();
    if (globalBroadcaster) {
      globalBroadcaster('speak_alert', {
        text: speechText,
        priority: payload.priority,
      });
      this.logger.info(`Dispatched voice speech alert: "${speechText}"`);
      return true;
    }
    return false;
  }
}
