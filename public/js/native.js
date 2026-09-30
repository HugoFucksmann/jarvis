// JARVIS Native Spotlight Client - Minimalist & Elegant
(() => {
  let ws = null;
  let currentSessionId = 'native_' + Date.now();
  let isExecuting = false;
  let pendingApprovalId = null;

  // DOM Elements
  const container = document.getElementById('jarvis-container');
  const nativeInput = document.getElementById('native-input');
  const nativeTtsBtn = document.getElementById('native-tts-btn');
  const voiceSpeedBadge = document.getElementById('voice-speed-badge');
  const nativeMicBtn = document.getElementById('native-mic-btn');
  const nativeSendBtn = document.getElementById('native-send-btn');
  const nativeCloseBtn = document.getElementById('native-close-btn');
  const reactorDot = document.getElementById('reactor-dot');
  const voiceIndicator = document.getElementById('voice-indicator');

  const activityStrip = document.getElementById('activity-strip');
  const activityLabel = document.getElementById('activity-label');
  const activityToolBadge = document.getElementById('activity-tool-badge');
  const btnAbortTask = document.getElementById('btn-abort-task');

  const idleState = document.getElementById('idle-state');
  const responsePanel = document.getElementById('response-panel');
  const responseBody = document.getElementById('response-body');
  const btnCopyResponse = document.getElementById('btn-copy-response');
  const btnClearResponse = document.getElementById('btn-clear-response');

  const approvalCard = document.getElementById('approval-card');
  const approvalTool = document.getElementById('approval-tool');
  const approvalArgs = document.getElementById('approval-args');
  const approvalRisk = document.getElementById('approval-risk');
  const btnNativeApprove = document.getElementById('btn-native-approve');
  const btnNativeDeny = document.getElementById('btn-native-deny');

  // Auto-focus input
  if (nativeInput) {
    setTimeout(() => nativeInput.focus(), 100);
  }

  // ==========================================
  // Suggestion Pills
  // ==========================================
  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      if (prompt) {
        nativeInput.value = prompt;
        sendPrompt();
      }
    });
  });

  // ==========================================
  // Windows Native Speech Synthesis (TTS Engine)
  // ==========================================
  let ttsEnabled = true;
  let ttsRate = 1.35; // Acelerado para lectura rápida y ágil
  let selectedVoice = null;
  let ttsBuffer = '';
  let isSpeaking = false;

  function initTTS() {
    if (!('speechSynthesis' in window)) {
      if (voiceIndicator) voiceIndicator.textContent = '🔇 Sin TTS';
      return;
    }

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return;

      const esVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('es'));
      const preferred =
        esVoices.find((v) => /alvaro|raul|jorge|pablo|pedro/i.test(v.name)) ||
        esVoices.find((v) => /natural|online/i.test(v.name)) ||
        esVoices[0] ||
        voices[0];

      selectedVoice = preferred;
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
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

  function speakChunk(text) {
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
      isSpeaking = true;
      setReactorState('speaking');
    };

    utterance.onend = () => {
      if (!window.speechSynthesis.speaking) {
        isSpeaking = false;
        if (!isExecuting) setReactorState('idle');
      }
    };

    utterance.onerror = () => {
      isSpeaking = false;
      if (!isExecuting) setReactorState('idle');
    };

    window.speechSynthesis.speak(utterance);
  }

  function feedSpeechToken(token) {
    if (!ttsEnabled) return;
    ttsBuffer += token;

    const match = ttsBuffer.match(/^([\s\S]*?[.!?:\n]+)\s+([\s\S]*)$/);
    if (match) {
      const sentence = match[1].trim();
      ttsBuffer = match[2];
      if (sentence.length > 3) {
        speakChunk(sentence);
      }
    }
  }

  function flushSpeechBuffer() {
    if (!ttsEnabled) return;
    if (ttsBuffer.trim().length > 0) {
      speakChunk(ttsBuffer);
      ttsBuffer = '';
    }
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    ttsBuffer = '';
    isSpeaking = false;
    if (!isExecuting) setReactorState('idle');
  }

  // Reactor state manager
  function setReactorState(state) {
    reactorDot.className = 'reactor-core';
    if (state === 'listening') reactorDot.classList.add('listening');
    else if (state === 'speaking') reactorDot.classList.add('speaking');
    else if (state === 'thinking') reactorDot.classList.add('thinking');
  }

  // Toggle Voice Output & Speeds
  function updateSpeedUI() {
    if (voiceSpeedBadge) voiceSpeedBadge.textContent = `${ttsRate}x`;
    if (voiceIndicator) {
      voiceIndicator.textContent = ttsEnabled ? `🔊 ${ttsRate}x` : '🔇 OFF';
      if (ttsEnabled) voiceIndicator.classList.add('active');
      else voiceIndicator.classList.remove('active');
    }
  }

  if (nativeTtsBtn) {
    nativeTtsBtn.addEventListener('click', () => {
      ttsEnabled = !ttsEnabled;
      if (ttsEnabled) {
        nativeTtsBtn.classList.add('active');
        nativeTtsBtn.classList.remove('muted');
      } else {
        stopSpeech();
        nativeTtsBtn.classList.remove('active');
        nativeTtsBtn.classList.add('muted');
      }
      updateSpeedUI();
    });
  }

  if (voiceIndicator) {
    voiceIndicator.addEventListener('click', () => {
      if (!ttsEnabled) {
        ttsEnabled = true;
        if (nativeTtsBtn) {
          nativeTtsBtn.classList.add('active');
          nativeTtsBtn.classList.remove('muted');
        }
      }
      const speeds = [1.1, 1.25, 1.35, 1.5, 1.7];
      const idx = speeds.indexOf(ttsRate);
      ttsRate = speeds[(idx + 1) % speeds.length];
      updateSpeedUI();
      speakChunk(`Velocidad ${ttsRate}x.`);
    });
  }

  // ==========================================
  // WebSocket Connection
  // ==========================================
  function initWS() {
    const wsUrl = `ws://127.0.0.1:3000/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setReactorState('idle');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data.type, data.payload);
      } catch (err) {
        console.error('WS Parse Error:', err);
      }
    };

    ws.onclose = () => {
      setReactorState('thinking');
      setTimeout(initWS, 2500);
    };
  }

  function handleMessage(type, payload) {
    switch (type) {
      case 'agent_event':
        handleAgentEvent(payload);
        break;
      case 'approval_required':
        showApproval(payload);
        break;
      case 'task_finished':
        finishTask(payload);
        break;
      case 'task_cancelled':
        stopSpeech();
        setActivity(false, 'Tarea cancelada.');
        break;
    }
  }

  function handleAgentEvent(event) {
    switch (event.type) {
      case 'state_change':
        setActivity(true, event.message);
        break;

      case 'token':
        showResponsePanel();
        responseBody.innerHTML += escapeHtml(event.token).replace(/\n/g, '<br>');
        responseBody.scrollTop = responseBody.scrollHeight;
        feedSpeechToken(event.token);
        break;

      case 'tool_call_start':
        activityToolBadge.style.display = 'inline-block';
        activityToolBadge.textContent = event.toolName;
        setActivity(true, `Ejecutando ${event.toolName}...`);
        break;

      case 'task_complete':
        if (!responseBody.innerHTML.trim() && event.response) {
          showResponsePanel();
          responseBody.innerHTML = formatMarkdown(event.response);
          speakChunk(event.response);
        } else {
          flushSpeechBuffer();
        }
        break;
    }
  }

  function showResponsePanel() {
    if (idleState) idleState.style.display = 'none';
    if (responsePanel) responsePanel.style.display = 'flex';
  }

  function setActivity(active, label) {
    if (active) {
      activityStrip.style.display = 'flex';
      activityLabel.textContent = label || 'Procesando...';
      if (!isSpeaking) setReactorState('thinking');
    } else {
      activityStrip.style.display = 'none';
      activityToolBadge.style.display = 'none';
      if (!isSpeaking) setReactorState('idle');
    }
  }

  function finishTask(_result) {
    isExecuting = false;
    flushSpeechBuffer();
    setActivity(false, 'Listo');
  }

  // Send Prompt
  function sendPrompt() {
    const text = nativeInput.value.trim();
    if (!text || isExecuting) return;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('Enlace con el núcleo de JARVIS no disponible.');
      return;
    }

    stopSpeech();
    isExecuting = true;
    responseBody.innerHTML = '';
    showResponsePanel();
    setActivity(true, 'Analizando directiva...');

    ws.send(
      JSON.stringify({
        type: 'chat_message',
        payload: {
          prompt: text,
          sessionId: currentSessionId,
        },
      })
    );

    nativeInput.value = '';
  }

  nativeSendBtn.addEventListener('click', sendPrompt);
  nativeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendPrompt();
    } else if (e.key === 'Escape') {
      stopSpeech();
      if (responsePanel.style.display !== 'none') {
        clearResponse();
      } else if (nativeInput.value) {
        nativeInput.value = '';
      } else if (window.electronAPI) {
        window.electronAPI.hide();
      }
    }
  });

  nativeCloseBtn.addEventListener('click', () => {
    stopSpeech();
    if (window.electronAPI) {
      window.electronAPI.hide();
    }
  });

  btnAbortTask.addEventListener('click', () => {
    stopSpeech();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cancel_task' }));
    }
  });

  function clearResponse() {
    stopSpeech();
    responsePanel.style.display = 'none';
    responseBody.innerHTML = '';
    if (idleState) idleState.style.display = 'flex';
    setActivity(false);
    nativeInput.focus();
  }

  btnClearResponse.addEventListener('click', clearResponse);
  btnCopyResponse.addEventListener('click', () => {
    const text = responseBody.innerText;
    if (text) {
      navigator.clipboard.writeText(text);
      btnCopyResponse.textContent = '¡Copiado!';
      setTimeout(() => {
        btnCopyResponse.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg> Copiar`;
      }, 1500);
    }
  });

  // Approvals
  function showApproval(data) {
    pendingApprovalId = data.approvalId;
    approvalTool.textContent = data.toolName;
    approvalArgs.textContent = JSON.stringify(data.args);
    approvalRisk.textContent = data.riskLevel;
    approvalCard.style.display = 'flex';
    speakChunk(`Se requiere autorización para ${data.toolName}.`);
  }

  btnNativeApprove.addEventListener('click', () => {
    if (!pendingApprovalId) return;
    ws.send(
      JSON.stringify({
        type: 'approval_response',
        payload: { approvalId: pendingApprovalId, approved: true },
      })
    );
    approvalCard.style.display = 'none';
    pendingApprovalId = null;
  });

  btnNativeDeny.addEventListener('click', () => {
    if (!pendingApprovalId) return;
    ws.send(
      JSON.stringify({
        type: 'approval_response',
        payload: { approvalId: pendingApprovalId, approved: false },
      })
    );
    approvalCard.style.display = 'none';
    pendingApprovalId = null;
  });

  // ==========================================
  // Native 16kHz WAV Audio Recording (Speech-to-Text)
  // ==========================================
  let audioCtx = null;
  let micStream = null;
  let processorNode = null;
  let pcmChunks = [];
  let isRecording = false;

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
      let sum = 0,
        count = 0;
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

  nativeMicBtn.addEventListener('click', async () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  async function startRecording() {
    try {
      stopSpeech();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      pcmChunks = [];

      const source = audioCtx.createMediaStreamSource(micStream);
      processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
      processorNode.onaudioprocess = (e) => {
        if (!isRecording) return;
        pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      source.connect(processorNode);
      processorNode.connect(audioCtx.destination);

      isRecording = true;
      nativeMicBtn.classList.add('recording');
      setReactorState('listening');
      nativeInput.placeholder = 'Escuchando...';
    } catch (err) {
      console.error('Mic error:', err);
    }
  }

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    nativeMicBtn.classList.remove('recording');
    setReactorState('idle');
    nativeInput.placeholder = '¿En qué puedo asistirlo, señor?';

    if (processorNode) processorNode.disconnect();
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    const inRate = audioCtx.sampleRate;
    if (audioCtx) await audioCtx.close().catch(() => {});

    setActivity(true, 'Transcribiendo voz...');

    let totalLen = pcmChunks.reduce((acc, c) => acc + c.length, 0);
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
        const res = await fetch('http://127.0.0.1:3000/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: reader.result }),
        });
        const data = await res.json();
        if (data.success && data.text) {
          nativeInput.value = data.text;
          sendPrompt();
        } else {
          setActivity(false, 'No se identificó voz clara.');
        }
      } catch (err) {
        console.error('ASR request error:', err);
        setActivity(false, 'Error en transcripción.');
      }
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // Inicializar
  initWS();
  initTTS();
  updateSpeedUI();
})();
