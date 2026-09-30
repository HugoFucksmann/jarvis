/**
 * state.js — Shared reactive state for the JARVIS native frontend.
 * All modules read/write through this object, so there is a single
 * source of truth for cross-cutting concerns.
 */

export const state = {
  ws: /** @type {WebSocket|null} */ (null),
  isExecuting: false,
  pendingApprovalId: /** @type {string|null} */ (null),
  rawResponse: '',
  lastPrompt: '',
  taskStart: 0,
  timer: /** @type {number|null} */ (null),
  activityText: '',
  isSpeaking: false,
  isRecording: false,
};

// ── Shared DOM references ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

export const dom = {
  container:       $('jarvis-container'),
  input:           $('native-input'),
  sendBtn:         $('native-send-btn'),
  closeBtn:        $('native-close-btn'),
  reactor:         $('reactor-dot'),
  voiceIndicator:  $('voice-indicator'),
  ttsBtn:          $('native-tts-btn'),
  voiceSpeedBadge: $('voice-speed-badge'),
  micBtn:          $('native-mic-btn'),
  strip:           $('activity-strip'),
  stripLabel:      $('activity-label'),
  toolBadge:       $('activity-tool-badge'),
  abortBtn:        $('btn-abort-task'),
  idleState:       $('idle-state'),
  panel:           $('response-panel'),
  body:            $('response-body'),
  promptEcho:      $('stream-prompt'),
  copyBtn:         $('btn-copy-response'),
  clearBtn:        $('btn-clear-response'),
  footerHint:      $('footer-hint'),
  // Drawers
  btnToggleHistory:  $('btn-toggle-history'),
  btnToggleMemory:   $('btn-toggle-memory'),
  btnToggleSecurity: $('btn-toggle-security'),
  historyDrawer:     $('history-drawer'),
  historyList:       $('history-list'),
  historyCount:      $('history-count'),
  btnCloseHistory:   $('btn-close-history'),
  memoryDrawer:      $('memory-drawer'),
  memoryEditor:      $('memory-editor'),
  btnSaveMemory:     $('btn-save-memory'),
  btnCloseMemory:    $('btn-close-memory'),
  securityDrawer:    $('security-drawer'),
  chkAutoApprove:    $('chk-auto-approve'),
  securityEditor:    $('security-patterns-editor'),
  btnSaveSecurity:   $('btn-save-security'),
  btnCloseSecurity:  $('btn-close-security'),
  // Approval
  approvalCard:  $('approval-card'),
  approvalTool:  $('approval-tool'),
  approvalArgs:  $('approval-args'),
  approvalRisk:  $('approval-risk'),
  approveBtn:    $('btn-native-approve'),
  denyBtn:       $('btn-native-deny'),
};

// Shared server base URLs — change here and it reflects everywhere
export const API_BASE = 'http://127.0.0.1:3000';
export const WS_URL   = 'ws://127.0.0.1:3000/ws';
