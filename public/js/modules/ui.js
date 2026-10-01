/**
 * ui.js — UI state machine: modes, activity strip, reactor, notices, external links.
 *
 * Modos: idle | responding | tools | history | memory | security | scheduler | subagents
 * "idle" y "responding" son los modos BASE (barra sola / barra + respuesta).
 * "tools" y los drawers son paneles superpuestos que siempre vuelven al modo base.
 */
import { state, dom } from './state.js';

const HINTS = {
  idle: '<span><kbd>Enter</kbd> enviar</span><span><kbd>Ctrl+M</kbd> voz</span><span><kbd>Alt+Espacio</kbd> invocar</span>',
  working: '<span><kbd>Esc</kbd> detener</span><span>Procesando directiva...</span>',
  responding: '<span><kbd>Esc</kbd> limpiar</span><span><kbd>Ctrl+Shift+C</kbd> copiar</span><span><kbd>Alt+Espacio</kbd> ocultar</span>',
  tools: '<span><kbd>Esc</kbd> cerrar menú</span>',
  history: '<span><kbd>Esc</kbd> volver</span><span>Clic en tarea para reutilizar</span>',
  memory: '<span><kbd>Esc</kbd> volver</span><span>Edición directa de .jarvis/MEMORY.md</span>',
  security: '<span><kbd>Esc</kbd> volver</span><span>Configuración de comandos y permisos</span>',
  scheduler: '<span><kbd>Esc</kbd> volver</span><span>Recordatorios y tareas programadas</span>',
  subagents: '<span><kbd>Esc</kbd> volver</span><span>Tareas en segundo plano activas</span>',
  approval: '<span><kbd>Ctrl+Enter</kbd> autorizar</span><span><kbd>Esc</kbd> denegar</span>',
};

const DRAWER_MODES = ['history', 'memory', 'security', 'scheduler', 'subagents'];

/** Closes all drawers and deactivates their toggle buttons. */
export function closeAllDrawers() {
  [dom.historyDrawer, dom.memoryDrawer, dom.securityDrawer, dom.schedulerDrawer, dom.subagentsDrawer]
    .forEach((el) => { if (el) el.style.display = 'none'; });
  [dom.btnToggleHistory, dom.btnToggleMemory, dom.btnToggleSecurity, dom.btnToggleScheduler, dom.btnToggleSubagents]
    .forEach((el) => { if (el) el.classList.remove('active'); });
}

function show(el, visible) {
  if (el) el.style.display = visible ? 'flex' : 'none';
}

export function setMode(mode) {
  if (!dom.container) return;
  dom.container.dataset.mode = mode;

  // Visibilidad de paneles: única fuente de verdad (incluye el menú de módulos)
  show(dom.idleState, false);
  show(dom.toolsTray, mode === 'tools');
  show(dom.panel, mode === 'responding');
  show(dom.historyDrawer, mode === 'history');
  show(dom.memoryDrawer, mode === 'memory');
  show(dom.securityDrawer, mode === 'security');
  show(dom.schedulerDrawer, mode === 'scheduler');
  show(dom.subagentsDrawer, mode === 'subagents');

  // Estado activo de los botones
  dom.btnToggleHistory?.classList.toggle('active', mode === 'history');
  dom.btnToggleMemory?.classList.toggle('active', mode === 'memory');
  dom.btnToggleSecurity?.classList.toggle('active', mode === 'security');
  dom.btnToggleScheduler?.classList.toggle('active', mode === 'scheduler');
  dom.btnToggleSubagents?.classList.toggle('active', mode === 'subagents');

  const panelOpen = mode === 'tools' || DRAWER_MODES.includes(mode);
  if (dom.btnTools) {
    dom.btnTools.classList.toggle('active', panelOpen);
    dom.btnTools.setAttribute('aria-expanded', String(panelOpen));
  }

  if (dom.footerHint) {
    dom.footerHint.innerHTML = state.pendingApprovalId ? HINTS.approval : (HINTS[mode] || HINTS.idle);
  }

  if (mode === 'idle' || mode === 'responding') {
    setTimeout(() => {
      // Evita robar el foco si el modo cambió durante el retardo
      if (dom.container.dataset.mode === mode) dom.input?.focus();
    }, 50);
  }
}

