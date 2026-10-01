/**
 * types.ts — Scheduler & Reminder data structures, multi-channel notification contracts.
 * Designed for seamless extensibility with external channels (Telegram, WhatsApp, Webhooks).
 */

export type ReminderType = 'reminder' | 'note' | 'deferred_action' | 'watcher';
export type RecurrenceType = 'hourly' | 'daily' | 'weekly' | null;
export type PriorityLevel = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  priority: PriorityLevel;
  timestamp: string;
  channels: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Universal interface for notification delivery.
 * Extensible for Telegram, WhatsApp, Discord, Webhooks without modifying the core scheduler.
 */
export interface INotificationChannel {
  readonly name: string;
  send(payload: NotificationPayload): Promise<boolean>;
  isEnabled(): boolean;
}

export interface Reminder {
  id: string;
  title: string;
  message?: string;
  type: ReminderType;
  dueAt: string;          // ISO string
  createdAt: string;      // ISO string
  completed: boolean;
  completedAt?: string;
  priority: PriorityLevel;
  recurring?: RecurrenceType;
  intervalMinutes?: number;
  channels: string[];     // e.g. ['windows_toast', 'voice_tts', 'hud_websocket', 'telegram']
  actionCommand?: string; // Optional agent command to execute upon expiry
  metadata?: Record<string, unknown>;
}

export interface StickyNote {
  id: string;
  title: string;
  content: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  tags?: string[];
}

export interface WatcherConfig {
  id: string;
  name: string;
  target: 'cpu' | 'ram' | 'disk' | 'process';
  threshold: number;      // e.g. 90% for CPU, 10 GB for disk
  condition: 'above' | 'below';
  intervalSeconds: number;
  enabled: boolean;
  alertCooldownMinutes: number;
  lastTriggeredAt?: string;
  messageTemplate: string;
}

export interface CreateReminderInput {
  title: string;
  message?: string;
  delayMinutes?: number;
  time?: string;          // HH:mm or full ISO string
  priority?: PriorityLevel;
  recurring?: RecurrenceType;
  channels?: string[];
  actionCommand?: string;
  metadata?: Record<string, unknown>;
}
