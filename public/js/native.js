// JARVIS Native Spotlight Client — UI Adaptativa, Memoria Persistente e Historial
(() => {
  let ws = null;
  const sessionId = 'native_' + Date.now();
  let isExecuting = false;
  let pendingApprovalId = null;
  let rawResponse = '';
  let lastPrompt = '';
  let taskStart = 0;
  let timer = null;
  let activityText = '';

  const $ = (id) => document.getElementById(id);
  const container = $('jarvis-container');
  const input = $('native-input');
  const ttsBtn = $('native-tts-btn');
  const voiceSpeedBadge = $('voice-speed-badge');
  const micBtn = $('native-mic-btn');
  const sendBtn = $('native-send-btn');
  const closeBtn = $('native-close-btn');
  const reactor = $('reactor-dot');
  const voiceIndicator = $('voice-indicator');

  const btnToggleHistory = $('btn-toggle-history');
  const btnToggleMemory = $('btn-toggle-memory');
  const btnToggleSecurity = $('btn-toggle-security');

  const strip = $('activity-strip');
  const stripLabel = $('activity-label');
  const toolBadge = $('activity-tool-badge');
  const abortBtn = $('btn-abort-task');

  const idleState = $('idle-state');
  const panel = $('response-panel');
  const body = $('response-body');
  const promptEcho = $('stream-prompt');
  const copyBtn = $('btn-copy-response');
  const clearBtn = $('btn-clear-response');

  const historyDrawer = $('history-drawer');
  const historyList = $('history-list');
  const historyCount = $('history-count');
  const btnCloseHistory = $('btn-close-history');

  const memoryDrawer = $('memory-drawer');
  const memoryEditor = $('memory-editor');
  const btnSaveMemory = $('btn-save-memory');
  const btnCloseMemory = $('btn-close-memory');

  const securityDrawer = $('security-drawer');
  const chkAutoApprove = $('chk-auto-approve');
  const securityEditor = $('security-patterns-editor');
  const btnSaveSecurity = $('btn-save-security');
  const btnCloseSecurity = $('btn-close-security');

  const approvalCard = $('approval-card');
  const approvalTool = $('approval-tool');
  const approvalArgs = $('approval-args');
  const approvalRisk = $('approval-risk');
  const approveBtn = $('btn-native-approve');
  const denyBtn = $('btn-native-deny');

  const footerHint = $('footer-hint');

  // ==========================================
  // Modos Adaptativos (idle, working, responding, history, memory)
  // ==========================================
  const HINTS = {
    idle: '<span><kbd>Enter</kbd> enviar</span><span><kbd>Ctrl+M</kbd> voz</span><span><kbd>Alt+Espacio</kbd> invocar</span>',
    working: '<span><kbd>Esc</kbd> detener</span><span>Procesando directiva...</span>',
    responding: '<span><kbd>Esc</kbd> limpiar</span><span><kbd>Ctrl+Shift+C</kbd> copiar</span><span><kbd>Alt+Espacio</kbd> ocultar</span>',
    history: '<span><kbd>Esc</kbd> cerrar historial</span><span>Clic en tarea para reutilizar</span>',
    memory: '<span><kbd>Esc</kbd> cerrar memoria</span><span>Edición directa de .jarvis/MEMORY.md</span>',
    security: '<span><kbd>Esc</kbd> cerrar seguridad</span><span>Configuración de comandos y permisos</span>',
    approval: '<span><kbd>Ctrl+Enter</kbd> autorizar</span><span><kbd>Esc</kbd> denegar</span>',
  };

  function setMode(mode) {
    container.dataset.mode = mode;

    // Visibility toggles
    idleState.style.display = mode === 'idle' ? 'flex' : 'none';
    panel.style.display = mode === 'responding' ? 'flex' : 'none';
    historyDrawer.style.display = mode === 'history' ? 'flex' : 'none';
    memoryDrawer.style.display = mode === 'memory' ? 'flex' : 'none';
    if (securityDrawer) securityDrawer.style.display = mode === 'security' ? 'flex' : 'none';

    if (btnToggleHistory) btnToggleHistory.classList.toggle('active', mode === 'history');
    if (btnToggleMemory) btnToggleMemory.classList.toggle('active', mode === 'memory');
    if (btnToggleSecurity) btnToggleSecurity.classList.toggle('active', mode === 'security');

    // Update hints
    if (pendingApprovalId) {
      footerHint.innerHTML = HINTS.approval;
    } else {
      footerHint.innerHTML = HINTS[mode] || HINTS.idle;
    }

    if (mode === 'idle' || mode === 'responding') {
      setTimeout(() => input.focus(), 50);
    }
  }

  // ==========================================
  // Sugerencias Rápidas Iniciales
  // ==========================================
  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-prompt');
      if (p) {
        input.value = p;
        sendPrompt();
      }
    });
  });

  // ==========================================
  // Historial de Tareas Realizadas
  // ==========================================
  async function loadTaskHistory() {
    try {
      const res = await fetch('http://127.0.0.1:3000/api/tasks?limit=40');
      const data = await res.json();
      const tasks = data.tasks || [];

      historyCount.textContent = `${tasks.length} tareas`;
      if (tasks.length === 0) {
        historyList.innerHTML = '<div class="drawer-empty">No hay tareas registradas aún.</div>';
        return;
      }

      historyList.innerHTML = tasks
        .map((t) => {
          const time = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dur = t.durationMs > 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`;
          const tools = (t.toolsUsed || []).map((tl) => `<span class="task-tool-tag">${tl}</span>`).join(' ');
          const statusClass = t.success ? 'ok' : 'fail';
          const statusText = t.success ? 'Completada' : 'Fallo';

          return `
            <div class="task-item" data-prompt="${escapeHtml(t.prompt)}">
              <div class="task-item-top">
                <span class="task-item-prompt" title="${escapeHtml(t.prompt)}">${escapeHtml(t.prompt)}</span>
                <span class="task-item-time">${time}</span>
              </div>
              <div class="task-item-meta">
                <span class="task-status-tag ${statusClass}">${statusText}</span>
                <span>⏱️ ${dur}</span>
                ${tools}
              </div>
            </div>
          `;
        })
        .join('');

      // Click task to run or review
      historyList.querySelectorAll('.task-item').forEach((item) => {
        item.addEventListener('click', () => {
          const prompt = item.getAttribute('data-prompt');
          if (prompt) {
            setMode('idle');
            input.value = prompt;
            sendPrompt();
          }
        });
      });
    } catch (err) {
      historyList.innerHTML = '<div class="drawer-empty">Error al cargar historial.</div>';
    }
  }

  if (btnToggleHistory) {
    btnToggleHistory.addEventListener('click', () => {
      if (container.dataset.mode === 'history') {
        setMode(rawResponse ? 'responding' : 'idle');
      } else {
        setMode('history');
        loadTaskHistory();
      }
    });
  }

  if (btnCloseHistory) {
    btnCloseHistory.addEventListener('click', () => {
      setMode(rawResponse ? 'responding' : 'idle');
    });
  }

  // ==========================================
  // Memoria General Persistente (.jarvis/MEMORY.md)
  // ==========================================
  async function loadGeneralMemory() {
    try {
      memoryEditor.value = 'Cargando memoria...';
      const res = await fetch('http://127.0.0.1:3000/api/memory/raw');
      const data = await res.json();
      memoryEditor.value = data.content || '';
    } catch {
      memoryEditor.value = 'Error al cargar la memoria general.';
    }
  }

  async function saveGeneralMemory() {
    const content = memoryEditor.value;
    try {
      btnSaveMemory.textContent = 'Guardando...';
      await fetch('http://127.0.0.1:3000/api/memory/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      btnSaveMemory.textContent = '¡Guardado!';
      setTimeout(() => {
        btnSaveMemory.textContent = 'Guardar';
      }, 1500);
    } catch {
      btnSaveMemory.textContent = 'Error';
      setTimeout(() => {
        btnSaveMemory.textContent = 'Guardar';
      }, 1500);
    }
  }

  if (btnToggleMemory) {
    btnToggleMemory.addEventListener('click', () => {
      if (container.dataset.mode === 'memory') {
        setMode(rawResponse ? 'responding' : 'idle');
      } else {
        setMode('memory');
        loadGeneralMemory();
      }
    });
  }

  if (btnCloseMemory) {
    btnCloseMemory.addEventListener('click', () => {
      setMode(rawResponse ? 'responding' : 'idle');
    });
  }

  // ==========================================
  // Reglas de Seguridad y Comandos Restringidos (.jarvis/permissions.json)
  // ==========================================
  async function loadSecurityRules() {
    try {
      securityEditor.value = 'Cargando reglas...';
      const res = await fetch('http://127.0.0.1:3000/api/security/permissions');
      const data = await res.json();
      const rules = data.rules || {};
      if (chkAutoApprove) {
        chkAutoApprove.checked = rules.autoApproveSafeCommands !== false;
      }
      const patterns = rules.restrictedCommandPatterns || [];
      securityEditor.value = patterns.join('\n');
    } catch {
      securityEditor.value = 'Error al cargar reglas de seguridad.';
    }
  }

  async function saveSecurityRules() {
    const rawText = securityEditor.value;
    const patterns = rawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const autoApprove = chkAutoApprove ? chkAutoApprove.checked : true;

    try {
      btnSaveSecurity.textContent = 'Guardando...';
      await fetch('http://127.0.0.1:3000/api/security/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoApproveSafeCommands: autoApprove,
          restrictedCommandPatterns: patterns,
        }),
      });
      btnSaveSecurity.textContent = '¡Guardado!';
      setTimeout(() => {
        btnSaveSecurity.textContent = 'Guardar';
      }, 1500);
    } catch {
      btnSaveSecurity.textContent = 'Error';
      setTimeout(() => {
        btnSaveSecurity.textContent = 'Guardar';
      }, 1500);
    }
  }

  if (btnToggleSecurity) {
    btnToggleSecurity.addEventListener('click', () => {
      if (container.dataset.mode === 'security') {
        setMode(rawResponse ? 'responding' : 'idle');
      } else {
        setMode('security');
        loadSecurityRules();
      }
    });
  }

  if (btnCloseSecurity) {
    btnCloseSecurity.addEventListener('click', () => {
      setMode(rawResponse ? 'responding' : 'idle');
    });
  }

  if (btnSaveSecurity) {
    btnSaveSecurity.addEventListener('click', () => {
      saveSecurityRules();
    });
  }

  if (btnSaveMemory) {
    btnSaveMemory.addEventListener('click', saveGeneralMemory);
  }

  // ==========================================
  // Windows Native Speech Synthesis (TTS)
  // ==========================================
  let ttsEnabled = true;
  let ttsRate = 1.35;
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

  function setReactorState(state) {
    reactor.className = 'reactor-core';
    if (state === 'listening') reactor.classList.add('listening');
    else if (state === 'speaking') reactor.classList.add('speaking');
    else if (state === 'thinking') reactor.classList.add('thinking');
  }

  function updateSpeedUI() {
    if (voiceSpeedBadge) voiceSpeedBadge.textContent = `${ttsRate}x`;
    if (voiceIndicator) {
      voiceIndicator.textContent = ttsEnabled ? `🔊 ${ttsRate}x` : '🔇 OFF';
      if (ttsEnabled) voiceIndicator.classList.add('active');
      else voiceIndicator.classList.remove('active');
    }
  }

  if (ttsBtn) {
    ttsBtn.addEventListener('click', () => {
      ttsEnabled = !ttsEnabled;
      if (ttsEnabled) {
        ttsBtn.classList.add('active');
        ttsBtn.classList.remove('muted');
      } else {
        stopSpeech();
        ttsBtn.classList.remove('active');
        ttsBtn.classList.add('muted');
      }
      updateSpeedUI();
    });
  }

  if (voiceIndicator) {
    voiceIndicator.addEventListener('click', () => {
      if (!ttsEnabled) {
        ttsEnabled = true;
        if (ttsBtn) {
          ttsBtn.classList.add('active');
          ttsBtn.classList.remove('muted');
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
    ws = new WebSocket('ws://127.0.0.1:3000/ws');

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
        finishTask();
        break;
      case 'task_cancelled':
        stopSpeech();
        setActivity(false, 'Tarea cancelada.');
        finishTask();
        break;
    }
  }

  function handleAgentEvent(event) {
    switch (event.type) {
      case 'state_change':
        setActivity(true, event.message);
        break;

      case 'token':
        if (container.dataset.mode !== 'responding') {
          setMode('responding');
        }
        rawResponse += event.token;
        body.innerHTML = formatMarkdown(rawResponse);
        body.scrollTop = body.scrollHeight;
        feedSpeechToken(event.token);
        break;

      case 'tool_call_start':
        toolBadge.style.display = 'inline-block';
        toolBadge.textContent = event.toolName;
        setActivity(true, `Ejecutando ${event.toolName}...`);
        if (event.toolName === 'open_url' && event.args && typeof event.args.url === 'string') {
          openExternalUrl(event.args.url);
        }
        break;

      case 'tool_call_result':
        if (event.toolName === 'open_url' && event.result && event.result.success) {
          const targetUrl = (event.result.data && event.result.data.url) || (event.args && event.args.url);
          if (targetUrl) {
            openExternalUrl(targetUrl);
          }
        }
        break;

      case 'task_complete':
        if (!rawResponse.trim() && event.response) {
          rawResponse = event.response;
          setMode('responding');
          body.innerHTML = formatMarkdown(rawResponse);
          speakChunk(rawResponse);
        } else {
          flushSpeechBuffer();
        }
        break;
    }
  }

  function setActivity(active, label) {
    clearInterval(timer);
    if (active) {
      activityText = label || 'Procesando...';
      strip.style.display = 'flex';
      abortBtn.style.display = isExecuting ? 'inline-block' : 'none';

      if (isExecuting) {
        const tick = () => {
          const s = Math.floor((Date.now() - taskStart) / 1000);
          stripLabel.textContent = s >= 2 ? `${activityText} (${s}s)` : activityText;
        };
        tick();
        timer = setInterval(tick, 1000);
      } else {
        stripLabel.textContent = activityText;
      }
      if (!isSpeaking) setReactorState('thinking');
    } else {
      strip.style.display = 'none';
      toolBadge.style.display = 'none';
      if (!isSpeaking) setReactorState('idle');
    }
  }

  function finishTask() {
    isExecuting = false;
    flushSpeechBuffer();
    setActivity(false);
    if (rawResponse) {
      setMode('responding');
    } else {
      setMode('idle');
    }
  }

  // ==========================================
  // Enviar / Limpiar Directivas (Sin repetir información)
  // ==========================================
  function sendPrompt() {
    const text = input.value.trim();
    if (!text || isExecuting) return;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('Enlace con el núcleo de JARVIS no disponible.');
      return;
    }

    stopSpeech();
    isExecuting = true;
    lastPrompt = text;
    rawResponse = '';
    body.innerHTML = '';

    // Prompt Echo no repetitivo
    promptEcho.textContent = `Directiva: ${text}`;
    setMode('responding');

    taskStart = Date.now();
    setActivity(true, 'Analizando directiva...');

    ws.send(
      JSON.stringify({
        type: 'chat_message',
        payload: {
          prompt: text,
          sessionId,
        },
      })
    );

    input.value = '';
  }

  sendBtn.addEventListener('click', sendPrompt);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendPrompt();
    }
  });

  // Hotkey Esc inteligente y adaptativo
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // 1. Si hay panel de historial o memoria abierto, cerrarlo
      if (container.dataset.mode === 'history' || container.dataset.mode === 'memory') {
        setMode(rawResponse ? 'responding' : 'idle');
        return;
      }
      // 2. Si hay autorización abierta, denegar
      if (pendingApprovalId) {
        answerApproval(false);
        return;
      }
      // 3. Si está hablando, callar
      if (isSpeaking) {
        stopSpeech();
        return;
      }
      // 4. Si se está ejecutando tarea, abortar
      if (isExecuting) {
        abortTask();
        return;
      }
      // 5. Si hay respuesta mostrada, limpiarla
      if (container.dataset.mode === 'responding') {
        clearResponse();
        return;
      }
      // 6. Si el input tiene texto, vaciarlo
      if (input.value) {
        input.value = '';
        return;
      }
      // 7. Si está completamente en espera, ocultar ventana
      if (window.electronAPI) {
        window.electronAPI.hide();
      }
    }
  });

  closeBtn.addEventListener('click', () => {
    stopSpeech();
    if (window.electronAPI) {
      window.electronAPI.hide();
    }
  });

  function abortTask() {
    stopSpeech();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cancel_task' }));
    }
  }

  abortBtn.addEventListener('click', abortTask);

  function clearResponse() {
    stopSpeech();
    rawResponse = '';
    body.innerHTML = '';
    promptEcho.textContent = '';
    setActivity(false);
    setMode('idle');
    input.focus();
  }

  clearBtn.addEventListener('click', clearResponse);
  copyBtn.addEventListener('click', () => {
    if (rawResponse) {
      navigator.clipboard.writeText(rawResponse);
      copyBtn.textContent = '¡Copiado!';
      setTimeout(() => {
        copyBtn.innerHTML = `
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
    footerHint.innerHTML = HINTS.approval;
    speakChunk(`Se requiere autorización para ${data.toolName}.`);
  }

  function answerApproval(approved) {
    if (!pendingApprovalId) return;
    ws.send(
      JSON.stringify({
        type: 'approval_response',
        payload: { approvalId: pendingApprovalId, approved },
      })
    );
    approvalCard.style.display = 'none';
    pendingApprovalId = null;
    footerHint.innerHTML = HINTS[container.dataset.mode] || HINTS.idle;
  }

  approveBtn.addEventListener('click', () => answerApproval(true));
  denyBtn.addEventListener('click', () => answerApproval(false));

  // ==========================================
  // Grabación de Voz (16 kHz Mono WAV)
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

  micBtn.addEventListener('click', async () => {
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
      micBtn.classList.add('recording');
      setReactorState('listening');
      input.placeholder = 'Escuchando...';
    } catch (err) {
      console.error('Mic error:', err);
    }
  }

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    micBtn.classList.remove('recording');
    setReactorState('idle');
    input.placeholder = '¿En qué puedo asistirlo, señor?';

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
          input.value = data.text;
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
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function openExternalUrl(url) {
    if (!url) return;
    try {
      let cleanUrl = url.trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'https://' + cleanUrl;
      }
      if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
        window.electronAPI.openExternal(cleanUrl);
      } else {
        window.open(cleanUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('Error abriendo enlace externo:', err);
    }
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Markdown links: [Title](https://...)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" class="hud-link" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bare URLs: https://...
    html = html.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" class="hud-link" target="_blank" rel="noopener noreferrer">$2</a>');
    // Lists
    html = html.replace(/^\s*[-*•]\s+(.*)$/gm, '<li>$1</li>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // Interceptar clicks en links para abrirlos en el navegador nativo
  body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      e.preventDefault();
      openExternalUrl(link.href);
    }
  });

  // Inicializar
  initWS();
  initTTS();
  updateSpeedUI();
  setMode('idle');
})();
