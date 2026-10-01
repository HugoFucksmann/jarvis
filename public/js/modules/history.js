/**
 * history.js — Task history drawer: loads past tasks, duration, tool usage,
 *              and allows clicking to re-run prompt.
 */
import { dom, API_BASE } from './state.js';
import { setMode } from './ui.js';
import { escapeHtml } from './markdown.js';

const FETCH_TIMEOUT_MS = 8000;

let requestId = 0;
let currentTasks = [];
let selectHandler = null;

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function setCount(n) {
  if (dom.historyCount) dom.historyCount.textContent = n === 1 ? '1 tarea' : `${n} tareas`;
}

function renderMessage(html) {
  if (dom.historyList) dom.historyList.innerHTML = html;
}

function renderTasks(tasks) {
  if (tasks.length === 0) {
    renderMessage('<div class="flat-empty">No hay tareas registradas aún.</div>');
    return;
  }

  renderMessage(
    tasks
      .map((t, i) => {
        const tools = (t.toolsUsed || [])
          .map((tl) => `<span class="task-tool-tag">${escapeHtml(tl)}</span>`)
          .join('');
        const statusClass = t.success ? 'ok' : 'fail';
        const statusText = t.success ? 'Completada' : 'Falló';
        const prompt = escapeHtml(t.prompt || '');

        return `
          <button type="button" class="task-item" data-index="${i}" title="Reutilizar esta directiva">
            <span class="task-item-top">
              <span class="task-item-prompt">${prompt}</span>
              <span class="task-item-time">${escapeHtml(formatTime(t.timestamp))}</span>
            </span>
            <span class="task-item-meta">
              <span class="task-status-tag ${statusClass}">${statusText}</span>
              <span title="Duración">${escapeHtml(formatDuration(t.durationMs))}</span>
              ${tools}
            </span>
          </button>
        `;
      })
      .join('')
  );
}

export async function loadTaskHistory(onSelectPrompt) {
  if (!dom.historyList) return;
  if (onSelectPrompt) selectHandler = onSelectPrompt;

  const id = ++requestId; // descarta respuestas obsoletas si se reabre rápido
  renderMessage('<div class="flat-empty">Cargando historial…</div>');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/api/tasks?limit=40`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (id !== requestId) return;

    currentTasks = Array.isArray(data.tasks) ? data.tasks : [];
    setCount(currentTasks.length);
    renderTasks(currentTasks);
  } catch (err) {
    if (id !== requestId) return;
    console.error('Error cargando historial:', err);
    currentTasks = [];
    renderMessage(
      '<div class="flat-empty">No se pudo cargar el historial.' +
      '<br><button type="button" class="flat-btn" data-action="retry">Reintentar</button></div>'
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function bindHistoryEvents(onSelectPrompt) {
  selectHandler = onSelectPrompt || null;

  // Delegación única: sirve para cualquier re-render de la lista
  if (dom.historyList) {
    dom.historyList.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="retry"]')) {
        loadTaskHistory();
        return;
      }
      const item = e.target.closest('.task-item');
      if (!item) return;
      const task = currentTasks[Number(item.dataset.index)];
      if (task?.prompt && selectHandler) selectHandler(task.prompt);
    });
  }

  if (dom.btnToggleHistory) {
    dom.btnToggleHistory.addEventListener('click', () => {
      if (dom.container.dataset.mode === 'history') {
        setMode('tools');
      } else {
        setMode('history');
        loadTaskHistory();
      }
    });
  }

  // La ✕ la intercepta native.js (siempre vuelve al menú de módulos);
  // este handler solo actúa si se usara el módulo de forma aislada.
  if (dom.btnCloseHistory) {
    dom.btnCloseHistory.addEventListener('click', () => setMode('tools'));
  }
}