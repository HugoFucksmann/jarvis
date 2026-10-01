/**
 * ui.js — UI state machine: modes, activity strip, reactor, hints, external links.
 */
import { state, dom } from './state.js';

const HINTS = {
  idle:       '<span><kbd>Enter</kbd> enviar</span><span><kbd>Ctrl+M</kbd> voz</span><span><kbd>Alt+Espacio</kbd> invocar</span>',
  working:    '<span><kbd>Esc</kbd> detener</span><span>Procesando directiva...</span>',
  responding: '<span><kbd>Esc</kbd> limpiar</span><span><kbd>Ctrl+Shift+C</kbd> copiar</span><span><kbd>Alt+Espacio</kbd> ocultar</span>',
  history:    '<span><kbd>Esc</kbd> cerrar historial</span><span>Clic en tarea para reutilizar</span>',
  memory:     '<span><kbd>Esc</kbd> cerrar memoria</span><span>Edición directa de .jarvis/MEMORY.md</span>',
  security:   '<span><kbd>Esc</kbd> cerrar seguridad</span><span>Configuración de comandos y permisos</span>',
  scheduler:  '<span><kbd>Esc</kbd> cerrar agenda</span><span>Recordatorios y tareas programadas</span>',
  subagents:  '<span><kbd>Esc</kbd> cerrar subagentes</span><span>Tareas en segundo plano activas</span>',
  approval:   '<span><kbd>Ctrl+Enter</kbd> autorizar</span><span><kbd>Esc</kbd> denegar</span>',
};

const DRAWER_MODES = ['history', 'memory', 'security', 'scheduler', 'subagents'];

/** Closes all drawers and deactivates their toggle buttons. */
export function closeAllDrawers() {
  const drawerMap = {
    history:   'history-drawer',
    memory:    'memory-drawer',
    security:  'security-drawer',
    scheduler: 'scheduler-drawer',
    subagents: 'subagents-drawer',
  };
  const toggleMap = {
    history:   'btn-toggle-history',
    memory:    'btn-toggle-memory',
    security:  'btn-toggle-security',
    scheduler: 'btn-toggle-scheduler',
    subagents: 'btn-toggle-subagents',
  };
  Object.values(drawerMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  Object.values(toggleMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
}

export function setMode(mode) {
  dom.container.dataset.mode = mode;

  // Panel visibility
  dom.idleState.style.display     = mode === 'idle'       ? 'flex' : 'none';
  dom.panel.style.display         = mode === 'responding' ? 'flex' : 'none';
  dom.historyDrawer.style.display = mode === 'history'    ? 'flex' : 'none';
  dom.memoryDrawer.style.display  = mode === 'memory'     ? 'flex' : 'none';

  if (dom.securityDrawer)
    dom.securityDrawer.style.display  = mode === 'security'  ? 'flex' : 'none';
  if (dom.schedulerDrawer)
    dom.schedulerDrawer.style.display = mode === 'scheduler' ? 'flex' : 'none';
  if (dom.subagentsDrawer)
    dom.subagentsDrawer.style.display = mode === 'subagents' ? 'flex' : 'none';

  // Active-state on toolbar buttons
  if (dom.btnToggleHistory)
    dom.btnToggleHistory.classList.toggle('active',   mode === 'history');
  if (dom.btnToggleMemory)
    dom.btnToggleMemory.classList.toggle('active',    mode === 'memory');
  if (dom.btnToggleSecurity)
    dom.btnToggleSecurity.classList.toggle('active',  mode === 'security');
  if (dom.btnToggleScheduler)
    dom.btnToggleScheduler.classList.toggle('active', mode === 'scheduler');
  if (dom.btnToggleSubagents)
    dom.btnToggleSubagents.classList.toggle('active', mode === 'subagents');

  // Footer hints
  dom.footerHint.innerHTML = state.pendingApprovalId
    ? HINTS.approval
    : (HINTS[mode] || HINTS.idle);

  if (mode === 'idle' || mode === 'responding') {
    setTimeout(() => dom.input?.focus(), 50);
  }
}

/** Returns true if the current mode is any drawer mode. */
export function isDrawerMode() {
  return DRAWER_MODES.includes(dom.container?.dataset?.mode);
}

export function setReactorState(reactorState) {
  if (!dom.reactor) return;
  dom.reactor.className = 'reactor-core';
  if (reactorState === 'listening') dom.reactor.classList.add('listening');
  else if (reactorState === 'speaking') dom.reactor.classList.add('speaking');
  else if (reactorState === 'thinking') dom.reactor.classList.add('thinking');
}

export function setActivity(active, label) {
  clearInterval(state.timer);
  if (active) {
    state.activityText = label || 'Procesando...';
    if (dom.strip) dom.strip.style.display = 'flex';
    if (dom.abortBtn) dom.abortBtn.style.display = state.isExecuting ? 'inline-block' : 'none';

    if (state.isExecuting) {
      const tick = () => {
        const s = Math.floor((Date.now() - state.taskStart) / 1000);
        if (dom.stripLabel)
          dom.stripLabel.textContent = s >= 2 ? `${state.activityText} (${s}s)` : state.activityText;
      };
      tick();
      state.timer = setInterval(tick, 1000);
    } else {
      if (dom.stripLabel) dom.stripLabel.textContent = state.activityText;
    }

    if (!state.isSpeaking) setReactorState('thinking');
  } else {
    if (dom.strip) dom.strip.style.display = 'none';
    if (dom.toolBadge) dom.toolBadge.style.display = 'none';
    if (!state.isSpeaking) setReactorState('idle');
  }
}

export function openExternalUrl(url) {
  if (!url) return;
  try {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(cleanUrl);
    } else {
      window.open(cleanUrl, '_blank', 'noopener,noreferrer');
    }
  } catch (err) {
    console.error('Error abriendo enlace externo:', err);
  }
}
