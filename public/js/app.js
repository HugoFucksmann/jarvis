// JARVIS HUD Client Script
(() => {
  let ws = null;
  let currentSessionId = 'session_' + Date.now();
  let isExecuting = false;
  let activeAssistantCard = null;
  let activeContentElem = null;
  let activeToolCards = new Map();
  let pendingApprovalId = null;

  // DOM Elements
  const statusIndicator = document.getElementById('status-text');
  const activityTracker = document.getElementById('activity-tracker');
  const activitySpinner = document.getElementById('activity-spinner');
  const activityState = document.getElementById('activity-state');
  const activityDetails = document.getElementById('activity-details');
  const trackerActions = document.getElementById('tracker-actions');
  const messagesContainer = document.getElementById('messages-container');
  const userInput = document.getElementById('user-input');
  const btnSend = document.getElementById('btn-send');
  const btnCancelTask = document.getElementById('btn-cancel-task');
  const modelSelector = document.getElementById('model-selector');
  const voiceDeviceSelector = document.getElementById('voice-device-selector');
  const btnVoiceRecord = document.getElementById('btn-voice-record');
  const micText = document.getElementById('mic-text');
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  // Sidebar elements
  const hudSidebar = document.getElementById('hud-sidebar');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar');
  const btnToggleTelemetry = document.getElementById('btn-toggle-telemetry');
  const btnToggleAudit = document.getElementById('btn-toggle-audit');
  const btnToggleMemory = document.getElementById('btn-toggle-memory');
  const sidebarTitle = document.getElementById('sidebar-title');
  const tabTelemetry = document.getElementById('tab-telemetry');
  const tabAudit = document.getElementById('tab-audit');
  const tabMemory = document.getElementById('tab-memory');

  // Modal elements
  const approvalModal = document.getElementById('approval-modal');
  const modalToolName = document.getElementById('modal-tool-name');
  const modalRiskBadge = document.getElementById('modal-risk-badge');
  const modalReason = document.getElementById('modal-reason');
  const modalArgs = document.getElementById('modal-args');
  const btnApproveAction = document.getElementById('btn-approve-action');
  const btnDenyAction = document.getElementById('btn-deny-action');

  // Initialize WebSocket Connection
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    statusIndicator.textContent = 'CONNECTING...';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      statusIndicator.textContent = 'SYSTEM ONLINE';
      console.log('[JARVIS] Core link established.');
      fetchSystemStatus();
      fetchModels();
      fetchVoiceStatus();
      populateMicDevices();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data.type, data.payload);
      } catch (err) {
        console.error('[JARVIS] Error parsing message:', err);
      }
    };

    ws.onclose = () => {
      statusIndicator.textContent = 'LINK SEVERED';
      console.warn('[JARVIS] Link lost. Retrying in 3s...');
      setTimeout(initWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error('[JARVIS] WebSocket error:', err);
    };
  }

  // Handle Incoming Server Messages
  function handleServerMessage(type, payload) {
    switch (type) {
      case 'agent_event':
        handleAgentEvent(payload);
        break;
      case 'approval_required':
        showApprovalModal(payload);
        break;
      case 'task_finished':
        finishTask(payload);
        break;
      case 'task_cancelled':
        setAgentState('CANCELADO', 'La tarea fue interrumpida.', false);
        isExecuting = false;
        trackerActions.style.display = 'none';
        break;
      case 'error':
        appendErrorMessage(payload.message || 'Error desconocido.');
        setAgentState('ERROR', payload.message, false);
        isExecuting = false;
        trackerActions.style.display = 'none';
        break;
    }
  }

  // Handle Granular Agent Events
  function handleAgentEvent(event) {
    switch (event.type) {
      case 'state_change':
        setAgentState(event.state, event.message, true);
        break;

      case 'token':
        if (!activeAssistantCard) {
          createAssistantMessageCard();
        }
        activeContentElem.textContent += event.token;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        break;

      case 'tool_call_start':
        renderToolCallStart(event);
        break;

      case 'tool_call_result':
        renderToolCallResult(event);
        break;

      case 'thinking_summary':
        activityDetails.textContent = event.summary;
        break;

      case 'task_complete':
        if (activeContentElem && !activeContentElem.textContent) {
          activeContentElem.textContent = event.response;
        }
        break;
    }
  }

  // Activity Status Indicator
  function setAgentState(state, message, isRunning) {
    activityState.textContent = state;
    activityDetails.textContent = message || '';
    if (isRunning) {
      activitySpinner.classList.add('active');
      trackerActions.style.display = 'block';
    } else {
      activitySpinner.classList.remove('active');
      trackerActions.style.display = 'none';
    }
  }

  // Chat Cards Creation
  function appendUserMessage(text) {
    const card = document.createElement('div');
    card.className = 'message-card user';
    card.innerHTML = `
      <div class="message-meta">
        <span class="author-tag">CREADOR</span>
        <span class="time-tag">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-content">
        <p>${escapeHtml(text)}</p>
      </div>
    `;
    messagesContainer.appendChild(card);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function createAssistantMessageCard() {
    activeAssistantCard = document.createElement('div');
    activeAssistantCard.className = 'message-card assistant';
    activeAssistantCard.innerHTML = `
      <div class="message-meta">
        <span class="author-tag">J.A.R.V.I.S.</span>
        <span class="time-tag">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-content"></div>
    `;
    activeContentElem = activeAssistantCard.querySelector('.message-content');
    messagesContainer.appendChild(activeAssistantCard);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function appendErrorMessage(text) {
    const card = document.createElement('div');
    card.className = 'message-card assistant';
    card.style.borderColor = 'var(--color-red)';
    card.innerHTML = `
      <div class="message-meta">
        <span class="author-tag" style="color:var(--color-red)">ALERTA DE SISTEMA</span>
        <span class="time-tag">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-content" style="color:var(--color-red)">
        <p>${escapeHtml(text)}</p>
      </div>
    `;
    messagesContainer.appendChild(card);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Render Tool Invocations in Live Stream
  function renderToolCallStart(event) {
    if (!activeAssistantCard) {
      createAssistantMessageCard();
    }

    const toolCard = document.createElement('div');
    toolCard.className = 'tool-execution-card';
    toolCard.id = `tool-call-${event.callId}`;
    toolCard.innerHTML = `
      <div class="tool-header-bar">
        <span class="tool-name-tag">⚡ ${event.toolName}</span>
        <span class="risk-badge ${event.riskLevel}">${event.riskLevel}</span>
      </div>
      <div class="tool-body-details">
        <div><strong>Entrada:</strong> <code style="color:var(--text-muted)">${escapeHtml(JSON.stringify(event.args))}</code></div>
        <div class="tool-result-status" style="color:var(--color-amber)">⚙ Ejecutando...</div>
      </div>
    `;

    activeContentElem.appendChild(toolCard);
    activeToolCards.set(event.callId, toolCard);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function renderToolCallResult(event) {
    const card = activeToolCards.get(event.callId);
    if (!card) return;

    const statusElem = card.querySelector('.tool-result-status');
    if (event.result.success) {
      statusElem.className = 'tool-result-status success';
      statusElem.textContent = '✓ Concluido con éxito';
      const detailView = document.createElement('div');
      detailView.style.marginTop = '4px';
      detailView.style.maxHeight = '140px';
      detailView.style.overflowY = 'auto';
      detailView.innerHTML = `<pre style="font-size:0.72rem;background:#000;padding:6px;border-radius:3px;">${escapeHtml(JSON.stringify(event.result.data, null, 2))}</pre>`;
      card.querySelector('.tool-body-details').appendChild(detailView);
    } else {
      statusElem.className = 'tool-result-status error';
      statusElem.textContent = `✗ Fallo: ${event.result.error || 'Error'}`;
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function finishTask(result) {
    isExecuting = false;
    setAgentState('LISTO', `Completado en ${(result.durationMs / 1000).toFixed(1)}s`, false);
    trackerActions.style.display = 'none';
    activeAssistantCard = null;
    activeContentElem = null;
    activeToolCards.clear();
    fetchAuditLogs();
  }

  // Interactive Authorization Modal (Stark Security Protocol)
  function showApprovalModal(data) {
    pendingApprovalId = data.approvalId;
    modalToolName.textContent = data.toolName;
    modalRiskBadge.textContent = data.riskLevel;
    modalRiskBadge.className = `badge risk-badge ${data.riskLevel}`;
    modalReason.textContent = data.reason || 'Acción potencialmente riesgosa.';
    modalArgs.textContent = JSON.stringify(data.args, null, 2);
    approvalModal.style.display = 'flex';
  }

  function hideApprovalModal() {
    approvalModal.style.display = 'none';
    pendingApprovalId = null;
  }

  btnApproveAction.addEventListener('click', () => {
    if (!pendingApprovalId) return;
    ws.send(JSON.stringify({
      type: 'approval_response',
      payload: { approvalId: pendingApprovalId, approved: true }
    }));
    hideApprovalModal();
  });

  btnDenyAction.addEventListener('click', () => {
    if (!pendingApprovalId) return;
    ws.send(JSON.stringify({
      type: 'approval_response',
      payload: { approvalId: pendingApprovalId, approved: false }
    }));
    hideApprovalModal();
  });

  // Cancel Current Task
  btnCancelTask?.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cancel_task' }));
    }
  });

  // Send Prompt Execution
  function sendPrompt() {
    const text = userInput.value.trim();
    if (!text || isExecuting) return;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendErrorMessage('No hay conexión con el núcleo de JARVIS.');
      return;
    }

    isExecuting = true;
    appendUserMessage(text);
    userInput.value = '';
    userInput.style.height = 'auto';

    createAssistantMessageCard();
    setAgentState('INICIANDO', 'Procesando directiva...', true);

    ws.send(JSON.stringify({
      type: 'chat_message',
      payload: {
        prompt: text,
        sessionId: currentSessionId,
      }
    }));
  }

  btnSend.addEventListener('click', sendPrompt);
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  // REST API calls for Telemetry & Models
  async function fetchSystemStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      if (data.hardware) {
        document.getElementById('sys-os').textContent = data.hardware.os || 'Windows 11';
        document.getElementById('sys-cpu').textContent = data.hardware.cpu || 'Intel Core i7';
        document.getElementById('sys-gpu').textContent = data.hardware.gpu || 'NVIDIA GeForce RTX 3070 Ti';
        if (data.hardware.ram) {
          document.getElementById('sys-ram').textContent = `${data.hardware.ram.usedGB} / ${data.hardware.ram.totalGB} GB (${data.hardware.ram.percentage}%)`;
          const ramProgress = document.getElementById('ram-progress');
          if (ramProgress) ramProgress.style.width = `${data.hardware.ram.percentage}%`;
        }
      }
      document.getElementById('tools-count-badge').textContent = data.toolsCount;

      const toolsList = document.getElementById('tools-list');
      toolsList.innerHTML = '';
      data.tools.forEach((t) => {
        const chip = document.createElement('div');
        chip.className = 'tool-chip';
        chip.innerHTML = `
          <span>${t.name}</span>
          <span class="risk-badge ${t.riskLevel}">${t.riskLevel}</span>
        `;
        toolsList.appendChild(chip);
      });
    } catch (err) {
      console.error('[JARVIS] Failed to fetch system status:', err);
    }
  }

  async function fetchModels() {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();

      modelSelector.innerHTML = '';
      data.models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = `${m.name} (${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB)`;
        if (m.name === data.current) {
          opt.selected = true;
        }
        modelSelector.appendChild(opt);
      });
    } catch (err) {
      console.error('[JARVIS] Failed to fetch models:', err);
    }
  }

  modelSelector.addEventListener('change', async (e) => {
    const newModel = e.target.value;
    try {
      await fetch('/api/models/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      });
      console.log(`[JARVIS] Model switched to: ${newModel}`);
    } catch (err) {
      console.error('[JARVIS] Failed to switch model:', err);
    }
  });

  async function fetchAuditLogs() {
    try {
      const res = await fetch('/api/audit');
      const data = await res.json();
      const stream = document.getElementById('audit-stream');
      stream.innerHTML = '';

      data.logs.slice(-15).reverse().forEach((log) => {
        const item = document.createElement('div');
        item.style.fontSize = '0.75rem';
        item.style.padding = '8px 0';
        item.style.borderBottom = '1px solid rgba(0,240,255,0.1)';
        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;">
            <strong style="color:var(--color-cyan)">${log.toolName}</strong>
            <span class="risk-badge ${log.riskLevel}">${log.riskLevel}</span>
          </div>
          <div style="color:var(--text-muted);font-size:0.7rem;">${new Date(log.timestamp).toLocaleTimeString()} - ${log.approvalMode}</div>
          <div style="color:${log.success ? 'var(--color-green)' : 'var(--color-red)'}">${log.success ? 'Ejecutado con éxito' : log.error || 'Denegado'}</div>
        `;
        stream.appendChild(item);
      });
    } catch (err) {
      console.error('[JARVIS] Failed to fetch audit:', err);
    }
  }

  async function fetchMemory() {
    try {
      const res = await fetch('/api/memory');
      const data = await res.json();
      const list = document.getElementById('facts-list');
      list.innerHTML = '';

      data.facts.forEach((fact) => {
        const row = document.createElement('div');
        row.style.padding = '6px 0';
        row.style.borderBottom = '1px solid rgba(0,240,255,0.1)';
        row.style.fontSize = '0.78rem';
        row.innerHTML = `
          <div><strong style="color:var(--color-cyan)">[${fact.category.toUpperCase()}]</strong> ${escapeHtml(fact.content)}</div>
          <div style="font-size:0.68rem;color:var(--text-muted)">${new Date(fact.createdAt).toLocaleDateString()}</div>
        `;
        list.appendChild(row);
      });
    } catch (err) {
      console.error('[JARVIS] Failed to fetch memory:', err);
    }
  }

  document.getElementById('btn-add-memory')?.addEventListener('click', async () => {
    const input = document.getElementById('memory-input');
    const cat = document.getElementById('memory-category').value;
    const content = input.value.trim();
    if (!content) return;

    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: cat, content }),
    });
    input.value = '';
    fetchMemory();
  });

  // Sidebar Controls
  function switchTab(tabId, title) {
    hudSidebar.classList.remove('collapsed');
    sidebarTitle.textContent = title;
    [tabTelemetry, tabAudit, tabMemory].forEach((t) => t.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');

    if (tabId === 'tab-audit') fetchAuditLogs();
    if (tabId === 'tab-memory') fetchMemory();
    if (tabId === 'tab-telemetry') fetchSystemStatus();
  }

  btnToggleTelemetry.addEventListener('click', () => switchTab('tab-telemetry', 'TELEMETRÍA'));
  btnToggleAudit.addEventListener('click', () => switchTab('tab-audit', 'SEGURIDAD Y AUDITORÍA'));
  btnToggleMemory.addEventListener('click', () => switchTab('tab-memory', 'MEMORIA PERMANENTE'));
  btnCloseSidebar.addEventListener('click', () => hudSidebar.classList.add('collapsed'));

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Auto-expand textarea
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
  });

  // Voice Engine & Device Selection (Ollama frozenlab/qwen3-asr:0.6b)
  async function fetchVoiceStatus() {
    try {
      const res = await fetch('/api/voice/status');
      const data = await res.json();
      if (voiceDeviceSelector && data.device) {
        voiceDeviceSelector.value = data.device;
      }
      console.log(`[JARVIS] Voice Model: ${data.model} on [${data.device.toUpperCase()}]`);
    } catch (err) {
      console.error('[JARVIS] Failed to fetch voice status:', err);
    }
  }

  voiceDeviceSelector?.addEventListener('change', async (e) => {
    const selectedDevice = e.target.value;
    try {
      const res = await fetch('/api/voice/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: selectedDevice }),
      });
      const data = await res.json();
      if (data.success) {
        setAgentState(
          'VOZ RECONFIGURADA',
          `Modelo de voz qwen3-asr asignado a: ${selectedDevice.toUpperCase()}${selectedDevice === 'cpu' ? ' (0 VRAM - Máxima estabilidad)' : ' (GPU RTX 3070 Ti)'}`,
          false
        );
      }
    } catch (err) {
      console.error('[JARVIS] Failed to update voice compute device:', err);
    }
  });

  // Microphone Device Enumeration & Selection
  const micDeviceSelector = document.getElementById('mic-device-selector');

  async function populateMicDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let audioInputs = devices.filter((d) => d.kind === 'audioinput');

      // If labels are empty, request quick permission to get real device names
      if (audioInputs.length > 0 && !audioInputs[0].label) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach((t) => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
          audioInputs = devices.filter((d) => d.kind === 'audioinput');
        } catch {
          // User might deny permission
        }
      }

      if (micDeviceSelector && audioInputs.length > 0) {
        micDeviceSelector.innerHTML = '';
        const savedMic = localStorage.getItem('jarvis_selected_mic') || '';

        audioInputs.forEach((mic, idx) => {
          const opt = document.createElement('option');
          opt.value = mic.deviceId;
          opt.textContent = mic.label || `Micrófono ${idx + 1}`;
          if (mic.deviceId === savedMic) {
            opt.selected = true;
          }
          micDeviceSelector.appendChild(opt);
        });

        micDeviceSelector.addEventListener('change', () => {
          localStorage.setItem('jarvis_selected_mic', micDeviceSelector.value);
          console.log(`[JARVIS] Selected microphone: ${micDeviceSelector.selectedOptions[0]?.textContent}`);
        });
      }
    } catch (err) {
      console.error('[JARVIS] Error listing audio devices:', err);
    }
  }

  // Pure 16kHz Mono WAV Recorder using Web Audio API
  let audioCtx = null;
  let micStream = null;
  let processorNode = null;
  let pcmChunks = [];
  let recordingInputSampleRate = 48000;

  function downsampleBuffer(buffer, inRate, outRate = 16000) {
    if (inRate === outRate) return buffer;
    const ratio = inRate / outRate;
    const newLen = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLen);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, 1, true);  // 1 channel (Mono)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * 1 * 16 / 8)
    view.setUint16(32, 2, true);  // block align
    view.setUint16(34, 16, true); // 16 bits per sample
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  btnVoiceRecord?.addEventListener('click', async () => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  });

  async function startVoiceRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      appendErrorMessage('Tu navegador no soporta captura de micrófono.');
      return;
    }

    const selectedDeviceId = micDeviceSelector?.value || localStorage.getItem('jarvis_selected_mic') || '';
    const audioConstraints = selectedDeviceId
      ? { deviceId: { exact: selectedDeviceId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true };

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      recordingInputSampleRate = audioCtx.sampleRate;
      pcmChunks = [];

      const sourceNode = audioCtx.createMediaStreamSource(micStream);
      // Buffer size 4096, 1 input channel, 1 output channel
      processorNode = audioCtx.createScriptProcessor(4096, 1, 1);

      processorNode.onaudioprocess = (e) => {
        if (!isRecording) return;
        const channelData = e.inputBuffer.getChannelData(0);
        pcmChunks.push(new Float32Array(channelData));
      };

      sourceNode.connect(processorNode);
      processorNode.connect(audioCtx.destination);

      isRecording = true;
      btnVoiceRecord.classList.add('recording');
      micText.textContent = 'GRABANDO...';
      setAgentState('ESCUCHANDO', 'Habla ahora, señor. Presiona el botón para transcribir y enviar...', true);
    } catch (err) {
      console.error('[JARVIS] Microphone access error:', err);
      appendErrorMessage('No se pudo acceder al micrófono seleccionado.');
    }
  }

  async function stopVoiceRecording() {
    if (!isRecording) return;
    isRecording = false;

    btnVoiceRecord?.classList.remove('recording');
    if (micText) micText.textContent = 'VOZ';

    if (processorNode) {
      processorNode.disconnect();
      processorNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (audioCtx) {
      await audioCtx.close().catch(() => {});
      audioCtx = null;
    }

    setAgentState('TRANSCRIBIENDO', `Procesando audio WAV con qwen3-asr en [${voiceDeviceSelector.value.toUpperCase()}]...`, true);

    // Merge PCM buffers
    let totalLength = 0;
    for (const chunk of pcmChunks) {
      totalLength += chunk.length;
    }

    if (totalLength === 0) {
      setAgentState('VOZ VACÍA', 'No se capturó audio en la grabación.', false);
      return;
    }

    const mergedPCM = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of pcmChunks) {
      mergedPCM.set(chunk, offset);
      offset += chunk.length;
    }

    // Trim silence before downsampling to drastically speed up ASR processing
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

    const trimmedPCM = trimSilence(mergedPCM);

    // Downsample to 16kHz mono as required by frozenlab/qwen3-asr
    const downsampled = downsampleBuffer(trimmedPCM, recordingInputSampleRate, 16000);
    const wavBlob = encodeWAV(downsampled, 16000);

    // Convert to base64
    const reader = new FileReader();
    reader.readAsDataURL(wavBlob);
    reader.onloadend = async () => {
      const base64Data = reader.result;
      try {
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64Data }),
        });
        const data = await res.json();
        if (data.success && data.text && data.text.trim()) {
          userInput.value = data.text.trim();
          userInput.dispatchEvent(new Event('input'));
          setAgentState('VOZ CAPTURADA', `Transcripción: "${data.text.trim()}"`, false);
          // Auto-send prompt to JARVIS
          sendPrompt();
        } else {
          setAgentState('VOZ NO DETECTADA', 'El modelo no identificó palabras claras en la grabación.', false);
        }
      } catch (err) {
        console.error('[JARVIS] Error transcribing audio:', err);
        appendErrorMessage('Error en el servicio de transcripción de voz local.');
        setAgentState('ERROR VOZ', String(err), false);
      }
    };
  }

  // Thinking / Turbo Mode Selection
  const thinkingModeSelector = document.getElementById('thinking-mode-selector');

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (thinkingModeSelector) {
        thinkingModeSelector.value = data.thinking ? 'thinking' : 'turbo';
      }
    } catch (err) {
      console.error('[JARVIS] Failed to fetch settings:', err);
    }
  }

  thinkingModeSelector?.addEventListener('change', async (e) => {
    const isThinking = e.target.value === 'thinking';
    try {
      await fetch('/api/settings/thinking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thinking: isThinking }),
      });
      setAgentState(
        isThinking ? 'MODO REASONING' : 'MODO TURBO',
        isThinking ? 'Razonamiento profundo activado (mayor análisis).' : 'Modo Turbo activado (velocidad extrema < 1s).',
        false
      );
    } catch (err) {
      console.error('[JARVIS] Failed to update thinking mode:', err);
    }
  });

  // Start System
  initWebSocket();
  fetchSettings();
})();
