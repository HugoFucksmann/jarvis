/**
 * MemoryPanel.js — Memory Panel Module
 *
 * Manages the persistent facts list: load, add, and delete facts
 * via the /api/memory REST endpoint.
 */
export function createMemoryPanel() {
  const root       = document.getElementById('panel-memory');
  const factsList  = root?.querySelector('#facts-list');
  const input      = root?.querySelector('#memory-input');
  const catSelect  = root?.querySelector('#memory-category');
  const addBtn     = root?.querySelector('#btn-add-memory');
  const refreshBtn = root?.querySelector('#btn-refresh-memory');

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
  }

  async function loadFacts() {
    if (!factsList) return;
    try {
      const res  = await fetch('/api/memory');
      const data = await res.json();
      factsList.innerHTML = '';

      if (!data.facts?.length) {
        factsList.innerHTML = '<p class="facts-empty">Sin memoria almacenada aún.</p>';
        return;
      }

      data.facts.forEach((fact) => {
        const item = document.createElement('div');
        item.className = 'fact-item';
        item.dataset.id = fact.id;
        item.innerHTML = `
          <div class="fact-body">
            <div class="fact-content">${escapeHtml(fact.content)}</div>
            <div class="fact-meta">
              <span class="tag-badge">${escapeHtml(fact.category)}</span>
              <span class="fact-date">${new Date(fact.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <button class="fact-delete-btn" title="Eliminar" data-id="${fact.id}">✕</button>
        `;
        factsList.appendChild(item);
      });

      // Bind delete buttons
      factsList.querySelectorAll('.fact-delete-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteFact(btn.dataset.id));
      });
    } catch (err) {
      console.warn('[MemoryPanel] Load failed:', err);
    }
  }

  async function addFact() {
    const content = input?.value.trim();
    const category = catSelect?.value || 'preference';
    if (!content) return;
    try {
      await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, category }),
      });
      if (input) input.value = '';
      await loadFacts();
    } catch (err) {
      console.warn('[MemoryPanel] Add failed:', err);
    }
  }

  async function deleteFact(id) {
    if (!id) return;
    try {
      await fetch(`/api/memory/${id}`, { method: 'DELETE' });
      await loadFacts();
    } catch (err) {
      console.warn('[MemoryPanel] Delete failed:', err);
    }
  }

  const searchInput= root?.querySelector('#memory-search');

  function filterFacts() {
    const query = searchInput?.value.trim().toLowerCase() || '';
    const items = factsList?.querySelectorAll('.fact-item') || [];
    let visibleCount = 0;

    items.forEach((item) => {
      const text = item.textContent.toLowerCase();
      const match = text.includes(query);
      item.style.display = match ? 'flex' : 'none';
      if (match) visibleCount++;
    });

    const emptyMsg = factsList?.querySelector('.facts-empty');
    if (emptyMsg) {
      emptyMsg.style.display = (items.length === 0 || (visibleCount === 0 && query)) ? 'block' : 'none';
      if (visibleCount === 0 && query) {
        emptyMsg.textContent = 'No se encontraron recuerdos con esa búsqueda.';
      } else if (items.length === 0) {
        emptyMsg.textContent = 'Sin memoria almacenada aún.';
      }
    }
  }

  function init() {
    addBtn?.addEventListener('click', addFact);
    refreshBtn?.addEventListener('click', loadFacts);
    searchInput?.addEventListener('input', filterFacts);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addFact(); }
    });
    loadFacts();
  }

  return { init, refresh: loadFacts };
}
