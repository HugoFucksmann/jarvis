/**
 * security.js — Security Rules & Restricted Commands Drawer (.jarvis/permissions.json).
 *               Controls command auto-approval toggle and protected command patterns.
 */
import { state, dom, API_BASE } from './state.js';
import { setMode } from './ui.js';

export async function loadSecurityRules() {
  if (!dom.securityEditor) return;
  try {
    dom.securityEditor.value = 'Cargando reglas...';
    const res = await fetch(`${API_BASE}/api/security/permissions`);
    const data = await res.json();
    const rules = data.rules || {};
    if (dom.chkAutoApprove) {
      dom.chkAutoApprove.checked = rules.autoApproveSafeCommands !== false;
    }
    const patterns = rules.restrictedCommandPatterns || [];
    dom.securityEditor.value = patterns.join('\n');
  } catch (err) {
    console.error('Error cargando reglas de seguridad:', err);
    dom.securityEditor.value = 'Error al cargar reglas de seguridad.';
  }
}

export async function saveSecurityRules() {
  if (!dom.securityEditor || !dom.btnSaveSecurity) return;
  const rawText = dom.securityEditor.value;
  const patterns = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const autoApprove = dom.chkAutoApprove ? dom.chkAutoApprove.checked : true;

  try {
    dom.btnSaveSecurity.textContent = 'Guardando...';
    await fetch(`${API_BASE}/api/security/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoApproveSafeCommands: autoApprove,
        restrictedCommandPatterns: patterns,
      }),
    });
    dom.btnSaveSecurity.textContent = '¡Guardado!';
    setTimeout(() => {
      dom.btnSaveSecurity.textContent = 'Guardar';
    }, 1500);
  } catch (err) {
    console.error('Error guardando reglas de seguridad:', err);
    dom.btnSaveSecurity.textContent = 'Error';
    setTimeout(() => {
      dom.btnSaveSecurity.textContent = 'Guardar';
    }, 1500);
  }
}

export function bindSecurityEvents() {
  if (dom.btnToggleSecurity) {
    dom.btnToggleSecurity.addEventListener('click', () => {
      if (dom.container.dataset.mode === 'security') {
        setMode(state.rawResponse ? 'responding' : 'idle');
      } else {
        setMode('security');
        loadSecurityRules();
      }
    });
  }

  if (dom.btnCloseSecurity) {
    dom.btnCloseSecurity.addEventListener('click', () => {
      setMode(state.rawResponse ? 'responding' : 'idle');
    });
  }

  if (dom.btnSaveSecurity) {
    dom.btnSaveSecurity.addEventListener('click', saveSecurityRules);
  }
}
