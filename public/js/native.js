/**
 * native.js — Orchestrator and entry point for JARVIS native Electron HUD.
 * Coordinates UI, WebSocket, Audio ASR/TTS, and Drawers via modular sub-systems.
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

const sessionId = 'native_' + Date.now();

// ── Quick suggestions pill buttons ───────────────────────────────────────────
document.querySelectorAll('.pill-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const prompt = btn.getAttribute('data-prompt');
    if (prompt && dom.input) {
      dom.input.value = prompt;
      sendPrompt(sessionId);
    }
  });
});

// ── Send Prompt Interactions ──────────────────────────────────────────────────
if (dom.sendBtn) {
  dom.sendBtn.addEventListener('click', () => sendPrompt(sessionId));
}

if (dom.input) {
  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendPrompt(sessionId);
    }
  });
}

// ── Adaptive Esc Hotkey Hierarchy ─────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();

    // 1. If drawer is open, close it back to previous mode
    const currentMode = dom.container.dataset.mode;
    if (currentMode === 'history' || currentMode === 'memory' || currentMode === 'security') {
      setMode(state.rawResponse ? 'responding' : 'idle');
      return;
    }

    // 2. If approval overlay is visible, deny
    if (state.pendingApprovalId) {
      answerApproval(false);
      return;
    }

    // 3. If speech is actively synthesizing, mute
    if (state.isSpeaking) {
      stopSpeech();
      return;
    }

    // 4. If agent task is executing, abort it
    if (state.isExecuting) {
      abortTask();
      return;
    }

    // 5. If response is displayed, clear it
    if (currentMode === 'responding') {
      clearResponse();
      return;
    }

    // 6. If input has text, empty it
    if (dom.input && dom.input.value) {
      dom.input.value = '';
      return;
    }

    // 7. If totally idle, hide Electron window
    if (window.electronAPI && typeof window.electronAPI.hide === 'function') {
      window.electronAPI.hide();
    }
  }
});

// ── Window and Task Control Buttons ───────────────────────────────────────────
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
  dom.clearBtn.addEventListener('click', clearResponse);
}

if (dom.copyBtn) {
  dom.copyBtn.addEventListener('click', () => {
    if (state.rawResponse) {
      navigator.clipboard.writeText(state.rawResponse);
      dom.copyBtn.textContent = '¡Copiado!';
      setTimeout(() => {
        dom.copyBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg> Copiar`;
      }, 1500);
    }
  });
}

// ── External links inside responses ───────────────────────────────────────────
if (dom.body) {
  dom.body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      e.preventDefault();
      openExternalUrl(link.href);
    }
  });
}

// ── Bind Feature Modules ──────────────────────────────────────────────────────
bindTTSControls();

bindVoiceEvents((transcribedText) => {
  if (dom.input) {
    dom.input.value = transcribedText;
    sendPrompt(sessionId);
  }
});

bindHistoryEvents((selectedPrompt) => {
  setMode('idle');
  if (dom.input) {
    dom.input.value = selectedPrompt;
    sendPrompt(sessionId);
  }
});

bindMemoryEvents();
bindSecurityEvents();
bindApprovalEvents();

// ── Bootstrap ─────────────────────────────────────────────────────────────────
initWS(sessionId);
initTTS();
updateSpeedUI();
setMode('idle');
