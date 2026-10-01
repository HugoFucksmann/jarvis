/**
 * ChatPanel.js — Chat Panel Module
 *
 * Owns the chat panel DOM: message rendering, input bar, voice recording,
 * and activity strip. Exports a factory function that receives the WebSocket
 * getter and returns an object with lifecycle methods.
 *
 * @param {object} deps
 * @param {() => WebSocket|null} deps.getWs   - getter for the current WS instance
 * @param {string}               deps.sessionId
 */
export function createChatPanel({ getWs, sessionId }) {
  // ── DOM refs ────────────────────────────────────────────────────
  const root          = document.getElementById('panel-chat');
  const messagesList  = root?.querySelector('#messages-list');
  const activityStrip = root?.querySelector('#activity-strip');
  const activityState = root?.querySelector('#activity-state');
  const activityDetail= root?.querySelector('#activity-detail');
  const activitySpinner= root?.querySelector('#activity-spinner');
  const abortBtn      = root?.querySelector('#btn-abort-task');
  const textarea      = root?.querySelector('#chat-textarea');
  const sendBtn       = root?.querySelector('#btn-send');
  const micBtn        = root?.querySelector('#btn-mic');
  const micText       = root?.querySelector('#mic-text');
  const micDeviceSelect = root?.querySelector('#mic-device-selector');
  const wakeWordBtn   = root?.querySelector('#btn-wakeword');

  // ── State ────────────────────────────────────────────────────────
  let isExecuting    = false;
  /** @type {HTMLElement|null} */
  let activeCard     = null;
  /** @type {HTMLElement|null} */
  let activeContent  = null;
  /** @type {Map<string, HTMLElement>} */
  let activeToolCards = new Map();

  // Voice state
  let isRecording      = false;
  let audioCtx         = null;
  let micStream        = null;
  let processorNode    = null;
  let pcmChunks        = [];
  let inputSampleRate  = 48000;

  // ── Helpers ──────────────────────────────────────────────────────

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
  }

  function now() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToBottom() {
    if (messagesList) messagesList.scrollTop = messagesList.scrollHeight;
  }

  // ── Activity strip ───────────────────────────────────────────────

  /**
   * @param {string} state
   * @param {string} detail
   * @param {boolean} running
   */
  function setActivity(state, detail, running) {
    if (!activityStrip) return;
    if (activityState)  activityState.textContent  = state;
    if (activityDetail) activityDetail.textContent = detail || '';
    activityStrip.classList.toggle('running', running);
    if (abortBtn) abortBtn.style.display = running ? '' : 'none';
  }

  // ── Message renderers ────────────────────────────────────────────

  function appendUserMessage(text) {
    if (!messagesList) return;
    const card = document.createElement('div');
    card.className = 'msg-card user';
    card.innerHTML = `
      <div class="msg-meta">
        <span class="msg-author">YOU</span>
        <span class="msg-time">${now()}</span>
      </div>
      <div class="msg-body"><p>${escapeHtml(text)}</p></div>
    `;
    messagesList.appendChild(card);
    scrollToBottom();
  }

  function createAssistantCard() {
    if (!messagesList) return;
    activeCard = document.createElement('div');
    activeCard.className = 'msg-card assistant';
    activeCard.innerHTML = `
      <div class="msg-meta">
        <span class="msg-author">J.A.R.V.I.S.</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="msg-time">${now()}</span>
          <button class="msg-copy-btn" title="Copiar respuesta">Copiar</button>
        </div>
      </div>
      <div class="msg-body"></div>
    `;
    activeContent = activeCard.querySelector('.msg-body');
    messagesList.appendChild(activeCard);
    scrollToBottom();
  }

  function appendErrorMessage(text) {
    if (!messagesList) return;
    const card = document.createElement('div');
    card.className = 'msg-card error';
    card.innerHTML = `
      <div class="msg-meta">
        <span class="msg-author">SYSTEM ERROR</span>
        <span class="msg-time">${now()}</span>
      </div>
      <div class="msg-body"><p>${escapeHtml(text)}</p></div>
    `;
    messagesList.appendChild(card);
    scrollToBottom();
  }

  // ── Tool call rendering ──────────────────────────────────────────

  function renderToolStart(event) {
    if (!activeContent) createAssistantCard();
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.id = `tool-${event.callId}`;
    card.innerHTML = `
      <div class="tool-card-header">
        <span class="tool-card-name">⚡ ${escapeHtml(event.toolName)}</span>
        <span class="risk-badge ${event.riskLevel}">${event.riskLevel}</span>
      </div>
      <div class="tool-card-body">
        <span class="args">${escapeHtml(JSON.stringify(event.args))}</span>
        <span class="result-status pending">⏳ Ejecutando...</span>
      </div>
    `;
    activeContent.appendChild(card);
    activeToolCards.set(event.callId, card);
    scrollToBottom();
  }

  function renderToolResult(event) {
    const card = activeToolCards.get(event.callId);
    if (!card) return;
    const statusEl = card.querySelector('.result-status');
    if (event.result.success) {
      statusEl.className = 'result-status success';
      statusEl.textContent = '✓ Completado';
      const dataEl = document.createElement('div');
      dataEl.className = 'result-data';
      dataEl.textContent = JSON.stringify(event.result.data, null, 2);
      card.querySelector('.tool-card-body').appendChild(dataEl);
    } else {
      statusEl.className = 'result-status error';
      statusEl.textContent = `✗ ${event.result.error || 'Error'}`;
    }
    scrollToBottom();
  }

  // ── Agent event handlers ─────────────────────────────────────────

  function handleAgentEvent(event) {
    switch (event.type) {
      case 'state_change':
        setActivity(event.state, event.message, true);
        break;
      case 'token':
        if (!activeCard) createAssistantCard();
        if (activeContent) activeContent.textContent += event.token;
        scrollToBottom();
        break;
      case 'tool_call_start':
        renderToolStart(event);
        break;
      case 'tool_call_result':
        renderToolResult(event);
        break;
      case 'thinking_summary':
        if (activityDetail) activityDetail.textContent = event.summary;
        break;
      case 'task_complete':
        if (activeContent && !activeContent.textContent) {
          activeContent.textContent = event.response;
        }
        break;
    }
  }

  function onTaskFinished(result) {
    isExecuting = false;
    setActivity('Listo', `Completado en ${(result.durationMs / 1000).toFixed(1)}s`, false);
    activeCard  = null;
    activeContent = null;
    activeToolCards.clear();
    if (sendBtn) sendBtn.disabled = false;
  }

  function onTaskCancelled() {
    isExecuting = false;
    setActivity('Cancelado', 'La tarea fue interrumpida.', false);
    if (sendBtn) sendBtn.disabled = false;
  }

  function onError(msg) {
    appendErrorMessage(msg);
    setActivity('Error', msg, false);
    isExecuting = false;
    if (sendBtn) sendBtn.disabled = false;
  }

  // ── Send prompt ──────────────────────────────────────────────────

  function sendPrompt() {
    const text = textarea?.value.trim();
    if (!text || isExecuting) return;
    const ws = getWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendErrorMessage('Sin conexión con el servidor JARVIS.');
      return;
    }
    isExecuting = true;
    if (sendBtn) sendBtn.disabled = true;
    appendUserMessage(text);
    if (textarea) { textarea.value = ''; textarea.style.height = 'auto'; }
    createAssistantCard();
    setActivity('Iniciando', 'Procesando instrucción...', true);
    ws.send(JSON.stringify({ type: 'chat_message', payload: { prompt: text, sessionId } }));
  }

  // ── Voice recording ──────────────────────────────────────────────

  function downsampleBuffer(buf, inRate, outRate = 16000) {
    if (inRate === outRate) return buf;
    const ratio = inRate / outRate;
    const out   = new Float32Array(Math.round(buf.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const lo = Math.round(i * ratio), hi = Math.round((i + 1) * ratio);
      let sum = 0, cnt = 0;
      for (let j = lo; j < hi && j < buf.length; j++) { sum += buf[j]; cnt++; }
      out[i] = cnt ? sum / cnt : 0;
    }
    return out;
  }

  function encodeWAV(samples, rate) {
    const buf  = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buf);
    const str  = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, samples.length * 2, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  function trimSilence(samples, threshold = 0.015, padding = 1600) {
    let start = 0, end = samples.length - 1;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > threshold) { start = Math.max(0, i - padding); break; }
    }
    for (let i = samples.length - 1; i >= 0; i--) {
      if (Math.abs(samples[i]) > threshold) { end = Math.min(samples.length - 1, i + padding); break; }
    }
    return start >= end ? samples : samples.slice(start, end + 1);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      appendErrorMessage('Tu navegador no soporta captura de micrófono.');
      return;
    }
    const deviceId = micDeviceSelect?.value || '';
    const constraints = deviceId
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true };

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      inputSampleRate = audioCtx.sampleRate;
      pcmChunks = [];
      const source = audioCtx.createMediaStreamSource(micStream);
      processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
      processorNode.onaudioprocess = (e) => {
        if (isRecording) pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processorNode);
      processorNode.connect(audioCtx.destination);
      isRecording = true;
      if (micBtn)  micBtn.classList.add('recording');
      if (micText) micText.textContent = 'Grabando...';
      setActivity('Escuchando', 'Presioná el botón para transcribir y enviar.', true);
    } catch {
      appendErrorMessage('No se pudo acceder al micrófono.');
    }
  }

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    if (micBtn)  micBtn.classList.remove('recording');
    if (micText) micText.textContent = 'VOZ';
    processorNode?.disconnect(); processorNode = null;
    micStream?.getTracks().forEach((t) => t.stop()); micStream = null;
    await audioCtx?.close().catch(() => {}); audioCtx = null;

    setActivity('Transcribiendo', 'Procesando audio con qwen3-asr...', true);

    let totalLen = 0;
    for (const c of pcmChunks) totalLen += c.length;
    if (totalLen === 0) { setActivity('Sin audio', 'No se capturó audio.', false); return; }

    const merged = new Float32Array(totalLen);
    let off = 0;
    for (const c of pcmChunks) { merged.set(c, off); off += c.length; }

    const trimmed    = trimSilence(merged);
    const downsampled = downsampleBuffer(trimmed, inputSampleRate, 16000);
    const wavBlob    = encodeWAV(downsampled, 16000);

    const reader = new FileReader();
    reader.readAsDataURL(wavBlob);
    reader.onloadend = async () => {
      try {
        const res  = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: reader.result }),
        });
        const data = await res.json();
        if (data.success && data.text?.trim()) {
          if (textarea) textarea.value = data.text.trim();
          setActivity('Voz capturada', `"${data.text.trim()}"`, false);
          sendPrompt();
        } else {
          setActivity('Sin palabras', 'No se detectó texto claro.', false);
        }
      } catch {
        appendErrorMessage('Error en el servicio de transcripción.');
        setActivity('Error de voz', '', false);
      }
    };
  }

  // ── Populate mic devices ─────────────────────────────────────────

  async function populateMicDevices() {
    if (!micDeviceSelect || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let inputs  = devices.filter((d) => d.kind === 'audioinput');
      if (inputs.length > 0 && !inputs[0].label) {
        try {
          const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
          tmp.getTracks().forEach((t) => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
          inputs  = devices.filter((d) => d.kind === 'audioinput');
        } catch { /* permission denied */ }
      }
      const saved = localStorage.getItem('jarvis_mic') || '';
      micDeviceSelect.innerHTML = '';
      inputs.forEach((mic, idx) => {
        const opt = document.createElement('option');
        opt.value = mic.deviceId;
        opt.textContent = mic.label || `Micrófono ${idx + 1}`;
        if (mic.deviceId === saved) opt.selected = true;
        micDeviceSelect.appendChild(opt);
      });
      micDeviceSelect.addEventListener('change', () => {
        localStorage.setItem('jarvis_mic', micDeviceSelect.value);
      });
    } catch { /* ignore */ }
  }

  // ── Wake Word continuous listener ─────────────────────────────────
  let wakeRecognition = null;
  let isWakeActive = false;

  function initChatWakeWord() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (wakeWordBtn) wakeWordBtn.style.display = 'none';
      return;
    }

    try {
      wakeRecognition = new SpeechRecognition();
      wakeRecognition.continuous = true;
      wakeRecognition.interimResults = true;
      wakeRecognition.lang = 'es-ES';

      wakeRecognition.onresult = (e) => {
        if (isRecording || isExecuting) return;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const text = e.results[i][0]?.transcript?.toLowerCase() || '';
          if (
            text.includes('hey jarvis') ||
            text.includes('jarvis') ||
            text.includes('oye jarvis') ||
            text.includes('hola jarvis')
          ) {
            let cmd = text
              .replace(/hey jarvis|oye jarvis|hola jarvis|jarvis/g, '')
              .replace(/[.,/#!$%^&*;:{}=\-_`~()¿?¡!]/g, '')
              .trim();
            if (cmd.length > 2 && textarea) {
              textarea.value = cmd;
              sendPrompt();
            } else if (!isRecording) {
              startRecording();
            }
            break;
          }
        }
      };

      wakeRecognition.onerror = () => {};
      wakeRecognition.onend = () => {
        if (isWakeActive) {
          setTimeout(() => {
            if (isWakeActive) {
              try {
                wakeRecognition.start();
              } catch {}
            }
          }, 500);
        }
      };

      isWakeActive = true;
      wakeRecognition.start();
      if (wakeWordBtn) wakeWordBtn.classList.add('active');
    } catch {
      isWakeActive = false;
    }
  }

  function toggleChatWakeWord() {
    if (!wakeRecognition) {
      initChatWakeWord();
      return;
    }
    if (isWakeActive) {
      isWakeActive = false;
      try {
        wakeRecognition.stop();
      } catch {}
      if (wakeWordBtn) {
        wakeWordBtn.classList.remove('active');
        wakeWordBtn.title = 'Detección "Hey JARVIS" pausada (Clic para activar)';
      }
    } else {
      isWakeActive = true;
      try {
        wakeRecognition.start();
      } catch {}
      if (wakeWordBtn) {
        wakeWordBtn.classList.add('active');
        wakeWordBtn.title = 'Detección "Hey JARVIS" activa (Clic para pausar)';
      }
    }
  }

  // ── Event bindings ───────────────────────────────────────────────

  function bindEvents() {
    sendBtn?.addEventListener('click', sendPrompt);
    textarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
    });
    textarea?.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
    });
    micBtn?.addEventListener('click', () => { isRecording ? stopRecording() : startRecording(); });
    wakeWordBtn?.addEventListener('click', toggleChatWakeWord);
    abortBtn?.addEventListener('click', () => {
      const ws = getWs();
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel_task' }));
    });
    root?.addEventListener('click', (e) => {
      const chip = e.target.closest('.suggestion-chip');
      if (chip && textarea) {
        textarea.value = chip.textContent.trim();
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
      }
    });
    const clearBtn = root?.querySelector('#btn-clear-chat');
    clearBtn?.addEventListener('click', () => {
      if (!messagesList) return;
      messagesList.innerHTML = `
        <div class="msg-card welcome">
          <div class="welcome-title">
            <span>⚡ J.A.R.V.I.S. Operativo</span>
          </div>
          <div class="welcome-desc">
            Asistente autónomo local conectado a Ollama. Podés interactuar por texto o voz y reacomodar los paneles libremente.
          </div>
          <div class="welcome-suggestions">
            <div class="suggestion-chip">¿Cuál es el estado del hardware?</div>
            <div class="suggestion-chip">Guardá que prefiero TypeScript</div>
            <div class="suggestion-chip">Listá los archivos locales</div>
          </div>
        </div>
      `;
      setActivity('Listo', 'Conversación reiniciada.', false);
    });

    messagesList?.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.msg-copy-btn');
      if (copyBtn) {
        const card = copyBtn.closest('.msg-card');
        const body = card?.querySelector('.msg-body');
        if (body) {
          navigator.clipboard.writeText(body.innerText.trim()).then(() => {
            const original = copyBtn.textContent;
            copyBtn.textContent = '✓ Copiado';
            setTimeout(() => { copyBtn.textContent = original; }, 1800);
          });
        }
      }
    });

    populateMicDevices();
    initChatWakeWord();
  }

  // ── Public interface ─────────────────────────────────────────────

  return {
    /** Call once on init */
    init: bindEvents,
    /** Called by WS handler for agent events */
    handleAgentEvent,
    onTaskFinished,
    onTaskCancelled,
    onError,
    /** Shows an inline notification when a background subagent finishes */
    onSubagentFinished(payload) {
      if (!payload) return;
      const icon   = payload.status === 'completed' ? '✓' : '✕';
      const color  = payload.status === 'completed' ? 'var(--color-green, #10b981)' : 'var(--color-red)';
      const label  = payload.status === 'completed' ? 'Completado' : 'Fallido';
      const title  = payload.title || 'Subagente';
      appendErrorMessage(`<span style="color:${color};">${icon} Subagente <strong>${title}</strong>: ${label}</span>`);
    },
    /** Used by approval flow to directly inject text */
    appendErrorMessage,
    setActivity,
  };
}
