/**
 * history.js — Task history drawer: loads past tasks, duration, tool usage,
 *              and allows clicking to re-run prompt.
 */
import { state, dom, API_BASE } from './state.js';
import { setMode } from './ui.js';
import { escapeHtml } from './markdown.js';

export async function loadTaskHistory(onSelectPrompt) {
  if (!dom.historyList) return;
  try {
    const res = await fetch(`${API_BASE}/api/tasks?limit=40`);
    const data = await res.json();
    const tasks = data.tasks || [];

    if (dom.historyCount) {
      dom.historyCount.textContent = `${tasks.length} tareas`;
    }

    if (tasks.length === 0) {
      dom.historyList.innerHTML = '<div class="drawer-empty">No hay tareas registradas aún.</div>';
      return;
    }

    dom.historyList.innerHTML = tasks
      .map((t) => {
        const time = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dur = t.durationMs > 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`;
        const tools = (t.toolsUsed || []).map((tl) => `<span class="task-tool-tag">${escapeHtml(tl)}</span>`).join(' ');
        const statusClass = t.success ? 'ok' : 'fail';
        const statusText = t.success ? 'Completada' : 'Fallo';

        return `
          <div class="task-item" data-prompt="${escapeHtml(t.prompt)}">
            <div class="task-item-top">
              <span class="task-item-prompt" title="${escapeHtml(t.prompt)}">${escapeHtml(t.prompt)}</span>
              <span class="task-item-time">${time}</span>
            </div>
            <div class="task-item-meta">
              <span class="task-status-tag ${statusClass}">${statusText}</span>
              <span>⏱️ ${dur}</span>
              ${tools}
            </div>
          </div>
        `;
      })
      .join('');

    dom.historyList.querySelectorAll('.task-item').forEach((item) => {
      item.addEventListener('click', () => {
        const prompt = item.getAttribute('data-prompt');
        if (prompt && onSelectPrompt) {
          onSelectPrompt(prompt);
        }
      });
    });
  } catch (err) {
    console.error('Error cargando historial:', err);
    if (dom.historyList) {
      dom.historyList.innerHTML = '<div class="drawer-empty">Error al cargar historial.</div>';
    }
  }
}

export function bindHistoryEvents(onSelectPrompt) {
  if (dom.btnToggleHistory) {
    dom.btnToggleHistory.addEventListener('click', () => {
      if (dom.container.dataset.mode === 'history') {
        setMode(state.rawResponse ? 'responding' : 'idle');
      } else {
        setMode('history');
        loadTaskHistory(onSelectPrompt);
      }
    });
  }

  if (dom.btnCloseHistory) {
    dom.btnCloseHistory.addEventListener('click', () => {
      setMode(state.rawResponse ? 'responding' : 'idle');
    });
  }
}
