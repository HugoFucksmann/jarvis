/**
 * subagents.js — Frontend module for JARVIS Background Subagents & Asynchronous Workers.
 * Displays real-time task status, progress indicators, cancel controls, and log viewer.
 */

import { state, API_BASE } from './state.js';
import { setMode } from './ui.js';

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

export async function loadSubagents() {
  const listEl      = document.getElementById('subagents-list');
  const countBadge  = document.getElementById('subagents-count');
  const headerBadge = document.getElementById('subagents-count-badge');
  if (!listEl) return;

  try {
    const res  = await fetch(`${API_BASE}/api/subagents`);
    const json = await res.json();
    const subagents = json.data?.subagents || [];

    const running = subagents.filter((s) => s.status === 'running' || s.status === 'queued');

    if (countBadge)  countBadge.textContent = String(subagents.length);
    if (headerBadge) {
      if (running.length > 0) {
        headerBadge.style.display = 'inline-block';
        headerBadge.textContent   = String(running.length);
        headerBadge.title         = `${running.length} subagente(s) en ejecución`;
      } else {
        headerBadge.style.display = 'none';
      }
    }

    if (subagents.length === 0) {
      listEl.innerHTML = '<div class="history-empty">No hay subagentes activos ni recientes.</div>';
      return;
    }

    listEl.innerHTML = subagents
      .map((s) => {
        const isRunning   = s.status === 'running';
        const isQueued    = s.status === 'queued';
        const isFailed    = s.status === 'failed';
        const isCompleted = s.status === 'completed';

        const statusColor =
          isRunning   ? 'var(--color-cyan)' :
          isQueued    ? '#f59e0b'            :
          isCompleted ? '#10b981'            :
                        'var(--color-red)';

        const statusLabel =
          isRunning   ? '⚡ EN EJECUCIÓN' :
          isQueued    ? '⏳ EN COLA'      :
          isCompleted ? '✓ COMPLETADO'    :
          isFailed    ? '✕ FALLIDO'       :
                        'CANCELADO';

        const runtime = isRunning
          ? formatDuration(Date.now() - s.startTime)
          : formatDuration(s.durationMs);

        const logsSnippet = s.logs?.length > 0
          ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);background:rgba(0,0,0,0.3);padding:4px 6px;border-radius:4px;margin-top:5px;max-height:48px;overflow:hidden;">
               ${escapeHtml(s.logs.slice(-2).join('\n'))}
             </div>`
          : '';

        const resultSnippet = s.result
          ? `<div style="font-size:11px;color:var(--text-main);margin-top:4px;font-style:italic;">
               "${escapeHtml(s.result.length > 120 ? s.result.slice(0, 117) + '...' : s.result)}"
             </div>`
          : '';

        const cancelBtn = (isRunning || isQueued)
          ? `<div style="display:flex;justify-content:flex-end;margin-top:8px;">
               <button class="drawer-action-btn btn-cancel-subagent" data-id="${s.id}" style="color:var(--color-red);border-color:rgba(239,68,68,0.3);">
                 ✕ Cancelar Tarea
               </button>
             </div>`
          : '';

        return `
        <div class="history-card" data-subagent-id="${s.id}" style="border-left: 3px solid ${statusColor};">
          <div class="history-card-header">
            <span style="font-weight:600;color:var(--text-main);">${escapeHtml(s.title)}</span>
            <span style="font-size:10px;font-weight:700;color:${statusColor};letter-spacing:0.5px;">${statusLabel}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
            Tipo: <strong style="color:var(--text-main);">${s.type === 'shell_worker' ? 'Terminal Shell' : 'Cognitivo LLM'}</strong>
            • Tiempo: ${runtime}
          </div>
          ${resultSnippet}
          ${logsSnippet}
          ${cancelBtn}
        </div>`;
      })
      .join('');

    // Wire cancel buttons
    listEl.querySelectorAll('.btn-cancel-subagent').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) {
          btn.textContent = 'Cancelando...';
          btn.disabled = true;
          await cancelSubagent(id);
        }
      });
    });
  } catch (err) {
    console.error('Error loading subagents:', err);
    listEl.innerHTML = '<div class="history-empty">Error al sincronizar subagentes.</div>';
  }
}

export async function cancelSubagent(id) {
  try {
    const res = await fetch(`${API_BASE}/api/subagents/${id}/cancel`, { method: 'POST' });
    if (res.ok) await loadSubagents();
  } catch (err) {
    console.error(`Failed to cancel subagent ${id}:`, err);
  }
}

/** Called by ws.js when a subagent_event arrives via WebSocket. */
export function handleSubagentWsEvent(_payload) {
  // Refresh both the badge and the list regardless of drawer state
  loadSubagents();
}

export function initSubagentsDrawer() {
  const btnToggle  = document.getElementById('btn-toggle-subagents');
  const btnClose   = document.getElementById('btn-close-subagents');
  const btnRefresh = document.getElementById('btn-refresh-subagents');

  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      const isOpen = document.getElementById('jarvis-container')?.dataset?.mode === 'subagents';
      if (isOpen) {
        setMode(state.rawResponse ? 'responding' : 'idle');
      } else {
        setMode('subagents');
        loadSubagents();
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      setMode(state.rawResponse ? 'responding' : 'idle');
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', loadSubagents);
  }

  // Initial badge load (without opening the drawer)
  loadSubagents();
}
