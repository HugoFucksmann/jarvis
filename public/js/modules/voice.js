/**
 * voice.js — Voice input module: 16 kHz Mono WAV audio recording,
 *            silence trimming, downsampling, and Ollama ASR transcription.
 */
import { state, dom, API_BASE } from './state.js';
import { setReactorState, setActivity } from './ui.js';
import { stopSpeech } from './tts.js';

let audioCtx = null;
let micStream = null;
let processorNode = null;
let pcmChunks = [];

function trimSilence(samples, threshold = 0.015, padding = 1600) {
  let start = 0;
  let end = samples.length - 1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      start = Math.max(0, i - padding);
      break;
    }
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]) > threshold) {
      end = Math.min(samples.length - 1, i + padding);
      break;
    }
  }
  if (start >= end) return samples;
  return samples.slice(start, end + 1);
}

function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function downsample(buffer, inRate, outRate = 16000) {
  if (inRate === outRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffset = Math.round((offsetResult + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffset && i < buffer.length; i++) {
      sum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? sum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffset;
  }
  return result;
}

export async function startRecording() {
  try {
    stopSpeech();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    pcmChunks = [];

    const source = audioCtx.createMediaStreamSource(micStream);
    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (e) => {
      if (!state.isRecording) return;
      pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };

    source.connect(processorNode);
    processorNode.connect(audioCtx.destination);

    state.isRecording = true;
    if (dom.micBtn) dom.micBtn.classList.add('recording');
    setReactorState('listening');
    if (dom.input) dom.input.placeholder = 'Escuchando...';
  } catch (err) {
    console.error('Mic error:', err);
    state.isRecording = false;
  }
}

export async function stopRecording(onTranscribeSuccess) {
  if (!state.isRecording) return;
  state.isRecording = false;

  if (dom.micBtn) dom.micBtn.classList.remove('recording');
  setReactorState('idle');
  if (dom.input) dom.input.placeholder = '¿En qué puedo asistirlo, señor?';

  if (processorNode) processorNode.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  const inRate = audioCtx ? audioCtx.sampleRate : 44100;
  if (audioCtx) await audioCtx.close().catch(() => {});

  setActivity(true, 'Transcribiendo voz...');

  const totalLen = pcmChunks.reduce((acc, c) => acc + c.length, 0);
  if (totalLen === 0) {
    setActivity(false);
    return;
  }

  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const c of pcmChunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  const trimmed = trimSilence(merged);
  const downsampled = downsample(trimmed, inRate, 16000);
  const wavBlob = encodeWAV(downsampled, 16000);

  const reader = new FileReader();
  reader.readAsDataURL(wavBlob);
  reader.onloadend = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: reader.result }),
      });
      const data = await res.json();
      if (data.success && data.text) {
        if (onTranscribeSuccess) {
          onTranscribeSuccess(data.text);
        } else if (dom.input) {
          dom.input.value = data.text;
        }
      } else {
        setActivity(false, 'No se identificó voz clara.');
      }
    } catch (err) {
      console.error('ASR request error:', err);
      setActivity(false, 'Error en transcripción.');
    }
  };
}

export function bindVoiceEvents(onTranscribeSuccess) {
  if (dom.micBtn) {
    dom.micBtn.addEventListener('click', async () => {
      if (state.isRecording) {
        await stopRecording(onTranscribeSuccess);
      } else {
        await startRecording();
      }
    });
  }
}
