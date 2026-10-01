/**
 * SystemPanel.js — System / Telemetry Panel Module
 *
 * Fetches hardware info, Ollama status, and tool list from the REST API
 * and renders them into the #panel-system element.
 */
export function createSystemPanel() {
  const root = document.getElementById('panel-system');

  const elOS      = root?.querySelector('#sys-os');
  const elCPU     = root?.querySelector('#sys-cpu');
  const elGPU     = root?.querySelector('#sys-gpu');
  const elRAM     = root?.querySelector('#sys-ram');
  const ramBar    = root?.querySelector('#sys-ram-bar');
  const ollamaEl  = root?.querySelector('#sys-ollama');
  const toolsList = root?.querySelector('#sys-tools-list');
  const toolsCount= root?.querySelector('#sys-tools-count');
  const refreshBtn= root?.querySelector('#btn-refresh-system');

  async function refresh() {
    try {
      const res  = await fetch('/api/status');
      const data = await res.json();

      if (data.hardware) {
        const hw = data.hardware;
        if (elOS)  elOS.textContent  = hw.os  || '—';
        if (elCPU) elCPU.textContent = hw.cpu || '—';
        if (elGPU) elGPU.textContent = hw.gpu || '—';
        if (hw.ram) {
          if (elRAM) elRAM.textContent = `${hw.ram.usedGB} / ${hw.ram.totalGB} GB (${hw.ram.percentage}%)`;
          if (ramBar) ramBar.style.width = `${hw.ram.percentage}%`;
        }
      }

      if (ollamaEl) {
        const available = data.ollama?.available;
        ollamaEl.className = `ollama-status ${available ? 'available' : 'unavailable'}`;
        ollamaEl.innerHTML = available
          ? `<span class="status-dot online"></span> ${data.ollama.model} — Conectado`
          : `<span class="status-dot offline"></span> Ollama no disponible`;
      }

      if (toolsList && data.tools) {
        if (toolsCount) toolsCount.textContent = data.tools.length;
        toolsList.innerHTML = '';
        data.tools.forEach((t) => {
          const row = document.createElement('div');
          row.className = 'tool-row';
          row.innerHTML = `
            <span class="tool-name">${t.name}</span>
            <span class="risk-badge ${t.riskLevel}">${t.riskLevel}</span>
          `;
          toolsList.appendChild(row);
        });
      }
    } catch (err) {
      console.warn('[SystemPanel] Refresh failed:', err);
    }
  }

  function init() {
    refreshBtn?.addEventListener('click', refresh);
    refresh(); // load on open
  }

  return { init, refresh };
}
