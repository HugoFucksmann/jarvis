/**
 * app.js — J.A.R.V.I.S. Dashboard Main Orchestrator
 *
 * Coordinates:
 *  - WebSocket connection with auto-reconnect
 *  - PanelManager state & dynamic Dashboard Grid rendering
 *  - ResizeDragManager for mouse drag-to-resize and drag-and-drop reordering
 *  - Sidebar multi-panel independent toggles (opening one never closes others)
 *  - Layout presets (Focus, Dual, 2x2 Grid, All)
 *  - Hardware & Ollama model telemetry
 *  - Security approval modal
 */

import { PanelManager } from './panels/PanelManager.js';
import { ResizeDragManager } from './panels/ResizeDragManager.js';
import { createChatPanel } from './panels/ChatPanel.js';
import { createSystemPanel } from './panels/SystemPanel.js';
import { createMemoryPanel } from './panels/MemoryPanel.js';
import { createSecurityPanel } from './panels/SecurityPanel.js';
import { createDevicePanel } from './panels/DevicePanel.js';

// ── Session ID ─────────────────────────────────────────────────────────────
const sessionId = 'session_' + Math.random().toString(36).substring(2, 9);

// ── WebSocket Connection ───────────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;

  setSystemStatus('busy');

  ws = new WebSocket(url);

  ws.onopen = () => {
    setSystemStatus('online');
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
    // Initialize session
    ws.send(JSON.stringify({ type: 'init_session', payload: { sessionId } }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onerror = () => {
    setSystemStatus('offline');
  };

  ws.onclose = () => {
    setSystemStatus('offline');
    if (!reconnectTimer) {
      reconnectTimer = setInterval(connectWebSocket, 3000);
    }
  };
}

function getWs() {
  return ws;
}

// ── Instantiate Panel Modules ──────────────────────────────────────────────
const chatPanel     = createChatPanel({ getWs, sessionId });
const systemPanel   = createSystemPanel();
const memoryPanel   = createMemoryPanel();
const securityPanel = createSecurityPanel();
const devicePanel   = createDevicePanel();

// ── Server Message Router ──────────────────────────────────────────────────
function handleServerMessage(msg) {
  const { type, payload } = msg;
  switch (type) {
    case 'agent_event':
      chatPanel.handleAgentEvent(payload);
      devicePanel.handleAgentEvent(payload);
      break;
    case 'approval_required':
      showApprovalModal(payload);
      break;
    case 'subagent_event':
      // Subagent status updates — show as a chat notification
      if (payload?.status === 'completed' || payload?.status === 'failed') {
        chatPanel.onSubagentFinished?.(payload);
      }
      break;
    case 'task_finished':
      chatPanel.onTaskFinished(payload);
      securityPanel.refresh();
      systemPanel.refresh();
      break;
    case 'task_cancelled':
      chatPanel.onTaskCancelled();
      break;
    case 'error':
      chatPanel.onError(payload.message || 'Error desconocido.');
      break;
  }
}

// ── Top Status Indicator ───────────────────────────────────────────────────
const statusDot   = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

function setSystemStatus(state) {
  if (statusDot) {
    statusDot.className = `status-dot ${state}`;
  }
  if (statusLabel) {
    statusLabel.textContent = state === 'online' ? 'Online' : state === 'busy' ? 'Conectando...' : 'Sin conexión';
  }
}

// ── Model Selector ─────────────────────────────────────────────────────────
const modelSelector = document.getElementById('model-selector');

async function fetchModels() {
  try {
    const res  = await fetch('/api/models');
    const data = await res.json();
    if (!modelSelector) return;
    modelSelector.innerHTML = '';
    data.models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = `${m.name} (${(m.size / 1e9).toFixed(1)} GB)`;
      if (m.name === data.current) opt.selected = true;
      modelSelector.appendChild(opt);
    });
    if (!data.models.length) {
      const opt = document.createElement('option');
      opt.textContent = 'Sin modelos instalados';
      modelSelector.appendChild(opt);
    }
  } catch {
    if (modelSelector) modelSelector.innerHTML = '<option>Ollama desconectado</option>';
  }
}

modelSelector?.addEventListener('change', async () => {
  const model = modelSelector.value;
  try {
    await fetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    systemPanel.refresh();
  } catch { /* ignore */ }
});

// ── Authorization Modal ────────────────────────────────────────────────────
const approvalModal   = document.getElementById('approval-modal');
const modalToolName   = document.getElementById('modal-tool-name');
const modalRiskBadge  = document.getElementById('modal-risk-badge');
const modalReason     = document.getElementById('modal-reason');
const modalArgs       = document.getElementById('modal-args');
const btnApprove      = document.getElementById('btn-approve');
const btnDeny         = document.getElementById('btn-deny');

let pendingApprovalId = null;

function showApprovalModal(data) {
  pendingApprovalId = data.approvalId;
  if (modalToolName)  modalToolName.textContent = data.toolName;
  if (modalRiskBadge) {
    modalRiskBadge.textContent = data.riskLevel;
    modalRiskBadge.className = `risk-badge ${data.riskLevel}`;
  }
  if (modalReason)    modalReason.textContent = data.reason || 'Acción potencialmente riesgosa.';
  if (modalArgs)      modalArgs.textContent   = JSON.stringify(data.args, null, 2);
  approvalModal?.classList.remove('hidden');
}

