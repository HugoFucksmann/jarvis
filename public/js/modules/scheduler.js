/**
 * scheduler.js — Frontend module for JARVIS Tasks, Reminders & Sticky Notes.
 * Coordinates real-time alerts, countdowns, and multi-channel notification state.
 */

import { state, API_BASE } from './state.js';
import { setMode } from './ui.js';

let countdownInterval = null;

function formatCountdown(dueAt) {
  const diffMs = new Date(dueAt).getTime() - Date.now();
  if (diffMs <= 0) return '<span style="color:var(--color-red);font-weight:700;">¡VENCIDO!</span>';

  const totalSecs = Math.floor(diffMs / 1000);
  const hours   = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;

  if (hours > 0)   return `en ${hours}h ${minutes}m`;
  if (minutes > 0) return `en ${minutes}m ${seconds}s`;
  return `en ${seconds}s`;
}

export async function loadReminders() {
  const listEl     = document.getElementById('reminders-list');
  const countBadge = document.getElementById('reminders-count');
  if (!listEl) return;

  try {
    const res  = await fetch(`${API_BASE}/api/scheduler/reminders`);
    const data = await res.json();
    const reminders = data.reminders || [];

    if (countBadge) countBadge.textContent = String(reminders.length);

    if (reminders.length === 0) {
      listEl.innerHTML = '<div class="history-empty">No hay recordatorios pendientes en la agenda.</div>';
      return;
    }

    listEl.innerHTML = reminders
      .map((r) => {
        const priorityColor =
          r.priority === 'critical' ? 'var(--color-red)' :
          r.priority === 'high'     ? '#f59e0b'           :
                                      'var(--color-cyan)';

        return `
        <div class="history-card" data-reminder-id="${r.id}" style="border-left: 3px solid ${priorityColor};">
          <div class="history-card-header">
            <span style="font-weight:600;color:var(--text-main);">${escapeHtml(r.title)}</span>
            <span class="history-card-time countdown-badge" data-due="${r.dueAt}">${formatCountdown(r.dueAt)}</span>
          </div>
          ${r.message ? `<div class="history-card-summary" style="margin-top:4px;">${escapeHtml(r.message)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:10.5px;color:var(--text-muted);">
            <span>⏰ ${new Date(r.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <div style="display:flex;gap:6px;">
              <button class="drawer-action-btn btn-complete-rem" data-id="${r.id}" title="Marcar como hecho">✓ Listo</button>
              <button class="drawer-action-btn btn-snooze-rem"   data-id="${r.id}" title="Posponer 5 minutos">+5m</button>
              <button class="drawer-action-btn btn-delete-rem"   data-id="${r.id}" title="Eliminar" style="color:var(--color-red);">✕</button>
            </div>
          </div>
        </div>`;
      })
      .join('');

    bindReminderCardActions();
    startCountdownLoop();
  } catch (err) {
    console.error('Error loading reminders:', err);
    if (listEl) listEl.innerHTML = '<div class="history-empty">Error al conectar con el servicio de agenda.</div>';
  }
}

function startCountdownLoop() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const badges = document.querySelectorAll('.countdown-badge');
    if (badges.length === 0) { clearInterval(countdownInterval); return; }
    badges.forEach((b) => {
      const due = b.getAttribute('data-due');
      if (due) b.innerHTML = formatCountdown(due);
    });
  }, 1000);
}

function bindReminderCardActions() {
  document.querySelectorAll('.btn-complete-rem').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      await fetch(`${API_BASE}/api/scheduler/reminders/${id}/complete`, { method: 'POST' });
      await loadReminders();
    });
  });

  document.querySelectorAll('.btn-snooze-rem').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      await fetch(`${API_BASE}/api/scheduler/reminders/${id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: 5 }),
      });
      await loadReminders();
    });
  });

  document.querySelectorAll('.btn-delete-rem').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      await fetch(`${API_BASE}/api/scheduler/reminders/${id}`, { method: 'DELETE' });
      await loadReminders();
    });
  });
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = String(text);
  return d.innerHTML;
}

export function bindSchedulerEvents() {
  const btnToggle  = document.getElementById('btn-toggle-scheduler');
  const btnClose   = document.getElementById('btn-close-scheduler');
  const btnRefresh = document.getElementById('btn-refresh-scheduler');

  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      const isOpen = document.getElementById('jarvis-container')?.dataset?.mode === 'scheduler';
      if (isOpen) {
        setMode(state.rawResponse ? 'responding' : 'idle');
      } else {
        setMode('scheduler');
        loadReminders();
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      setMode(state.rawResponse ? 'responding' : 'idle');
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', loadReminders);
  }
}
