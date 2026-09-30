/**
 * memory.js — Persistent Memory Drawer (.jarvis/MEMORY.md).
 *             Direct reading and editing of agent core notes.
 */
import { state, dom, API_BASE } from './state.js';
import { setMode } from './ui.js';

export async function loadGeneralMemory() {
  if (!dom.memoryEditor) return;
  try {
    dom.memoryEditor.value = 'Cargando memoria...';
    const res = await fetch(`${API_BASE}/api/memory/raw`);
    const data = await res.json();
    dom.memoryEditor.value = data.content || '';
  } catch (err) {
    console.error('Error cargando memoria:', err);
    dom.memoryEditor.value = 'Error al cargar la memoria general.';
  }
}

export async function saveGeneralMemory() {
  if (!dom.memoryEditor || !dom.btnSaveMemory) return;
  const content = dom.memoryEditor.value;
  try {
    dom.btnSaveMemory.textContent = 'Guardando...';
    await fetch(`${API_BASE}/api/memory/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    dom.btnSaveMemory.textContent = '¡Guardado!';
    setTimeout(() => {
      dom.btnSaveMemory.textContent = 'Guardar';
    }, 1500);
  } catch (err) {
    console.error('Error guardando memoria:', err);
    dom.btnSaveMemory.textContent = 'Error';
    setTimeout(() => {
      dom.btnSaveMemory.textContent = 'Guardar';
    }, 1500);
  }
}

export function bindMemoryEvents() {
  if (dom.btnToggleMemory) {
    dom.btnToggleMemory.addEventListener('click', () => {
      if (dom.container.dataset.mode === 'memory') {
        setMode(state.rawResponse ? 'responding' : 'idle');
      } else {
        setMode('memory');
        loadGeneralMemory();
      }
    });
  }

  if (dom.btnCloseMemory) {
    dom.btnCloseMemory.addEventListener('click', () => {
      setMode(state.rawResponse ? 'responding' : 'idle');
    });
  }

  if (dom.btnSaveMemory) {
    dom.btnSaveMemory.addEventListener('click', saveGeneralMemory);
  }
}
