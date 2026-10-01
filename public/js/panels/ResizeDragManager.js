/**
 * ResizeDragManager.js — Interactive Drag & Drop and Resizing Engine
 *
 * Provides:
 * 1. Mouse Drag-to-Resize on each card's bottom-right corner handle.
 * 2. Header Drag-and-Drop to reorder dashboard cards seamlessly.
 * Emits updates back to PanelManager so changes persist.
 */

export class ResizeDragManager {
  /**
   * @param {import('./PanelManager.js').PanelManager} panelManager
   * @param {HTMLElement} workspaceGridEl
   */
  constructor(panelManager, workspaceGridEl) {
    this.panelManager = panelManager;
    this.grid = workspaceGridEl;
    this.draggedPanelId = null;
    this.resizingCard = null;
    this.initialY = 0;
    this.initialHeight = 0;
    this.initialX = 0;
    this.initialWidth = 0;
  }

  /**
   * Attach resize and drag listeners to all rendered cards in the grid.
   * Called whenever the dashboard grid re-renders.
   */
  attachHandlers() {
    const cards = this.grid.querySelectorAll('.dashboard-card');
    cards.forEach(card => {
      this.#setupDragReorder(card);
      this.#setupResizeHandle(card);
      this.#setupSpanButtons(card);
    });
  }

  // ── 1. Drag & Drop Reordering ─────────────────────────────────────

  #setupDragReorder(cardEl) {
    const headerLeft = cardEl.querySelector('.card-header-left');
    const panelId = cardEl.dataset.panelId;
    if (!headerLeft || !panelId) return;

    // Make the header draggable
    headerLeft.setAttribute('draggable', 'true');

    headerLeft.addEventListener('dragstart', (e) => {
      this.draggedPanelId = panelId;
      cardEl.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', panelId);
    });

    headerLeft.addEventListener('dragend', () => {
      cardEl.classList.remove('is-dragging');
      this.draggedPanelId = null;
      // Remove any lingering hover classes
      this.grid.querySelectorAll('.dashboard-card').forEach(c => c.classList.remove('drag-over'));
    });

    cardEl.addEventListener('dragover', (e) => {
      if (!this.draggedPanelId || this.draggedPanelId === panelId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardEl.classList.add('drag-over');
    });

    cardEl.addEventListener('dragleave', () => {
      cardEl.classList.remove('drag-over');
    });

    cardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      cardEl.classList.remove('drag-over');
      if (this.draggedPanelId && this.draggedPanelId !== panelId) {
        this.panelManager.reorder(this.draggedPanelId, panelId);
      }
    });
  }

  // ── 2. Interactive Mouse Drag-to-Resize ────────────────────────────

  #setupResizeHandle(cardEl) {
    const handle = cardEl.querySelector('.card-resize-handle');
    const panelId = cardEl.dataset.panelId;
    if (!handle || !panelId) return;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      this.resizingCard = cardEl;
      this.initialY = e.clientY;
      this.initialX = e.clientX;
      this.initialHeight = cardEl.offsetHeight;
      this.initialWidth = cardEl.offsetWidth;

      handle.classList.add('is-resizing');
      cardEl.classList.add('is-focused');
      document.body.style.cursor = 'se-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvent) => {
        if (!this.resizingCard) return;
        const deltaY = moveEvent.clientY - this.initialY;
        const newHeight = Math.max(320, this.initialHeight + deltaY);
        this.resizingCard.style.height = `${newHeight}px`;

        // Interactive width threshold detection for column spans
        const deltaX = moveEvent.clientX - this.initialX;
        const gridWidth = this.grid.clientWidth;
        const newWidth = this.initialWidth + deltaX;
        const widthRatio = newWidth / gridWidth;

        // Auto-adapt span preview if stretched horizontally
        if (widthRatio > 0.8) {
          this.#updateCardSpanClass(this.resizingCard, 12);
        } else if (widthRatio > 0.5) {
          this.#updateCardSpanClass(this.resizingCard, 8);
        } else if (widthRatio > 0.35) {
          this.#updateCardSpanClass(this.resizingCard, 6);
        } else {
          this.#updateCardSpanClass(this.resizingCard, 4);
        }
      };

      const onMouseUp = () => {
        if (!this.resizingCard) return;
        handle.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        const finalHeight = this.resizingCard.offsetHeight;
        this.panelManager.setHeight(panelId, finalHeight);

        // Detect current applied span
        const currentSpan = this.#getCardSpan(this.resizingCard);
        this.panelManager.setSpan(panelId, currentSpan);

        this.resizingCard = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── 3. Quick Span Selector Buttons (1x, 2x, Full) ─────────────────

  #setupSpanButtons(cardEl) {
    const panelId = cardEl.dataset.panelId;
    if (!panelId) return;

    cardEl.querySelectorAll('.card-btn[data-span]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const span = parseInt(btn.dataset.span, 10);
        if (span) {
          this.panelManager.setSpan(panelId, span);
        }
      });
    });

    // Close button
    const closeBtn = cardEl.querySelector('.card-btn-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panelManager.close(panelId);
    });
  }

  #updateCardSpanClass(cardEl, span) {
    cardEl.classList.remove('span-4', 'span-6', 'span-8', 'span-12');
    cardEl.classList.add(`span-${span}`);
    // Update active state on span buttons in card header
    cardEl.querySelectorAll('.card-btn[data-span]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.span, 10) === span);
    });
  }

  #getCardSpan(cardEl) {
    if (cardEl.classList.contains('span-12')) return 12;
    if (cardEl.classList.contains('span-8')) return 8;
    if (cardEl.classList.contains('span-6')) return 6;
    return 4;
  }
}
