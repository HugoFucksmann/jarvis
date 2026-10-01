import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  Reminder,
  CreateReminderInput,
  StickyNote,
  WatcherConfig,
  NotificationPayload,
  PriorityLevel,
} from './types.js';
import { ChannelRegistry } from './channels/ChannelRegistry.js';
import { WindowsToastChannel } from './channels/WindowsToastChannel.js';
import { HudWebSocketChannel, VoiceTTSChannel } from './channels/HudChannels.js';
import {
  TelegramNotificationChannel,
  WhatsAppNotificationChannel,
} from './channels/ExternalMessagingChannels.js';
import { Logger } from '../logger/Logger.js';
import { config } from '../config/index.js';

export interface SchedulerStorageData {
  reminders: Reminder[];
  notes: StickyNote[];
  watchers: WatcherConfig[];
}

export class TaskScheduler {
  private channelRegistry: ChannelRegistry;
  private reminders: Map<string, Reminder> = new Map();
  private notes: Map<string, StickyNote> = new Map();
  private watchers: Map<string, WatcherConfig> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private watcherTimer: NodeJS.Timeout | null = null;
  private storageFilePath: string;
  private logger = new Logger('TaskScheduler');
  private onActionCommandCallback?: (command: string) => Promise<void>;

  constructor(workspaceRoot: string = config.workspaceRoot) {
    this.storageFilePath = path.join(workspaceRoot, '.jarvis', 'reminders.json');

    // 1. Initialize channel registry with default and future channels
    this.channelRegistry = new ChannelRegistry();
    this.channelRegistry.registerChannel(new WindowsToastChannel());
    this.channelRegistry.registerChannel(new VoiceTTSChannel());
    this.channelRegistry.registerChannel(new HudWebSocketChannel());
    this.channelRegistry.registerChannel(new TelegramNotificationChannel());
    this.channelRegistry.registerChannel(new WhatsAppNotificationChannel());

    // 2. Load persisted data
    this.loadFromDisk();

    // 3. Start scheduler execution tickers
    this.startTicker();
    this.startWatcherTicker();

    this.logger.info(`TaskScheduler initialized with ${this.reminders.size} reminders, ${this.notes.size} notes.`);
  }

  public getChannelRegistry(): ChannelRegistry {
    return this.channelRegistry;
  }

  public setOnActionCommand(cb: (command: string) => Promise<void>): void {
    this.onActionCommandCallback = cb;
  }

  /**
   * Loads reminders, notes, and watchers from persistent disk JSON.
   */
  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const data = JSON.parse(raw) as Partial<SchedulerStorageData>;

