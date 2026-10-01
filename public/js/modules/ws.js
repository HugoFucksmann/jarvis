/**
 * ws.js — WebSocket client connection & message routing.
 *         Coordinates streaming tokens, tool indicators, approvals, and task cancellation.
 */
import { state, dom, WS_URL } from './state.js';
import { setMode, setActivity, setReactorState, openExternalUrl } from './ui.js';
import { formatMarkdown } from './markdown.js';
import { feedSpeechToken, flushSpeechBuffer, speakChunk, stopSpeech } from './tts.js';
import { showApproval } from './approvals.js';
import { handleSubagentWsEvent } from './subagents.js';

export function initWS(sessionId) {
  state.ws = new WebSocket(WS_URL);

  state.ws.onopen = () => {
    setReactorState('idle');
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data.type, data.payload);
    } catch (err) {
      console.error('WS Parse Error:', err);
    }
  };

  state.ws.onclose = () => {
    setReactorState('thinking');
    setTimeout(() => initWS(sessionId), 2500);
  };
}

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

export function handleAgentEvent(event) {
  switch (event.type) {
    case 'state_change':
      setActivity(true, event.message);
      break;

    case 'token':
      if (dom.container.dataset.mode !== 'responding') {
        setMode('responding');
      }
      state.rawResponse += event.token;
      if (dom.body) {
        dom.body.innerHTML = formatMarkdown(state.rawResponse);
        dom.body.scrollTop = dom.body.scrollHeight;
      }
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
      // Tool execution completed on backend, UI is notified via state_change
      break;

    case 'task_complete':
      if (!state.rawResponse.trim() && event.response) {
        state.rawResponse = event.response;
        setMode('responding');
        if (dom.body) dom.body.innerHTML = formatMarkdown(state.rawResponse);
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
  setActivity(false);
  if (state.rawResponse) {
    setMode('responding');
  } else {
    setMode('idle');
  }
}

export function abortTask() {
  stopSpeech();
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'cancel_task' }));
  }
}

export function sendPrompt(sessionId) {
  if (!dom.input) return;
  const text = dom.input.value.trim();
  if (!text || state.isExecuting) return;

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    alert('Enlace con el núcleo de JARVIS no disponible.');
    return;
  }

  stopSpeech();
  state.isExecuting = true;
  state.lastPrompt = text;
  state.rawResponse = '';
  if (dom.body) dom.body.innerHTML = '';

  if (dom.promptEcho) {
    dom.promptEcho.textContent = `Directiva: ${text}`;
  }
  setMode('responding');

  state.taskStart = Date.now();
  setActivity(true, 'Analizando directiva...');

  state.ws.send(
    JSON.stringify({
      type: 'chat_message',
      payload: {
        prompt: text,
        sessionId,
      },
    })
  );

  dom.input.value = '';
}

export function clearResponse() {
  stopSpeech();
  state.rawResponse = '';
  if (dom.body) dom.body.innerHTML = '';
  if (dom.promptEcho) dom.promptEcho.textContent = '';
  setActivity(false);
  setMode('idle');
  if (dom.input) dom.input.focus();
}
