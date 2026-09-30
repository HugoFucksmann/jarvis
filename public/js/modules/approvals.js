/**
 * approvals.js — Security Approval Overlay Modal.
 *                Handles tool authorization requests from backend PermissionManager.
 */
import { state, dom } from './state.js';
import { speakChunk } from './tts.js';

const HINTS = {
  idle:      '<span><kbd>Enter</kbd> enviar</span><span><kbd>Ctrl+M</kbd> voz</span><span><kbd>Alt+Espacio</kbd> invocar</span>',
  working:   '<span><kbd>Esc</kbd> detener</span><span>Procesando directiva...</span>',
  responding:'<span><kbd>Esc</kbd> limpiar</span><span><kbd>Ctrl+Shift+C</kbd> copiar</span><span><kbd>Alt+Espacio</kbd> ocultar</span>',
  history:   '<span><kbd>Esc</kbd> cerrar historial</span><span>Clic en tarea para reutilizar</span>',
  memory:    '<span><kbd>Esc</kbd> cerrar memoria</span><span>Edición directa de .jarvis/MEMORY.md</span>',
  security:  '<span><kbd>Esc</kbd> cerrar seguridad</span><span>Configuración de comandos y permisos</span>',
  approval:  '<span><kbd>Ctrl+Enter</kbd> autorizar</span><span><kbd>Esc</kbd> denegar</span>',
};

export function showApproval(data) {
  state.pendingApprovalId = data.approvalId;
  if (dom.approvalTool) dom.approvalTool.textContent = data.toolName;
  if (dom.approvalArgs) dom.approvalArgs.textContent = JSON.stringify(data.args, null, 2);
  if (dom.approvalRisk) dom.approvalRisk.textContent = data.riskLevel;
  if (dom.approvalCard) dom.approvalCard.style.display = 'flex';
  if (dom.footerHint) dom.footerHint.innerHTML = HINTS.approval;
  speakChunk(`Se requiere autorización para ${data.toolName}.`);
}

export function answerApproval(approved) {
  if (!state.pendingApprovalId) return;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(
      JSON.stringify({
        type: 'approval_response',
        payload: { approvalId: state.pendingApprovalId, approved },
      })
    );
  }
  if (dom.approvalCard) dom.approvalCard.style.display = 'none';
  state.pendingApprovalId = null;
  const currentMode = dom.container.dataset.mode || 'idle';
  if (dom.footerHint) dom.footerHint.innerHTML = HINTS[currentMode] || HINTS.idle;
}

export function bindApprovalEvents() {
  if (dom.approveBtn) {
    dom.approveBtn.addEventListener('click', () => answerApproval(true));
  }
  if (dom.denyBtn) {
    dom.denyBtn.addEventListener('click', () => answerApproval(false));
  }
}
