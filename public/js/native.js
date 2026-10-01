/**
 * native.js — Orquestador nativo para JARVIS.
 */

import { state, dom } from './modules/state.js';
import { setMode, openExternalUrl } from './modules/ui.js';
import { initTTS, updateSpeedUI, bindTTSControls, stopSpeech } from './modules/tts.js';
import { bindVoiceEvents } from './modules/voice.js';
import { bindHistoryEvents } from './modules/history.js';
import { bindMemoryEvents } from './modules/memory.js';
import { bindSecurityEvents } from './modules/security.js';
import { bindApprovalEvents, answerApproval } from './modules/approvals.js';
import { initWS, sendPrompt, abortTask, clearResponse } from './modules/ws.js';
import { setupWakeWord } from './modules/wakeword.js';
import { bindSchedulerEvents } from './modules/scheduler.js';
import { initSubagentsDrawer } from './modules/subagents.js';

const sessionId = 'native_' + Date.now();
const DRAWER_MODES = new Set(['history', 'memory', 'security', 'scheduler', 'subagents']);

const btnTools = document.getElementById('btn-toggle-tools');
const toolsTray = document.getElementById('tools-tray');

// ── Control Centralizado del Menú de Módulos ──────────────────────────────────
function openToolsMenu() {
  setMode('idle'); // Oculta cualquier drawer activo
  dom.container.dataset.mode = 'tools';
  if (toolsTray) toolsTray.style.display = 'flex';
  if (btnTools) btnTools.classList.add('active');
}

function closeToolsMenu() {
  if (toolsTray) toolsTray.style.display = 'none';
  if (btnTools) btnTools.classList.remove('active');
  setMode('idle');
}

function updateToolsIconState() {
  const currentMode = dom.container.dataset.mode;
  const isToolsOrDrawerOpen = currentMode === 'tools' || DRAWER_MODES.has(currentMode);
  if (btnTools) {
    btnTools.classList.toggle('active', isToolsOrDrawerOpen);
  }
}

// ── Toggle con el Ícono de Módulos ───────────────────────────────────────────
if (btnTools) {
  btnTools.addEventListener('click', () => {
    const currentMode = dom.container.dataset.mode;
    const isAnyPanelOpen = currentMode === 'tools' || DRAWER_MODES.has(currentMode);

    if (isAnyPanelOpen) {
      closeToolsMenu();
    } else {
      openToolsMenu();
    }
  });
}

// Al seleccionar cualquier módulo del grid, ocultar el grid y mantener el ícono encendido
document.querySelectorAll('.tool-tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    if (toolsTray) toolsTray.style.display = 'none';
    setTimeout(updateToolsIconState, 20);
  });
});

// Interceptar las ✕ de los drawers para que SIEMPRE vuelvan a la lista de módulos
document.querySelectorAll('.drawer-close-btn').forEach((closeBtn) => {
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openToolsMenu();
  }, true);
});

// ── Enviar mensajes ──────────────────────────────────────────────────────────
if (dom.sendBtn) {
  dom.sendBtn.addEventListener('click', () => {
    closeToolsMenu();
    sendPrompt(sessionId);
  });
}

if (dom.input) {
  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      closeToolsMenu();
      sendPrompt(sessionId);
    }
  });
}

// ── Jerarquía Adaptativa de Escape ────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();

    const currentMode = dom.container.dataset.mode;

    // 1. Si está dentro de un drawer (Historial, Seguridad, etc.), volver al menú de módulos
    if (DRAWER_MODES.has(currentMode)) {
      openToolsMenu();
      return;
    }

    // 2. Si el menú de módulos está abierto, cerrarlo y replegar a idle
    if (currentMode === 'tools' || (toolsTray && toolsTray.style.display === 'flex')) {
      closeToolsMenu();
      return;
    }

    // 3. Denegar si hay confirmación de seguridad pendiente
    if (state.pendingApprovalId) {
      answerApproval(false);
      return;
    }

    // 4. Silenciar síntesis de voz activa
    if (state.isSpeaking) {
      stopSpeech();
      return;
    }

    // 5. Cancelar tarea en ejecución
    if (state.isExecuting) {
      abortTask();
      return;
    }

    // 6. Limpiar respuesta en pantalla
    if (currentMode === 'responding') {
      clearResponse();
      closeToolsMenu();
      return;
    }

    // 7. Limpiar input si contiene texto
    if (dom.input && dom.input.value) {
      dom.input.value = '';
      return;
    }

    // 8. En estado idle total, ocultar ventana nativa
    if (window.electronAPI && typeof window.electronAPI.hide === 'function') {
      window.electronAPI.hide();
    }
  }
});

// ── Botones de Control de Ventana ─────────────────────────────────────────────
if (dom.closeBtn) {
  dom.closeBtn.addEventListener('click', () => {
    stopSpeech();
    if (window.electronAPI && typeof window.electronAPI.hide === 'function') {
      window.electronAPI.hide();
    }
  });
}

if (dom.abortBtn) {
  dom.abortBtn.addEventListener('click', abortTask);
}

if (dom.clearBtn) {
  dom.clearBtn.addEventListener('click', () => {
    clearResponse();
    closeToolsMenu();
  });
}

if (dom.copyBtn) {
  dom.copyBtn.addEventListener('click', () => {
    if (state.rawResponse) {
      navigator.clipboard.writeText(state.rawResponse);
      const originalText = dom.copyBtn.textContent;
      dom.copyBtn.textContent = '¡Copiado!';
      setTimeout(() => {
        dom.copyBtn.textContent = originalText;
      }, 1500);
    }
  });
}

// ── Enlaces externos seguros ──────────────────────────────────────────────────
if (dom.body) {
  dom.body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      e.preventDefault();
      openExternalUrl(link.href);
    }
  });
}

// ── Inicialización de Módulos ─────────────────────────────────────────────────
bindTTSControls();

bindVoiceEvents((transcribedText) => {
  if (dom.input) {
    dom.input.value = transcribedText;
    closeToolsMenu();
    sendPrompt(sessionId);
  }
});

bindHistoryEvents((selectedPrompt) => {
  closeToolsMenu();
  if (dom.input) {
    dom.input.value = selectedPrompt;
    sendPrompt(sessionId);
  }
});

bindMemoryEvents();
bindSecurityEvents();
bindApprovalEvents();
bindSchedulerEvents();
initSubagentsDrawer();

// ── Bootstrap ─────────────────────────────────────────────────────────────────
initWS(sessionId);
initTTS();
updateSpeedUI();
setupWakeWord();
setMode('idle');
closeToolsMenu();