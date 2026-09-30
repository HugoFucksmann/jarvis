/**
 * ui.js — UI state machine: modes, activity strip, reactor, hints, external links.
 */
import { state, dom } from './state.js';

const HINTS = {
  idle:      '<span><kbd>Enter</kbd> enviar</span><span><kbd>Ctrl+M</kbd> voz</span><span><kbd>Alt+Espacio</kbd> invocar</span>',
  working:   '<span><kbd>Esc</kbd> detener</span><span>Procesando directiva...</span>',
  responding:'<span><kbd>Esc</kbd> limpiar</span><span><kbd>Ctrl+Shift+C</kbd> copiar</span><span><kbd>Alt+Espacio</kbd> ocultar</span>',
  history:   '<span><kbd>Esc</kbd> cerrar historial</span><span>Clic en tarea para reutilizar</span>',
  memory:    '<span><kbd>Esc</kbd> cerrar memoria</span><span>Edición directa de .jarvis/MEMORY.md</span>',
  security:  '<span><kbd>Esc</kbd> cerrar seguridad</span><span>Configuración de comandos y permisos</span>',
  approval:  '<span><kbd>Ctrl+Enter</kbd> autorizar</span><span><kbd>Esc</kbd> denegar</span>',
};

export function setMode(mode) {
  dom.container.dataset.mode = mode;

  // Panel visibility
  dom.idleState.style.display       = mode === 'idle'      ? 'flex' : 'none';
  dom.panel.style.display           = mode === 'responding' ? 'flex' : 'none';
  dom.historyDrawer.style.display   = mode === 'history'   ? 'flex' : 'none';
  dom.memoryDrawer.style.display    = mode === 'memory'    ? 'flex' : 'none';
  if (dom.securityDrawer) {
    dom.securityDrawer.style.display = mode === 'security' ? 'flex' : 'none';
  }

  // Active-state on toolbar buttons
  if (dom.btnToggleHistory)  dom.btnToggleHistory.classList.toggle('active', mode === 'history');
  if (dom.btnToggleMemory)   dom.btnToggleMemory.classList.toggle('active', mode === 'memory');
  if (dom.btnToggleSecurity) dom.btnToggleSecurity.classList.toggle('active', mode === 'security');

  // Footer hints
  dom.footerHint.innerHTML = state.pendingApprovalId
    ? HINTS.approval
    : (HINTS[mode] || HINTS.idle);

  if (mode === 'idle' || mode === 'responding') {
    setTimeout(() => dom.input.focus(), 50);
  }
}

export function setReactorState(reactorState) {
  dom.reactor.className = 'reactor-core';
  if (reactorState === 'listening') dom.reactor.classList.add('listening');
  else if (reactorState === 'speaking') dom.reactor.classList.add('speaking');
  else if (reactorState === 'thinking') dom.reactor.classList.add('thinking');
}

export function setActivity(active, label) {
  clearInterval(state.timer);
  if (active) {
    state.activityText = label || 'Procesando...';
    dom.strip.style.display = 'flex';
    dom.abortBtn.style.display = state.isExecuting ? 'inline-block' : 'none';

    if (state.isExecuting) {
      const tick = () => {
        const s = Math.floor((Date.now() - state.taskStart) / 1000);
        dom.stripLabel.textContent = s >= 2 ? `${state.activityText} (${s}s)` : state.activityText;
      };
      tick();
      state.timer = setInterval(tick, 1000);
    } else {
      dom.stripLabel.textContent = state.activityText;
    }

    if (!state.isSpeaking) setReactorState('thinking');
  } else {
    dom.strip.style.display = 'none';
    dom.toolBadge.style.display = 'none';
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