/** Modo base según haya o no respuesta en pantalla. */
export function getBaseMode() {
  return state.rawResponse ? 'responding' : 'idle';
}

export function openTools() {
  setMode('tools');
}

/** Cierra menú/drawers y vuelve al modo base (conserva la respuesta visible). */
export function closePanels() {
  setMode(getBaseMode());
}

/**
 * Re-evalúa el modo base SOLO si el usuario está en idle/responding.
 * No arrastra al usuario fuera de un drawer o del menú por eventos asíncronos.
 */
export function settleMode() {
  const mode = dom.container?.dataset?.mode;
  if (mode === 'idle' || mode === 'responding') setMode(getBaseMode());
}

export function isDrawerMode() {
  return DRAWER_MODES.includes(dom.container?.dataset?.mode);
}

export function isToolsOrDrawerMode() {
  return dom.container?.dataset?.mode === 'tools' || isDrawerMode();
}

// ── Reactor ───────────────────────────────────────────────────────────────────
export function setReactorState(reactorState) {
  if (!dom.reactor) return;
  // Sin conexión, el estado "idle" se muestra como desconectado
  const effective = !state.isConnected && reactorState === 'idle' ? 'offline' : reactorState;
  dom.reactor.className = 'reactor-core';
  if (['listening', 'speaking', 'thinking', 'offline'].includes(effective)) {
    dom.reactor.classList.add(effective);
  }
  dom.reactor.title = effective === 'offline' ? 'JARVIS desconectado — reconectando…' : 'JARVIS en línea';
}

// ── Avisos (reemplazan a alert()) ─────────────────────────────────────────────
let noticeTimer = null;

/** duration = 0 → permanece hasta hideNotice(). */
export function showNotice(message, duration = 5000) {
  if (!dom.notice) return;
  clearTimeout(noticeTimer);
  dom.notice.textContent = message;
  dom.notice.style.display = 'flex';
  if (duration > 0) noticeTimer = setTimeout(hideNotice, duration);
}

export function hideNotice() {
  clearTimeout(noticeTimer);
  if (dom.notice) dom.notice.style.display = 'none';
}

// ── Barra de actividad ────────────────────────────────────────────────────────
export function setActivity(active, label) {
  clearInterval(state.timer);
  state.timer = null;
  if (active) {
    state.activityText = label || 'Procesando...';
    if (dom.strip) dom.strip.style.display = 'flex';
    if (dom.abortBtn) dom.abortBtn.style.display = state.isExecuting ? 'inline-block' : 'none';
    dom.body?.setAttribute('aria-busy', String(state.isExecuting));

    if (state.isExecuting) {
      const tick = () => {
        const s = Math.floor((Date.now() - state.taskStart) / 1000);
        if (dom.stripLabel)
          dom.stripLabel.textContent = s >= 2 ? `${state.activityText} (${s}s)` : state.activityText;
      };
      tick();
      state.timer = setInterval(tick, 1000);
    } else if (dom.stripLabel) {
      dom.stripLabel.textContent = state.activityText;
    }

    if (!state.isSpeaking) setReactorState('thinking');
  } else {
    if (dom.strip) dom.strip.style.display = 'none';
    if (dom.toolBadge) dom.toolBadge.style.display = 'none';
    dom.body?.setAttribute('aria-busy', 'false');
    if (!state.isSpeaking) setReactorState('idle');
  }
}

// ── Enlaces externos ──────────────────────────────────────────────────────────
export function openExternalUrl(url) {
  if (!url) return;
  try {
    const raw = String(url).trim();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      parsed = new URL('https://' + raw);
    }
    // Solo http/https: descarta javascript:, file:, etc.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(parsed.href);
    } else {
      window.open(parsed.href, '_blank', 'noopener,noreferrer');
    }
  } catch (err) {
    console.error('Error abriendo enlace externo:', err);
  }
}