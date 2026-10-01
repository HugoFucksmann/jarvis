/**
 * ws.js — WebSocket client connection & message routing.
 *         Coordinates streaming tokens, tool indicators, approvals, and task cancellation.
 */
import { state, dom, WS_URL } from './state.js';
import { setMode, setActivity, setReactorState, settleMode, showNotice, hideNotice } from './ui.js';
import { formatMarkdown } from './markdown.js';
import { feedSpeechToken, flushSpeechBuffer, speakChunk, stopSpeech } from './tts.js';
import { showApproval } from './approvals.js';
import { handleSubagentWsEvent } from './subagents.js';

let reconnectTimer = null;
let retryCount = 0;
let ignoreTokens = false; // true tras "Limpiar" durante una tarea en curso
let renderQueued = false;

// ── Render de la respuesta (1 render por frame, no 1 por token) ──────────────
function renderResponse() {
  renderQueued = false;
  if (!dom.body) return;
  const scroller = dom.content;
  // Solo seguimos el final si el usuario ya estaba abajo (no pelear con su scroll)
  const stick = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  dom.body.innerHTML = formatMarkdown(state.rawResponse);
  if (stick && scroller) scroller.scrollTop = scroller.scrollHeight;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    if (renderQueued) renderResponse();
  });
}

function flushRender() {
  renderQueued = false;
  renderResponse();
}

// ── Conexión ─────────────────────────────────────────────────────────────────
function scheduleReconnect(sessionId) {
  clearTimeout(reconnectTimer);
  const delay = Math.min(2500 * Math.pow(1.5, retryCount), 15000);
  retryCount += 1;
  reconnectTimer = setTimeout(() => initWS(sessionId), delay);
}

function handleDisconnect() {
  state.isConnected = false;

  // La aprobación pendiente se pierde con el socket
  if (state.pendingApprovalId) {
    state.pendingApprovalId = null;
    if (dom.approvalCard) dom.approvalCard.style.display = 'none';
  }

  if (state.isExecuting) {
    // Sin esto la UI quedaba bloqueada para siempre (isExecuting = true)
    state.isExecuting = false;
    stopSpeech();
    flushRender();
    setActivity(false);
    settleMode();
  } else {
    setReactorState('idle'); // se muestra como "offline"
  }
  showNotice('Sin conexión con el núcleo de JARVIS. Reintentando…', 0);
}

export function initWS(sessionId) {
  clearTimeout(reconnectTimer);
  if (
    state.ws &&
    (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  let ws;
  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    console.error('WS init error:', err);
    handleDisconnect();
    scheduleReconnect(sessionId);
    return;
  }
  state.ws = ws;

  ws.onopen = () => {
    if (state.ws !== ws) return;
    retryCount = 0;
    state.isConnected = true;
    hideNotice();
    if (!state.isExecuting) setReactorState('idle');
  };

  ws.onmessage = (event) => {
    if (state.ws !== ws) return;
    try {
      const data = JSON.parse(event.data);
      handleMessage(data.type, data.payload);
    } catch (err) {
      console.error('WS message error:', err);
    }
  };

  ws.onerror = () => {
    // onclose se dispara a continuación y gestiona la reconexión
  };

  ws.onclose = () => {
    if (state.ws !== ws) return;
    handleDisconnect();
    scheduleReconnect(sessionId);
  };
}

// ── Mensajes ─────────────────────────────────────────────────────────────────
export function handleMessage(type, payload) {
  switch (type) {
    case 'agent_event':
      handleAgentEvent(payload);
      break;
    case 'approval_required':
      showApproval(payload);
      break;
    case 'subagent_event':
      handleSubagentWsEvent(payload);
      break;
    case 'task_finished': {
      const hadText = !!state.rawResponse.trim();
      finishTask();
      if (!hadText && !ignoreTokens) showNotice('Tarea completada sin respuesta de texto.', 3500);
      break;
    }
    case 'task_cancelled':
      stopSpeech();
      finishTask();
      showNotice('Tarea cancelada.', 2500);
      break;
  }
}

export function handleAgentEvent(event) {
  switch (event.type) {
    case 'state_change':
      setActivity(true, event.message);
      break;

    case 'token':
      if (ignoreTokens) break;
      // Solo pasamos a "responding" desde idle: no arrancamos al usuario de un drawer/menú
      if (dom.container.dataset.mode === 'idle') setMode('responding');
      state.rawResponse += event.token;
      scheduleRender();
      feedSpeechToken(event.token);
      break;

    case 'tool_call_start':
      if (dom.toolBadge) {
        dom.toolBadge.style.display = 'inline-block';
        dom.toolBadge.textContent = event.toolName;
      }
      setActivity(true, `Ejecutando ${event.toolName}...`);
      break;

    case 'tool_call_result':
      // La UI se entera del progreso mediante state_change
      break;

    case 'task_complete':
      if (ignoreTokens) break;
      if (!state.rawResponse.trim() && event.response) {
        state.rawResponse = event.response;
        if (dom.container.dataset.mode === 'idle') setMode('responding');
        flushRender();
        speakChunk(state.rawResponse);
      } else {
        flushSpeechBuffer();
      }
      break;
  }
}

export function finishTask() {
  state.isExecuting = false;
  flushSpeechBuffer();
  flushRender();
  setActivity(false);
  settleMode();
}

export function abortTask() {
  stopSpeech();
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'cancel_task' }));
    // Feedback inmediato: evita doble clic y deja claro que se está cancelando
    state.activityText = 'Deteniendo...';
    if (dom.stripLabel) dom.stripLabel.textContent = state.activityText;
    if (dom.abortBtn) dom.abortBtn.disabled = true;
  }
}

/** @returns {boolean} true si la directiva se envió. */
export function sendPrompt(sessionId) {
  if (!dom.input) return false;
  const text = dom.input.value.trim();
  if (!text) return false;

  if (state.isExecuting) {
    showNotice('JARVIS sigue procesando. Espera o pulsa Esc para detener la tarea.', 3500);
    return false;
  }

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    showNotice('Sin conexión con el núcleo de JARVIS. Tu mensaje se conserva; reintentando…', 4000);
    return false;
  }

  try {
    state.ws.send(JSON.stringify({ type: 'chat_message', payload: { prompt: text, sessionId } }));
  } catch (err) {
    console.error('WS send error:', err);
    showNotice('No se pudo enviar la directiva. Inténtalo de nuevo.', 4000);
    return false;
  }

  // Solo mutamos la UI cuando el envío tuvo éxito
  stopSpeech();
  ignoreTokens = false;
  state.isExecuting = true;
  state.lastPrompt = text;
  state.rawResponse = '';
  state.taskStart = Date.now();
  if (dom.body) dom.body.innerHTML = '';
  if (dom.content) dom.content.scrollTop = 0;
  if (dom.abortBtn) dom.abortBtn.disabled = false;
  if (dom.promptEcho) dom.promptEcho.textContent = `Directiva: ${text}`;

  setMode('responding');
  setActivity(true, 'Analizando directiva...');

  dom.input.value = '';
  return true;
}

export function clearResponse() {
  stopSpeech();
  if (state.isExecuting) {
    // Evita que los tokens restantes vuelvan a poblar un panel ya limpiado
    ignoreTokens = true;
    abortTask();
  }
  renderQueued = false;
  state.rawResponse = '';
  if (dom.body) dom.body.innerHTML = '';
  if (dom.promptEcho) dom.promptEcho.textContent = '';
  if (!state.isExecuting) setActivity(false);
  setMode('idle');
  if (dom.input) dom.input.focus();
}