function hideApprovalModal() {
  approvalModal?.classList.add('hidden');
  pendingApprovalId = null;
}

function sendApprovalResponse(approved) {
  if (!pendingApprovalId || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'approval_response', payload: { approvalId: pendingApprovalId, approved } }));
  hideApprovalModal();
}

btnApprove?.addEventListener('click', () => sendApprovalResponse(true));
btnDeny?.addEventListener('click',    () => sendApprovalResponse(false));

// ── Dashboard Grid & Panel Rendering ───────────────────────────────────────
const panelManager = new PanelManager();
const dashboardGrid = document.getElementById('dashboard-grid');
const panelStorage  = document.getElementById('panel-storage');
const resizeDragManager = new ResizeDragManager(panelManager, dashboardGrid);

const panelElements = {
  chat:     document.getElementById('panel-chat'),
  system:   document.getElementById('panel-system'),
  device:   document.getElementById('panel-device'),
  memory:   document.getElementById('panel-memory'),
  security: document.getElementById('panel-security'),
};

const sidebarBtns = {
  chat:     document.getElementById('sidebar-btn-chat'),
  system:   document.getElementById('sidebar-btn-system'),
  device:   document.getElementById('sidebar-btn-device'),
  memory:   document.getElementById('sidebar-btn-memory'),
  security: document.getElementById('sidebar-btn-security'),
};

/**
 * Re-render the active cards inside the Dashboard Grid.
 * Preserves DOM nodes so messages, audio streams, and forms are never reset.
 */
function renderWorkspace() {
  if (!dashboardGrid || !panelStorage) return;

  const activeCards = panelManager.getActiveCards();

  // 1. Move all panel cards to storage first
  Object.values(panelElements).forEach(el => {
    if (el && el.parentElement !== panelStorage) {
      panelStorage.appendChild(el);
    }
  });

  // Empty existing grid content
  dashboardGrid.innerHTML = '';

  // 2. Check empty state
  if (activeCards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'workspace-empty';
    empty.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      <div class="workspace-empty-title">Dashboard Vacío</div>
      <div class="workspace-empty-desc">
        Activá uno o más paneles desde la barra lateral o seleccioná un preset arriba (⚡ Chat Focus, 🖥️ Dual, 📊 Grid 2x2).
      </div>
    `;
    dashboardGrid.appendChild(empty);
  } else {
    // Calculate total span to set single-row or multi-row full-height layout
    let totalSpan = 0;
    activeCards.forEach(c => { totalSpan += (c.span || 6); });
    dashboardGrid.classList.remove('rows-1', 'rows-2');
    if (totalSpan <= 12) {
      dashboardGrid.classList.add('rows-1');
    } else {
      dashboardGrid.classList.add('rows-2');
    }

    // 3. Append active cards in order with proper span and custom height
    activeCards.forEach(cardState => {
      const cardEl = panelElements[cardState.id];
      if (!cardEl) return;

      // Reset span classes and apply saved span
      cardEl.classList.remove('span-4', 'span-6', 'span-8', 'span-12');
      cardEl.classList.add(`span-${cardState.span || 6}`);

      // Apply custom height only if user manually resized, otherwise let grid fill 100%
      if (cardState.height) {
        cardEl.style.height = `${cardState.height}px`;
      } else {
        cardEl.style.height = '';
      }

      // Highlight active span button inside card header
      cardEl.querySelectorAll('.card-btn[data-span]').forEach(btn => {
        const spanVal = parseInt(btn.dataset.span, 10);
        btn.classList.toggle('active', spanVal === cardState.span);
      });

      dashboardGrid.appendChild(cardEl);
    });

    // 4. Attach resize & drag handlers to cards in DOM
    resizeDragManager.attachHandlers();
  }

  // 5. Update Sidebar button active states
  Object.keys(sidebarBtns).forEach(id => {
    const btn = sidebarBtns[id];
    if (btn) {
      btn.classList.toggle('is-active', panelManager.isOpen(id));
    }
  });
}

// ── Bind Sidebar Independent Toggles ───────────────────────────────────────
Object.keys(sidebarBtns).forEach(id => {
  const btn = sidebarBtns[id];
  btn?.addEventListener('click', () => {
    // Multi-panel: Toggling this panel NEVER closes any other panels!
    panelManager.toggle(id);
  });
});

// ── Bind Layout Presets Buttons ────────────────────────────────────────────
document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    panelManager.applyPreset(preset);

    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Reset grid layout
document.getElementById('btn-reset-layout')?.addEventListener('click', () => {
  panelManager.reset();
});

// Listen to panel manager changes
panelManager.addEventListener('change', renderWorkspace);
panelManager.addEventListener('reorder', renderWorkspace);
panelManager.addEventListener('preset', renderWorkspace);
panelManager.addEventListener('reset', renderWorkspace);

// ── Bootstrapping ──────────────────────────────────────────────────────────
async function initApp() {
  chatPanel.init();
  systemPanel.init();
  memoryPanel.init();
  securityPanel.init();
  devicePanel.init();

  renderWorkspace();

  connectWebSocket();
  await fetchModels();
}

window.addEventListener('DOMContentLoaded', initApp);
