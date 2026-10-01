/**
 * ExternalMessagingChannels.ts — Architecture stubs for Telegram and WhatsApp notification channels.
 * Fully decoupled and ready to activate as soon as API tokens are provided in .env.
 */

import { INotificationChannel, NotificationPayload } from '../types.js';
import { Logger } from '../../logger/Logger.js';

export class TelegramNotificationChannel implements INotificationChannel {
  public readonly name = 'telegram';
  private botToken?: string;
  private chatId?: string;
  private logger = new Logger('TelegramChannel');

  constructor(botToken?: string, chatId?: string) {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = chatId || process.env.TELEGRAM_CHAT_ID;
  }

  public isEnabled(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  public async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.debug('Telegram channel called but tokens not configured in .env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).');
      return false;
    }

    try {
      const text = `🤖 *J.A.R.V.I.S. Reminder*\n\n📌 *${payload.title}*\n${payload.message || ''}\n\n⏰ _${new Date(payload.timestamp).toLocaleString()}_`;
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
        }),
        signal: AbortSignal.timeout(6000),
      });

      return response.ok;
    } catch (err: unknown) {
      this.logger.error(`Error sending Telegram alert: ${String(err)}`);
      return false;
    }
  }
}

export class WhatsAppNotificationChannel implements INotificationChannel {
  public readonly name = 'whatsapp';
  private apiEndpoint?: string;
  private apiKey?: string;
  private targetPhone?: string;
  private logger = new Logger('WhatsAppChannel');

  constructor(endpoint?: string, key?: string, phone?: string) {
    this.apiEndpoint = endpoint || process.env.WHATSAPP_API_ENDPOINT;
    this.apiKey = key || process.env.WHATSAPP_API_KEY;
    this.targetPhone = phone || process.env.WHATSAPP_PHONE;
  }

  public isEnabled(): boolean {
    return Boolean(this.apiEndpoint && this.apiKey && this.targetPhone);
  }

  public async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.debug('WhatsApp channel called but API credentials not configured in .env.');
      return false;
    }

    try {
      const text = `*J.A.R.V.I.S. Alert*: ${payload.title}\n${payload.message || ''}`;
      const response = await fetch(this.apiEndpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          to: this.targetPhone,
          message: text,
        }),
        signal: AbortSignal.timeout(6000),
      });

      return response.ok;
    } catch (err: unknown) {
      this.logger.error(`Error sending WhatsApp alert: ${String(err)}`);
      return false;
    }
  }
}
