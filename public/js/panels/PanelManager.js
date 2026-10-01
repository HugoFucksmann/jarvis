/**
 * PanelManager.js — Modular Dashboard State & Layout Engine
 *
 * Manages which cards are open, their grid span (columns), custom sizes,
 * and display order. Multi-panel friendly: opening one never closes others.
 * Completely decoupled from DOM rendering; persists to localStorage.
 */

const STORAGE_KEY = 'jarvis_dashboard_layout_v4';

/** @typedef {'chat'|'system'|'memory'|'security'|'device'} PanelId */

/**
 * @typedef {Object} CardState
 * @property {PanelId} id
 * @property {boolean} open
 * @property {number}  span      - Grid column span: 4 (1/3), 6 (1/2), 8 (2/3), 12 (full)
 * @property {number}  order     - Display sequence index
 * @property {number|null} height - Custom height in pixels (if resized by user)
 */

/** Default initial dashboard layout: Chat + System filling 100% of screen */
const DEFAULT_CARDS = [
  { id: 'chat',     open: true,  span: 8,  order: 0, height: null },
  { id: 'system',   open: true,  span: 4,  order: 1, height: null },
  { id: 'device',   open: false, span: 6,  order: 2, height: null },
  { id: 'memory',   open: false, span: 6,  order: 3, height: null },
  { id: 'security', open: false, span: 6,  order: 4, height: null },
];

export class PanelManager extends EventTarget {
  /** @type {CardState[]} */
  #cards;

  constructor() {
    super();
    this.#cards = this.#load();
  }

  // ── Public Query API ──────────────────────────────────────────────

  /**
   * Returns copy of all cards sorted by order
   * @returns {CardState[]}
   */
  getAll() {
    return [...this.#cards].sort((a, b) => a.order - b.order).map(c => ({ ...c }));
  }

  /**
   * Returns only active (open) cards sorted by order
   * @returns {CardState[]}
   */
  getActiveCards() {
    return this.getAll().filter(c => c.open);
  }

  /**
   * Check if a panel is currently open
   * @param {PanelId} id
   * @returns {boolean}
   */
  isOpen(id) {
    return this.#find(id)?.open ?? false;
  }

  /**
   * Get state for a specific card
   * @param {PanelId} id
   * @returns {CardState|null}
   */
  getCard(id) {
    const card = this.#find(id);
    return card ? { ...card } : null;
  }

  // ── Public Mutation API ───────────────────────────────────────────

  /**
   * Toggle a panel open or closed independently.
   * NEVER closes other open panels.
   * @param {PanelId} id
   */
  toggle(id) {
    const card = this.#find(id);
    if (!card) return;
    card.open = !card.open;
    this.#save();
    this.#emit('change', { id, open: card.open, card: { ...card } });
  }

  /**
   * Explicitly open a panel without affecting others.
   * @param {PanelId} id
   */
  open(id) {
    const card = this.#find(id);
    if (!card || card.open) return;
    card.open = true;
    this.#save();
    this.#emit('change', { id, open: true, card: { ...card } });
  }

  /**
   * Explicitly close a panel.
   * @param {PanelId} id
   */
  close(id) {
    const card = this.#find(id);
    if (!card || !card.open) return;
    card.open = false;
    this.#save();
    this.#emit('change', { id, open: false, card: { ...card } });
  }

  /**
   * Change grid column span (e.g., 4, 6, 8, 12).
   * @param {PanelId} id
   * @param {number} span
   */
  setSpan(id, span) {
    const card = this.#find(id);
    if (!card) return;
    card.span = span;
    this.#save();
    this.#emit('change', { id, span, card: { ...card } });
  }

  /**
   * Set a custom height in pixels when user drags to resize.
   * @param {PanelId} id
   * @param {number} height
   */
  setHeight(id, height) {
    const card = this.#find(id);
    if (!card) return;
    card.height = Math.max(200, Math.round(height));
    this.#save();
    this.#emit('change', { id, height: card.height, card: { ...card } });
  }

  /**
   * Reorder cards by dragging one onto another.
   * @param {PanelId} draggedId
   * @param {PanelId} targetId
   */
  reorder(draggedId, targetId) {
    if (draggedId === targetId) return;
    const sorted = [...this.#cards].sort((a, b) => a.order - b.order);
    const draggedIdx = sorted.findIndex(c => c.id === draggedId);
    const targetIdx  = sorted.findIndex(c => c.id === targetId);

    if (draggedIdx === -1 || targetIdx === -1) return;

    const [moved] = sorted.splice(draggedIdx, 1);
    sorted.splice(targetIdx, 0, moved);

    // Re-index orders
    sorted.forEach((card, idx) => { card.order = idx; });
    this.#cards = sorted;
    this.#save();
    this.#emit('reorder', { cards: this.getAll() });
  }

  /**
   * Apply predefined dashboard layout presets
   * @param {'focus'|'dual'|'dashboard'|'all'} presetName
   */
  applyPreset(presetName) {
    switch (presetName) {
      case 'focus': // Only Chat full width
        this.#cards.forEach(c => {
          c.height = null;
          if (c.id === 'chat') { c.open = true; c.span = 12; c.order = 0; }
          else { c.open = false; }
        });
        break;

      case 'dual': // Chat (8 cols) + System (4 cols)
        this.#cards.forEach(c => {
          c.height = null;
          if (c.id === 'chat')   { c.open = true; c.span = 8; c.order = 0; }
          else if (c.id === 'system') { c.open = true; c.span = 4; c.order = 1; }
          else { c.open = false; }
        });
        break;

      case 'dashboard': // 2x2 Grid (Chat & HW on top, Memory & Sec on bottom)
        this.#cards.forEach(c => {
          c.height = null;
          c.open = true;
          c.span = 6;
        });
        break;

      case 'all': // All 4 panels open with balanced spans
        this.#cards.forEach(c => {
          c.height = null;
          c.open = true;
          c.span = (c.id === 'chat') ? 8 : (c.id === 'system') ? 4 : 6;
        });
        break;
    }
    this.#save();
    this.#emit('preset', { preset: presetName, cards: this.getAll() });
  }

  /** Reset to default layout */
  reset() {
    this.#cards = DEFAULT_CARDS.map(c => ({ ...c }));
    this.#save();
    this.#emit('reset', { cards: this.getAll() });
  }

  // ── Private Persistence ───────────────────────────────────────────

  #find(id) {
    return this.#cards.find(c => c.id === id);
  }

  #load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_CARDS.map(c => ({ ...c }));
      const saved = JSON.parse(raw);
      return DEFAULT_CARDS.map(def => {
        const found = saved.find(s => s.id === def.id);
        return found ? { ...def, ...found } : { ...def };
      });
    } catch {
      return DEFAULT_CARDS.map(c => ({ ...c }));
    }
  }

  #save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#cards));
    } catch { /* storage full or private mode */ }
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
