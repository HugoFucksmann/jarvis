import { INotificationChannel, NotificationPayload } from '../types.js';
import { Logger } from '../../logger/Logger.js';

export class ChannelRegistry {
  private channels = new Map<string, INotificationChannel>();
  private logger = new Logger('ChannelRegistry');

  public registerChannel(channel: INotificationChannel): void {
    this.channels.set(channel.name, channel);
    this.logger.debug(`Notification channel registered: [${channel.name}] (enabled: ${channel.isEnabled()})`);
  }

  public getChannel(name: string): INotificationChannel | undefined {
    return this.channels.get(name);
  }

  public getAllChannels(): INotificationChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Dispatches payload to all requested channels that are currently enabled.
   */
  public async dispatch(payload: NotificationPayload): Promise<{ delivered: string[]; failed: string[] }> {
    const delivered: string[] = [];
    const failed: string[] = [];

    const targetChannelNames = payload.channels.length > 0 
      ? payload.channels 
      : Array.from(this.channels.keys());

    for (const name of targetChannelNames) {
      const channel = this.channels.get(name);
      if (!channel) {
        continue;
      }

      if (!channel.isEnabled()) {
        this.logger.debug(`Channel [${name}] is disabled, skipping.`);
        continue;
      }

      try {
        const ok = await channel.send(payload);
        if (ok) {
          delivered.push(name);
        } else {
          failed.push(name);
        }
      } catch (err: unknown) {
        this.logger.error(`Error sending notification via channel [${name}]: ${String(err)}`);
        failed.push(name);
      }
    }

    return { delivered, failed };
  }
}
