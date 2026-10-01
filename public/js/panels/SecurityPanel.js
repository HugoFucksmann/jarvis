/**
 * SecurityPanel.js — Security & Audit Panel Module
 *
 * Loads the authorization audit log from /api/audit and renders
 * timestamped entries with risk level and result.
 */
export function createSecurityPanel() {
  const root       = document.getElementById('panel-security');
  const auditList  = root?.querySelector('#audit-list');
  const refreshBtn = root?.querySelector('#btn-refresh-audit');

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
  }

  async function loadAudit() {
    if (!auditList) return;
    try {
      const res  = await fetch('/api/audit');
      const data = await res.json();
      auditList.innerHTML = '';

      const logs = (data.logs || []).slice(-20).reverse();
      if (!logs.length) {
        auditList.innerHTML = '<p class="audit-empty">Sin registros de auditoría aún.</p>';
        return;
      }

      logs.forEach((log) => {
        const entry = document.createElement('div');
        entry.className = 'audit-entry';
        const resultClass = log.success ? 'success' : (log.approved === false ? 'denied' : 'error');
        const resultText  = log.success ? 'Ejecutado' : (log.approved === false ? 'Denegado' : log.error || 'Error');

        entry.innerHTML = `
          <div class="audit-entry-header">
            <span class="audit-tool-name">${escapeHtml(log.toolName)}</span>
            <div class="audit-meta">
              <span class="risk-badge ${log.riskLevel}">${log.riskLevel}</span>
              <span>${new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <span class="audit-result ${resultClass}">${escapeHtml(resultText)}</span>
        `;
        auditList.appendChild(entry);
      });
    } catch (err) {
      console.warn('[SecurityPanel] Load failed:', err);
    }
  }

  function init() {
    refreshBtn?.addEventListener('click', loadAudit);
    loadAudit();
  }

  return { init, refresh: loadAudit };
}