        if (Array.isArray(data.reminders)) {
          for (const rem of data.reminders) {
            this.reminders.set(rem.id, rem);
          }
        }
        if (Array.isArray(data.notes)) {
          for (const note of data.notes) {
            this.notes.set(note.id, note);
          }
        }
        if (Array.isArray(data.watchers)) {
          for (const watcher of data.watchers) {
            this.watchers.set(watcher.id, watcher);
          }
        }
      } else {
        // Initialize with default hardware watcher
        this.registerDefaultWatchers();
        this.saveToDisk();
      }
    } catch (err: unknown) {
      this.logger.error(`Error loading scheduler data: ${String(err)}`);
    }
  }

  /**
   * Atomically persists reminders and notes to disk.
   */
  private saveToDisk(): void {
    try {
      const parentDir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const payload: SchedulerStorageData = {
        reminders: Array.from(this.reminders.values()),
        notes: Array.from(this.notes.values()),
        watchers: Array.from(this.watchers.values()),
      };

      fs.writeFileSync(this.storageFilePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err: unknown) {
      this.logger.error(`Error saving scheduler data: ${String(err)}`);
    }
  }

  private registerDefaultWatchers(): void {
    const defaultWatchers: WatcherConfig[] = [
      {
        id: 'watcher_ram_high',
        name: 'Memoria RAM Saturada',
        target: 'ram',
        threshold: 92, // alert if RAM > 92%
        condition: 'above',
        intervalSeconds: 120,
        enabled: true,
        alertCooldownMinutes: 30,
        messageTemplate: 'La memoria RAM del sistema ha superado el 92%. Considere cerrar procesos pesados.',
      },
    ];

    for (const w of defaultWatchers) {
      this.watchers.set(w.id, w);
    }
  }

  /**
   * Main reminder evaluation loop (runs every 1000ms).
   */
  private startTicker(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.evaluateReminders();
    }, 1000);
  }

  /**
   * Proactive hardware watcher evaluation loop (runs every 30s).
   */
  private startWatcherTicker(): void {
    if (this.watcherTimer) clearInterval(this.watcherTimer);
    this.watcherTimer = setInterval(() => {
      this.evaluateWatchers();
    }, 30000);
  }

  private async evaluateReminders(): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();

    for (const reminder of this.reminders.values()) {
      if (reminder.completed) continue;

      if (reminder.dueAt <= nowIso) {
        this.logger.info(`Reminder due: [${reminder.id}] "${reminder.title}"`);

        // Dispatch notifications to registered channels
        const payload: NotificationPayload = {
          id: reminder.id,
          title: reminder.title,
          message: reminder.message || 'Alerta de recordatorio de JARVIS',
          priority: reminder.priority,
          timestamp: reminder.dueAt,
          channels: reminder.channels,
          metadata: reminder.metadata,
        };

        await this.channelRegistry.dispatch(payload);

        // Execute action command if present (Deferred Agent Action)
        if (reminder.actionCommand && this.onActionCommandCallback) {
          try {
            this.logger.info(`Executing deferred action command: "${reminder.actionCommand}"`);
            await this.onActionCommandCallback(reminder.actionCommand);
          } catch (cmdErr: unknown) {
            this.logger.error(`Error running deferred action command: ${String(cmdErr)}`);
          }
        }

        // Handle recurrence
        if (reminder.recurring || (reminder.intervalMinutes && reminder.intervalMinutes > 0)) {
          const nextDue = new Date(now.getTime());
          if (reminder.recurring === 'hourly') {
            nextDue.setHours(nextDue.getHours() + 1);
          } else if (reminder.recurring === 'daily') {
            nextDue.setDate(nextDue.getDate() + 1);
          } else if (reminder.recurring === 'weekly') {
            nextDue.setDate(nextDue.getDate() + 7);
          } else if (reminder.intervalMinutes) {
            nextDue.setMinutes(nextDue.getMinutes() + reminder.intervalMinutes);
          }
          reminder.dueAt = nextDue.toISOString();
          this.logger.info(`Rescheduled recurring reminder "${reminder.title}" to ${reminder.dueAt}`);
        } else {
          reminder.completed = true;
          reminder.completedAt = nowIso;
        }

        this.saveToDisk();
      }
    }
  }

  private async evaluateWatchers(): Promise<void> {
    const now = Date.now();

    for (const watcher of this.watchers.values()) {
      if (!watcher.enabled) continue;

      // Check cooldown
      if (watcher.lastTriggeredAt) {
        const lastTime = new Date(watcher.lastTriggeredAt).getTime();
        const cooldownMs = watcher.alertCooldownMinutes * 60 * 1000;
        if (now - lastTime < cooldownMs) {
          continue;
        }
      }

      let triggered = false;
      let currentVal = 0;

      if (watcher.target === 'ram') {
        const total = os.totalmem();
        const free = os.freemem();
        const usedPercent = Math.round(((total - free) / total) * 100);
        currentVal = usedPercent;
        if (watcher.condition === 'above' && usedPercent >= watcher.threshold) {
          triggered = true;
        }
      }

      if (triggered) {
        watcher.lastTriggeredAt = new Date().toISOString();
        this.logger.warn(`Watcher triggered: [${watcher.name}] (Current: ${currentVal}, Threshold: ${watcher.threshold})`);

        await this.channelRegistry.dispatch({
          id: `watcher_${watcher.id}`,
          title: `⚠️ Alerta: ${watcher.name}`,
          message: `${watcher.messageTemplate} (Valor actual: ${currentVal}%)`,
          priority: 'high',
          timestamp: new Date().toISOString(),
          channels: ['windows_toast', 'hud_websocket', 'voice_tts'],
        });

        this.saveToDisk();
      }
    }
  }

  /**
   * Helper to parse natural or relative time to an ISO Date string.
   */
  public calculateDueTime(delayMinutes?: number, timeStr?: string): Date {
    const now = new Date();

    if (delayMinutes !== undefined && delayMinutes > 0) {
      return new Date(now.getTime() + delayMinutes * 60 * 1000);
    }

    if (timeStr) {
      const cleanTime = timeStr.trim().toLowerCase();

      // Check format "HH:mm" (e.g. "18:30" or "8:00")
      const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch) {
        const targetHours = parseInt(timeMatch[1], 10);
        const targetMinutes = parseInt(timeMatch[2], 10);
        const targetDate = new Date(now);
        targetDate.setHours(targetHours, targetMinutes, 0, 0);

        // If target time today has already passed, schedule for tomorrow
        if (targetDate.getTime() <= now.getTime()) {
          targetDate.setDate(targetDate.getDate() + 1);
        }
        return targetDate;
      }

      // Check ISO string
      const parsedIso = new Date(timeStr);
      if (!isNaN(parsedIso.getTime()) && parsedIso.getTime() > now.getTime()) {
        return parsedIso;
      }
    }

    // Default fallback: 10 minutes from now
    return new Date(now.getTime() + 10 * 60 * 1000);
  }

  // ─── CRUD REMINDERS ──────────────────────────────────────────────────────────

  public createReminder(input: CreateReminderInput): Reminder {
    const id = `rem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const dueTime = this.calculateDueTime(input.delayMinutes, input.time);

    const channels = Array.isArray(input.channels) && input.channels.length > 0
      ? input.channels
      : ['windows_toast', 'voice_tts', 'hud_websocket'];

    const reminder: Reminder = {
      id,
      title: input.title.trim(),
      message: input.message ? input.message.trim() : undefined,
      type: input.actionCommand ? 'deferred_action' : 'reminder',
      dueAt: dueTime.toISOString(),
      createdAt: new Date().toISOString(),
      completed: false,
      priority: input.priority || 'normal',
      recurring: input.recurring || null,
      channels,
      actionCommand: input.actionCommand,
      metadata: input.metadata,
    };

    this.reminders.set(id, reminder);
    this.saveToDisk();
    this.logger.info(`Reminder created: "${reminder.title}" for ${reminder.dueAt}`);
    return reminder;
  }

  public listReminders(filter?: { completed?: boolean; limit?: number }): Reminder[] {
    let list = Array.from(this.reminders.values());

    if (filter?.completed !== undefined) {
      list = list.filter((r) => r.completed === filter.completed);
    }

    // Sort ascending by due date
    list.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    if (filter?.limit && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return list;
  }

  public getReminder(id: string): Reminder | undefined {
    return this.reminders.get(id);
  }

  public completeReminder(id: string): boolean {
    const rem = this.reminders.get(id);
    if (rem) {
      rem.completed = true;
      rem.completedAt = new Date().toISOString();
      this.saveToDisk();
      this.logger.info(`Reminder marked complete: [${id}] "${rem.title}"`);
      return true;
    }
    return false;
  }

  public snoozeReminder(id: string, minutes: number = 5): Reminder | null {
    const rem = this.reminders.get(id);
    if (!rem) return null;

    const newDue = new Date(Date.now() + Math.max(minutes, 1) * 60 * 1000);
    rem.dueAt = newDue.toISOString();
    rem.completed = false;
    rem.completedAt = undefined;
    this.saveToDisk();
    this.logger.info(`Reminder snoozed: [${id}] by ${minutes}m to ${rem.dueAt}`);
    return rem;
  }

  public deleteReminder(id: string): boolean {
    const deleted = this.reminders.delete(id);
    if (deleted) {
      this.saveToDisk();
      this.logger.info(`Reminder deleted: [${id}]`);
    }
    return deleted;
  }

  // ─── CRUD STICKY NOTES ───────────────────────────────────────────────────────

  public addNote(title: string, content: string, tags?: string[], pinned: boolean = false): StickyNote {
    const id = `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();

    const note: StickyNote = {
      id,
      title: title.trim(),
      content: content.trim(),
      pinned,
      tags: tags || [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.notes.set(id, note);
    this.saveToDisk();
    this.logger.info(`Sticky note created: "${note.title}"`);
    return note;
  }

  public listNotes(): StickyNote[] {
    const list = Array.from(this.notes.values());
    // Pinned notes first, then latest updated
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }

  public deleteNote(id: string): boolean {
    const deleted = this.notes.delete(id);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  // ─── WATCHERS ────────────────────────────────────────────────────────────────

  public registerWatcher(configData: WatcherConfig): void {
    this.watchers.set(configData.id, configData);
    this.saveToDisk();
  }

  public listWatchers(): WatcherConfig[] {
    return Array.from(this.watchers.values());
  }

  public destroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.watcherTimer) clearInterval(this.watcherTimer);
  }
}

// Global shared scheduler instance
let sharedScheduler: TaskScheduler | null = null;

export function getSharedScheduler(): TaskScheduler {
  if (!sharedScheduler) {
    sharedScheduler = new TaskScheduler();
  }
  return sharedScheduler;
}
