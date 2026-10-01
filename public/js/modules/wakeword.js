/**
 * wakeword.js — Passive wake word listener engine ("Hey JARVIS", "JARVIS").
 * Runs continuously in the background with zero GPU usage via native Web Speech API.
 * Automatically restores window, provides acoustic & visual Stark HUD feedback,
 * triggers active listening or auto-executes one-shot speech commands.
 */

import { state, dom, API_BASE } from './state.js';
import { setReactorState, setActivity } from './ui.js';
import { startRecording } from './voice.js';
import { sendPrompt } from './ws.js';

let recognition = null;
let isWakeWordActive = false;
let shouldRestart = false;
let autoDismissTimer = null;
let lastTriggerTimestamp = 0;

// Default keywords
let wakeKeywords = ['hey jarvis', 'jarvis', 'oye jarvis', 'hola jarvis', 'che jarvis', 'ok jarvis'];
let autoDismissSeconds = 12;

/**
 * Synthesizes a futuristic Stark HUD harmonic chime using Web Audio API.
 * Frequency sweep 880Hz -> 1320Hz with soft exponential decay.
 */
function playWakeChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.18);
    setTimeout(() => ctx.close().catch(() => {}), 250);
  } catch {
    // Non-critical audio chime
  }
}

/**
 * Parses user speech to detect wake word and isolate direct one-shot commands.
 */
export function parseWakeWordPhrase(transcript, keywords = wakeKeywords) {
  if (!transcript) return null;
  const clean = transcript
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()¿?¡!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Sort keywords by length descending so longer phrases like "oye jarvis" match before "jarvis"
  const sortedKeywords = keywords
    .slice()
    .map((k) => k.toLowerCase().trim())
    .sort((a, b) => b.length - a.length);

  for (const kwClean of sortedKeywords) {
    if (clean === kwClean) {
      return { keyword: kwClean, command: '', isOneShot: false };
    }
    if (clean.startsWith(kwClean + ' ')) {
      const command = clean.substring(kwClean.length).trim();
      return { keyword: kwClean, command, isOneShot: command.length > 0 };
    }
    // Match keyword inside phrase (e.g. "por favor jarvis abre calc")
    const index = clean.indexOf(kwClean);
    if (index !== -1) {
      const before = clean.substring(0, index).trim();
      const after = clean.substring(index + kwClean.length).trim();
      const command = [before, after].filter(Boolean).join(' ').trim();
      return { keyword: kwClean, command, isOneShot: command.length > 0 };
    }
  }

  return null;
}

/**
 * Handles wake word detection trigger.
 */
export async function triggerWakeWord(match, rawTranscript) {
  const now = Date.now();
  // Prevent duplicate double-firing within 2.5s
  if (now - lastTriggerTimestamp < 2500) return;
  lastTriggerTimestamp = now;

  console.log(`[WakeWord] Triggered: "${match.keyword}" (Raw: "${rawTranscript}")`);

  // 1. Bring native window to front and focus
  if (window.electronAPI && typeof window.electronAPI.show === 'function') {
    window.electronAPI.show();
    if (typeof window.electronAPI.wakeWordTriggered === 'function') {
      window.electronAPI.wakeWordTriggered(rawTranscript);
    }
  }

  // 2. Play subtle holographic activation chime
  playWakeChime();

  // 3. Reactor reactive visual pulse
  setReactorState('listening');

  // Cancel any ongoing auto-dismiss countdown
  cancelAutoDismiss();

  // 4. Handle command or activate microphone
  if (match.isOneShot && match.command) {
    // Direct command in same breath ("Hey JARVIS qué hora es")
    if (dom.input) {
      dom.input.value = match.command;
      setActivity(true, `Ejecutando orden: "${match.command}"...`);
      sendPrompt();
    }
  } else {
    // Pure wake word activation ("Hey JARVIS"): open mic listening
    setActivity(true, 'JARVIS a la escucha...');
    if (dom.input) {
      dom.input.placeholder = 'Escuchando su orden, señor...';
    }
    if (!state.isRecording) {
      await startRecording();
    }
  }

  // Setup auto-dismiss monitor once task finishes
  setupAutoDismissAfterTask();
}

/**
 * Starts auto-dismiss timer when the system returns to idle.
 */
