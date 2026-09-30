/**
 * tts.js — Text-to-Speech engine: voice selection, buffered sentence playback,
 *           speed control, and clean markdown stripping before speech.
 */
import { state, dom } from './state.js';
import { setReactorState } from './ui.js';

let ttsEnabled = true;
let ttsRate = 1.35;
let selectedVoice = null;
let ttsBuffer = '';

export function initTTS() {
  if (!('speechSynthesis' in window)) {
    if (dom.voiceIndicator) dom.voiceIndicator.textContent = '🔇 Sin TTS';
    return;
  }

  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    const esVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('es'));
    selectedVoice =
      esVoices.find((v) => /alvaro|raul|jorge|pablo|pedro/i.test(v.name)) ||
      esVoices.find((v) => /natural|online/i.test(v.name)) ||
      esVoices[0] ||
      voices[0];
  };

  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export function updateSpeedUI() {
  if (dom.voiceSpeedBadge) dom.voiceSpeedBadge.textContent = `${ttsRate}x`;
  if (dom.voiceIndicator) {
    dom.voiceIndicator.textContent = ttsEnabled ? `🔊 ${ttsRate}x` : '🔇 OFF';
    if (ttsEnabled) dom.voiceIndicator.classList.add('active');
    else dom.voiceIndicator.classList.remove('active');
  }
}

function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' bloque de código omitido ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#+\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[-*•]\s+/g, '')
    .replace(/[>_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speakChunk(text) {
  if (!ttsEnabled || !('speechSynthesis' in window)) return;
  const clean = cleanForSpeech(text);
  if (!clean || clean.length < 2) return;

  const utterance = new SpeechSynthesisUtterance(clean);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
  } else {
    utterance.lang = 'es-ES';
  }
  utterance.rate = ttsRate;
  utterance.pitch = 0.95;

  utterance.onstart = () => {
    state.isSpeaking = true;
    setReactorState('speaking');
  };

  utterance.onend = () => {
    if (!window.speechSynthesis.speaking) {
      state.isSpeaking = false;
      if (!state.isExecuting) setReactorState('idle');
    }
  };

  utterance.onerror = () => {
    state.isSpeaking = false;
    if (!state.isExecuting) setReactorState('idle');
  };

  window.speechSynthesis.speak(utterance);
}

export function feedSpeechToken(token) {
  if (!ttsEnabled) return;
  ttsBuffer += token;

  const match = ttsBuffer.match(/^([\s\S]*?[.!?:\n]+)\s+([\s\S]*)$/);
  if (match) {
    const sentence = match[1].trim();
    ttsBuffer = match[2];
    if (sentence.length > 3) speakChunk(sentence);
  }
}

export function flushSpeechBuffer() {
  if (!ttsEnabled) return;
  if (ttsBuffer.trim().length > 0) {
    speakChunk(ttsBuffer);
    ttsBuffer = '';
  }
}

export function stopSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  ttsBuffer = '';
  state.isSpeaking = false;
  if (!state.isExecuting) setReactorState('idle');
}

export function isTTSEnabled() {
  return ttsEnabled;
}

// TTS toggle button
export function bindTTSControls() {
  if (dom.ttsBtn) {
    dom.ttsBtn.addEventListener('click', () => {
      ttsEnabled = !ttsEnabled;
      if (ttsEnabled) {
        dom.ttsBtn.classList.add('active');
        dom.ttsBtn.classList.remove('muted');
      } else {
        stopSpeech();
        dom.ttsBtn.classList.remove('active');
        dom.ttsBtn.classList.add('muted');
      }
      updateSpeedUI();
    });
  }

  if (dom.voiceIndicator) {
    dom.voiceIndicator.addEventListener('click', () => {
      if (!ttsEnabled) {
        ttsEnabled = true;
        if (dom.ttsBtn) {
          dom.ttsBtn.classList.add('active');
          dom.ttsBtn.classList.remove('muted');
        }
      }
      const speeds = [1.1, 1.25, 1.35, 1.5, 1.7];
      const idx = speeds.indexOf(ttsRate);
      ttsRate = speeds[(idx + 1) % speeds.length];
      updateSpeedUI();
      speakChunk(`Velocidad ${ttsRate}x.`);
    });
  }
}
