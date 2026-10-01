/**
 * native.js — Orquestador nativo para JARVIS.
 */

import { state, dom } from './modules/state.js';
import {
  setMode,
  openExternalUrl,
  openTools,
  closePanels,
  isDrawerMode,
  isToolsOrDrawerMode,
  showNotice,
} from './modules/ui.js';
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

// Debe coincidir con --window-pad (12px × 2) en native.css y con MAX_HEIGHT en main.js
const WINDOW_PADDING = 24;
const MAX_WINDOW_HEIGHT = 750;

// ── Envío de directivas ──────────────────────────────────────────────────────
/** Envía el texto del input. Si no se pudo enviar, deja el texto editable y cierra paneles. */
function submitPrompt() {
  const sent = sendPrompt(sessionId);
  if (!sent && isToolsOrDrawerMode()) closePanels();
  return sent;
}

function runPrompt(text) {
  if (!dom.input) return;
  dom.input.value = text;
  if (!submitPrompt()) dom.input.focus();
}

dom.sendBtn?.addEventListener('click', submitPrompt);

dom.input?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return; // respeta IME
  e.preventDefault();
  submitPrompt();
});

// ── Menú de módulos ──────────────────────────────────────────────────────────
// El estado de paneles vive en setMode(); aquí solo se pide abrir/cerrar.
dom.btnTools?.addEventListener('click', () => {
  if (isToolsOrDrawerMode()) closePanels();
  else openTools();
});

// Las ✕ de los drawers SIEMPRE vuelven al menú de módulos.
// (Capture + stopImmediatePropagation anula los handlers propios de cada módulo.)
document.querySelectorAll('.drawer-close-btn').forEach((closeBtn) => {
  closeBtn.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      openTools();
    },
    true
  );
});

// ── Jerarquía adaptativa de Escape ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  e.preventDefault();

  const mode = dom.container.dataset.mode;

  // 1. Drawer → volver al menú de módulos
  if (isDrawerMode()) return openTools();
  // 2. Menú de módulos → volver al modo base (conserva la respuesta)
  if (mode === 'tools') return closePanels();
  // 3. Confirmación de seguridad pendiente → denegar
  if (state.pendingApprovalId) return answerApproval(false);
  // 4. Voz activa → silenciar
  if (state.isSpeaking) return stopSpeech();
  // 5. Tarea en ejecución → cancelar
  if (state.isExecuting) return abortTask();
  // 6. Respuesta en pantalla → limpiar
  if (mode === 'responding') return clearResponse();
  // 7. Input con texto → vaciar
  if (dom.input?.value) {
    dom.input.value = '';
    return;
  }
  // 8. Todo en reposo → ocultar ventana nativa
  window.electronAPI?.hide?.();
});

// ── Controles de ventana y respuesta ─────────────────────────────────────────
dom.closeBtn?.addEventListener('click', () => {
  stopSpeech();
  window.electronAPI?.hide?.();
});

dom.abortBtn?.addEventListener('click', abortTask);
dom.clearBtn?.addEventListener('click', clearResponse);

if (dom.copyBtn) {
  const copyLabel = dom.copyBtn.textContent;
  let copyTimer = null;

  dom.copyBtn.addEventListener('click', async () => {
    if (!state.rawResponse) return;
    try {
      await navigator.clipboard.writeText(state.rawResponse);
      dom.copyBtn.textContent = '¡Copiado!';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        dom.copyBtn.textContent = copyLabel;
      }, 1500);
    } catch (err) {
      console.error('Clipboard error:', err);
      showNotice('No se pudo copiar al portapapeles.', 3000);
    }
  });
}

// ── Enlaces externos seguros ─────────────────────────────────────────────────
dom.body?.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (link && link.href) {
    e.preventDefault();
    openExternalUrl(link.href);
  }
});

// ── Ventana nativa: altura ajustada al contenido ─────────────────────────────
// Evita una ventana transparente de 480px que bloquea clics sobre el escritorio.
// Requiere que preload.cjs exponga electronAPI.resizeHeight (ver notas de entrega).
function setupWindowSizing() {
  if (!dom.container || typeof window.electronAPI?.resizeHeight !== 'function') return;

  const cap = Math.min(MAX_WINDOW_HEIGHT - WINDOW_PADDING, Math.floor(window.screen.availHeight * 0.75));
  dom.container.style.maxHeight = `${cap}px`;

  let lastHeight = 0;
  let frame = 0;

  const sync = () => {
    frame = 0;
    const height = Math.ceil(dom.container.getBoundingClientRect().height) + WINDOW_PADDING;
    if (height === lastHeight) return;
    lastHeight = height;
    window.electronAPI.resizeHeight(height);
  };

  new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(sync);
  }).observe(dom.container);
}

// ── Inicialización de módulos ────────────────────────────────────────────────
bindTTSControls();
bindVoiceEvents(runPrompt);
bindHistoryEvents(runPrompt);
bindMemoryEvents();
bindSecurityEvents();
bindApprovalEvents();
bindSchedulerEvents();
initSubagentsDrawer();

// ── Bootstrap ────────────────────────────────────────────────────────────────
setupWindowSizing();
initWS(sessionId);
initTTS();
updateSpeedUI();
setupWakeWord();
setMode('idle');