import { Router } from 'express';
import { getSharedScheduler } from '../../scheduler/TaskScheduler.js';
import { CreateReminderInput, PriorityLevel, RecurrenceType } from '../../scheduler/types.js';

export function createSchedulerRoutes(): Router {
  const router = Router();
  const scheduler = getSharedScheduler();

  // ─── REMINDERS ───────────────────────────────────────────────────────────────

  router.get('/reminders', (req, res) => {
    const completed = req.query.completed !== undefined ? req.query.completed === 'true' : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const reminders = scheduler.listReminders({ completed, limit });
    res.json({ success: true, count: reminders.length, reminders });
  });

  router.post('/reminders', (req, res) => {
    const { title, message, delayMinutes, time, priority, recurring, actionCommand } = req.body as {
      title?: string;
      message?: string;
      delayMinutes?: number;
      time?: string;
      priority?: PriorityLevel;
      recurring?: RecurrenceType;
      actionCommand?: string;
    };

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ success: false, error: 'Missing required field: "title"' });
      return;
    }

    try {
      const input: CreateReminderInput = {
        title: title.trim(),
        message: message ? message.trim() : undefined,
        delayMinutes: delayMinutes !== undefined ? Number(delayMinutes) : undefined,
        time,
        priority: priority || 'normal',
        recurring: recurring || null,
        actionCommand: actionCommand || undefined,
      };

      const reminder = scheduler.createReminder(input);
      res.json({ success: true, reminder });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/reminders/:id/complete', (req, res) => {
    const { id } = req.params;
    const ok = scheduler.completeReminder(id);
    if (!ok) {
      res.status(404).json({ success: false, error: `Reminder [${id}] not found.` });
      return;
    }
    res.json({ success: true, message: `Reminder [${id}] marked as completed.` });
  });

  router.post('/reminders/:id/snooze', (req, res) => {
    const { id } = req.params;
    const { minutes } = req.body as { minutes?: number };
    const snoozeMin = minutes ? Math.max(Number(minutes), 1) : 5;

    const updated = scheduler.snoozeReminder(id, snoozeMin);
    if (!updated) {
      res.status(404).json({ success: false, error: `Reminder [${id}] not found.` });
      return;
    }
    res.json({ success: true, reminder: updated });
  });

  router.delete('/reminders/:id', (req, res) => {
    const { id } = req.params;
    const ok = scheduler.deleteReminder(id);
    res.json({ success: ok, message: ok ? `Reminder [${id}] deleted.` : `Reminder [${id}] not found.` });
  });

  // ─── STICKY NOTES ────────────────────────────────────────────────────────────

  router.get('/notes', (_req, res) => {
    const notes = scheduler.listNotes();
    res.json({ success: true, count: notes.length, notes });
  });

  router.post('/notes', (req, res) => {
    const { title, content, tags, pinned } = req.body as {
      title?: string;
      content?: string;
      tags?: string[];
      pinned?: boolean;
    };

    if (!content || typeof content !== 'string') {
      res.status(400).json({ success: false, error: 'Missing required field: "content"' });
      return;
    }

    const note = scheduler.addNote(title || 'Nota', content, tags, !!pinned);
    res.json({ success: true, note });
  });

  router.delete('/notes/:id', (req, res) => {
    const { id } = req.params;
    const ok = scheduler.deleteNote(id);
    res.json({ success: ok, message: ok ? `Note [${id}] deleted.` : `Note [${id}] not found.` });
  });

  // ─── WATCHERS ────────────────────────────────────────────────────────────────

  router.get('/watchers', (_req, res) => {
    const watchers = scheduler.listWatchers();
    res.json({ success: true, count: watchers.length, watchers });
  });

  return router;
}