export function setupAutoDismissAfterTask() {
  cancelAutoDismiss();
  if (autoDismissSeconds <= 0) return;

  const checkInterval = setInterval(() => {
    // Wait until task is not executing, not speaking, not recording
    if (!state.isExecuting && !state.isSpeaking && !state.isRecording) {
      clearInterval(checkInterval);
      startAutoDismissTimer();
    }
  }, 1000);
}

function startAutoDismissTimer() {
  cancelAutoDismiss();
  autoDismissTimer = setTimeout(() => {
    if (!state.isExecuting && !state.isSpeaking && !state.isRecording) {
      console.log('[WakeWord] Auto-dismissing HUD due to inactivity.');
      if (window.electronAPI && typeof window.electronAPI.hide === 'function') {
        window.electronAPI.hide();
      }
    }
  }, autoDismissSeconds * 1000);
}

export function cancelAutoDismiss() {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }
}

/**
 * Initializes the passive speech recognition engine.
 */
export function initWakeWordEngine() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[WakeWord] Web Speech API not supported in this environment.');
    return false;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-ES';
    recognition.maxAlternatives = 2;

    recognition.onresult = (event) => {
      // If JARVIS is currently actively recording through qwen3-asr or speaking, ignore passive background results
      if (state.isRecording || state.isSpeaking) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        for (let j = 0; j < res.length; j++) {
          const transcript = res[j].transcript;
          const match = parseWakeWordPhrase(transcript);
          if (match) {
            triggerWakeWord(match, transcript);
            break;
          }
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[WakeWord] Listener error:', event.error);
      }
    };

    recognition.onend = () => {
      // Auto-reconnect seamlessly if enabled
      if (shouldRestart && isWakeWordActive) {
        setTimeout(() => {
          if (shouldRestart && isWakeWordActive) {
            try {
              recognition.start();
            } catch {
              // Ignore restart error
            }
          }
        }, 400);
      }
    };

    return true;
  } catch (err) {
    console.error('[WakeWord] Failed to instantiate SpeechRecognition:', err);
    return false;
  }
}

export function startWakeWord() {
  if (!recognition) {
    const ok = initWakeWordEngine();
    if (!ok) return;
  }
  try {
    shouldRestart = true;
    isWakeWordActive = true;
    recognition.start();
    console.log('[WakeWord] Passive listening started ("Hey JARVIS").');
    updateWakeWordUI(true);
  } catch {
    // Already running
  }
}

export function stopWakeWord() {
  shouldRestart = false;
  isWakeWordActive = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch {}
  }
  console.log('[WakeWord] Passive listening stopped.');
  updateWakeWordUI(false);
}

export function toggleWakeWord() {
  if (isWakeWordActive) {
    stopWakeWord();
  } else {
    startWakeWord();
  }
}

export function isWakeWordEnabled() {
  return isWakeWordActive;
}

function updateWakeWordUI(active) {
  const btn = document.getElementById('native-wakeword-btn');
  if (btn) {
    if (active) {
      btn.classList.add('active');
      btn.title = 'Detección "Hey JARVIS" activa (Clic para pausar)';
    } else {
      btn.classList.remove('active');
      btn.title = 'Detección "Hey JARVIS" pausada (Clic para activar)';
    }
  }
}

/**
 * Fetch server configuration and bind events.
 */
export async function setupWakeWord() {
  // Cancel auto dismiss on any user interaction
  document.addEventListener('keydown', cancelAutoDismiss, { passive: true });
  document.addEventListener('mousedown', cancelAutoDismiss, { passive: true });

  try {
    const res = await fetch(`${API_BASE}/api/voice/wakeword`);
    if (res.ok) {
      const data = await res.json();
      if (data.keywords && Array.isArray(data.keywords)) {
        wakeKeywords = data.keywords;
      }
      if (data.autoDismissSeconds) {
        autoDismissSeconds = Number(data.autoDismissSeconds);
      }
      if (data.enabled) {
        startWakeWord();
      }
    } else {
      startWakeWord();
    }
  } catch {
    // If server offline, start with defaults
    startWakeWord();
  }

  const btn = document.getElementById('native-wakeword-btn');
  if (btn) {
    btn.addEventListener('click', toggleWakeWord);
  }
}
