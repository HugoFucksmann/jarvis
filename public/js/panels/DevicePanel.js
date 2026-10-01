/**
 * DevicePanel.js — Device & PC Controls Panel Module
 *
 * Tracks live hardware modifications made by JARVIS tools (volume, clipboard,
 * apps, system actions) and provides direct UI controls to trigger or revert them.
 */

export function createDevicePanel() {
  const root = document.getElementById('panel-device');

  // DOM elements
  const audioStatusEl    = root?.querySelector('#device-audio-status');
  const btnToggleMute    = root?.querySelector('#btn-device-mute');
  const btnVolUp         = root?.querySelector('#btn-device-vol-up');
  const btnVolDown       = root?.querySelector('#btn-device-vol-down');
  const clipboardTextEl  = root?.querySelector('#device-clipboard-text');
  const btnClipClear     = root?.querySelector('#btn-device-clip-clear');
  const feedListEl       = root?.querySelector('#device-feed-list');
  const btnClearFeed     = root?.querySelector('#btn-device-clear-feed');

  // Internal state
  let isMuted = false;
  let clipboardPreview = '';
  let clipboardPollInterval = null;
  /** @type {Array<{id: string, time: string, title: string, desc: string, revertTool?: string, revertArgs?: any, revertLabel?: string}>} */
  const actionHistory = [];

  function now() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
  }

  // ── Execute Tool via backend API ──────────────────────────────────────────
  async function executeTool(toolName, args = {}) {
    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args }),
      });
      const data = await res.json();
      if (!data.success) {
        console.warn(`[DevicePanel] Action ${toolName} failed:`, data.error);
      }
      return data;
    } catch (err) {
      console.warn(`[DevicePanel] Error executing ${toolName}:`, err);
      return { success: false, error: String(err) };
    }
  }

  // ── Update Audio Widget ───────────────────────────────────────────────────
  function setAudioMuteState(muted) {
    isMuted = muted;
    if (audioStatusEl) {
      audioStatusEl.className = `device-card-status ${muted ? 'muted' : 'active'}`;
      audioStatusEl.textContent = muted ? '🔇 Silenciado' : '🔊 Activo';
    }
    if (btnToggleMute) {
      btnToggleMute.textContent = muted ? 'Desmutear' : 'Silenciar';
    }
  }

  // ── Render Live Action Feed ───────────────────────────────────────────────
  function renderFeed() {
    if (!feedListEl) return;
    feedListEl.innerHTML = '';

    if (actionHistory.length === 0) {
      feedListEl.innerHTML = '<div class="device-feed-empty">Sin modificaciones recientes en la PC.</div>';
      return;
    }

    actionHistory.slice(0, 15).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'device-action-item';

      let revertHtml = '';
      if (item.revertTool) {
        revertHtml = `<button class="device-action-revert" data-id="${item.id}">${escapeHtml(item.revertLabel || 'Revertir')}</button>`;
      }

      row.innerHTML = `
        <div class="device-action-info">
          <div class="device-action-title">
            <span>${escapeHtml(item.title)}</span>
          </div>
          <div class="device-action-meta">${escapeHtml(item.desc)} • ${item.time}</div>
        </div>
        ${revertHtml}
      `;
      feedListEl.appendChild(row);
    });

    // Bind revert buttons
    feedListEl.querySelectorAll('.device-action-revert').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const item = actionHistory.find((x) => x.id === id);
        if (item && item.revertTool) {
          executeTool(item.revertTool, item.revertArgs);
          btn.textContent = '✓ Aplicado';
          btn.disabled = true;
        }
      });
    });
  }

  // ── Add Item to Action Feed ───────────────────────────────────────────────
  function addFeedItem(title, desc, revertTool = null, revertArgs = null, revertLabel = null) {
    const id = 'act_' + Math.random().toString(36).substring(2, 8);
    actionHistory.unshift({
      id,
      time: now(),
      title,
      desc,
      revertTool,
      revertArgs,
      revertLabel,
    });
    renderFeed();
  }

  // ── Agent Event Listener (from WebSocket) ─────────────────────────────────
  function handleAgentEvent(event) {
    if (!event) return;

    // Detect tool execution starts or results
    if (event.type === 'tool_call_start' || event.type === 'tool_call_result') {
      const toolName = event.toolName;
      const args     = event.args || {};

      if (toolName === 'control_volume') {
        const action = args.action;
        if (action === 'mute') {
          setAudioMuteState(true);
          addFeedItem('Audio: Silenciado', 'JARVIS silenció el sonido maestro', 'control_volume', { action: 'unmute' }, 'Desmutear');
        } else if (action === 'unmute') {
          setAudioMuteState(false);
          addFeedItem('Audio: Activado', 'JARVIS activó el sonido maestro', 'control_volume', { action: 'mute' }, 'Silenciar');
        } else if (action === 'up' || action === 'down') {
          const steps = args.steps || 5;
          const label = action === 'up' ? `Volumen subido (+${steps * 2}%)` : `Volumen bajado (-${steps * 2}%)`;
          const revertAction = action === 'up' ? 'down' : 'up';
          addFeedItem(label, `Acción de audio por JARVIS`, 'control_volume', { action: revertAction, steps }, 'Revertir');
        }
      } else if (toolName === 'manage_clipboard') {
        const action = args.action;
        if (action === 'set' && args.text) {
          clipboardPreview = args.text.length > 50 ? args.text.substring(0, 48) + '...' : args.text;
          if (clipboardTextEl) clipboardTextEl.textContent = clipboardPreview;
          addFeedItem('Portapapeles modificado', `Texto: "${clipboardPreview}"`, 'manage_clipboard', { action: 'clear' }, 'Vaciar');
        } else if (action === 'clear') {
          clipboardPreview = '(vacío)';
          if (clipboardTextEl) clipboardTextEl.textContent = clipboardPreview;
          addFeedItem('Portapapeles vaciado', 'JARVIS limpió el portapapeles');
        } else if (action === 'get') {
          // If tool_call_result has the content, show it directly
          const resultContent = event.result?.data?.content;
          if (resultContent && !resultContent.includes('(El portapapeles está vacío')) {
            const preview = resultContent.length > 120 ? resultContent.substring(0, 118) + '…' : resultContent;
            clipboardPreview = resultContent;
            if (clipboardTextEl) clipboardTextEl.textContent = preview;
            addFeedItem('Portapapeles leído', `"${resultContent.length > 60 ? resultContent.substring(0, 58) + '...' : resultContent}"`);
          } else {
            addFeedItem('Portapapeles leído', 'JARVIS leyó el contenido copiado');
          }
        }
      } else if (toolName === 'send_notification') {
        const title = args.title || 'J.A.R.V.I.S.';
        const msg = args.message || '';
        addFeedItem(`Notificación enviada: ${title}`, msg);
      } else if (toolName === 'launch_app') {
        addFeedItem(`Aplicación iniciada`, `App: ${args.appName || args.path || 'Desconocida'}`);
      } else if (toolName === 'window_control') {
        addFeedItem(`Control de Ventana: ${args.action || 'Focus'}`, `Ventana: ${args.windowTitle || 'Activa'}`);
      } else if (toolName.includes('system') || toolName.includes('terminal')) {
        // Generic fallback for any other system action
        addFeedItem(`Sistema: ${toolName}`, JSON.stringify(args));
      }
    }
  }

  // ── Read Clipboard from OS via backend ───────────────────────────────────
  async function readClipboard(silent = false) {
    if (clipboardTextEl && !silent) {
      clipboardTextEl.textContent = 'Leyendo...';
    }
    try {
      const data = await executeTool('manage_clipboard', { action: 'get' });
      const content = data?.result?.data?.content || '';
      const isEmpty = !content || content.includes('(El portapapeles está vacío');
      clipboardPreview = isEmpty ? '(vacío)' : content;
      const display = isEmpty ? '(vacío)' :
        content.length > 120 ? content.substring(0, 118) + '…' : content;
      if (clipboardTextEl) clipboardTextEl.textContent = display;
    } catch {
      if (clipboardTextEl && !silent) {
        clipboardTextEl.textContent = '(error al leer)';
      }
    }
  }

  // ── Bind UI Events ────────────────────────────────────────────────────────
  function init() {
    // Mute toggle button
    btnToggleMute?.addEventListener('click', async () => {
      const nextMute = !isMuted;
      setAudioMuteState(nextMute);
      await executeTool('control_volume', { action: nextMute ? 'mute' : 'unmute' });
      addFeedItem(nextMute ? 'Audio Silenciado' : 'Audio Activado', 'Modificado manualmente desde la UI');
    });

    // Volume Up (+10%)
    btnVolUp?.addEventListener('click', async () => {
      await executeTool('control_volume', { action: 'up', steps: 5 });
      addFeedItem('Volumen +10%', 'Ajustado manualmente desde la UI');
    });

    // Volume Down (-10%)
    btnVolDown?.addEventListener('click', async () => {
      await executeTool('control_volume', { action: 'down', steps: 5 });
      addFeedItem('Volumen -10%', 'Ajustado manualmente desde la UI');
    });

    // Clear clipboard button
    btnClipClear?.addEventListener('click', async () => {
      await executeTool('manage_clipboard', { action: 'clear' });
      clipboardPreview = '(vacío)';
      if (clipboardTextEl) clipboardTextEl.textContent = '(vacío)';
      addFeedItem('Portapapeles vaciado', 'Limpiado manualmente');
    });

    // Clear feed button
    btnClearFeed?.addEventListener('click', () => {
      actionHistory.length = 0;
      renderFeed();
    });

    // ── Clipboard: initial read + polling ────────────────────────────────
    // Show a "Leer" button in the clipboard card header
    const clipCard = root?.querySelector('#device-clipboard-text')?.closest('.device-card');
    if (clipCard) {
      const headerEl = clipCard.querySelector('.device-card-header');
      if (headerEl && !headerEl.querySelector('#btn-device-clip-read')) {
        const readBtn = document.createElement('button');
        readBtn.id = 'btn-device-clip-read';
        readBtn.className = 'btn btn-ghost';
        readBtn.style.cssText = 'font-size:9.5px;padding:1px 5px;';
        readBtn.textContent = 'Leer';
        readBtn.title = 'Leer portapapeles actual';
        readBtn.addEventListener('click', () => readClipboard(false));
        headerEl.appendChild(readBtn);
      }
    }

    // Initial read from OS
    readClipboard(false);

    // Poll every 8s while panel is in the DOM (IntersectionObserver to avoid waste)
    if (root && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            if (!clipboardPollInterval) {
              clipboardPollInterval = setInterval(() => readClipboard(true), 8000);
            }
          } else {
            if (clipboardPollInterval) {
              clearInterval(clipboardPollInterval);
              clipboardPollInterval = null;
            }
          }
        });
      }, { threshold: 0.1 });
      observer.observe(root);
    }

    renderFeed();
  }

  return {
    init,
    handleAgentEvent,
    refresh: renderFeed,
  };
}
