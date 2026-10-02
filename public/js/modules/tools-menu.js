/**
 * tools-menu.js — Menú de módulos tipo "paleta de comandos".
 *
 *  - Reposo: módulos fijados (data-pinned="true") + botón "Ver todos".
 *  - "Ver todos": despliega el resto. La altura de la lista está limitada por CSS
 *    (.tools-list max-height) y, pasado ese punto, hace scroll interno.
 *  - Búsqueda: filtra TODOS los módulos por título y palabras clave.
 *  - Teclado: ↑/↓ navegan, Enter abre el primer resultado, Esc limpia la búsqueda
 *    (un segundo Esc cierra el menú, lo gestiona native.js).
 *
 * Los botones conservan sus ids originales: los demás módulos siguen enlazándose igual.
 * Para añadir un módulo basta con agregar un <button data-module ...> en #tools-list.
 */
import { dom } from './state.js';

const normalize = (text) =>
    String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

export function initToolsMenu() {
    const tray = dom.toolsTray;
    const search = document.getElementById('tools-search');
    if (!tray || !search) return;

    const list = document.getElementById('tools-list');
    const more = document.getElementById('tools-more');
    const moreLabel = document.getElementById('tools-more-label');
    const empty = document.getElementById('tools-empty');

    const items = [...tray.querySelectorAll('[data-module]')].map((el) => ({
        el,
        pinned: el.dataset.pinned === 'true',
        haystack: normalize(`${el.querySelector('.tool-tile-title')?.textContent || ''} ${el.dataset.keywords || ''}`),
    }));
    const hiddenCount = items.filter((i) => !i.pinned).length;

    let expanded = false; // se conserva entre aperturas del menú

    /** Elementos navegables con flechas: filas visibles + "Ver todos". */
    function navElements() {
        const rows = items.filter((i) => !i.el.hidden).map((i) => i.el);
        return more && !more.hidden ? [...rows, more] : rows;
    }

    function apply(query) {
        const tokens = normalize(query).split(/\s+/).filter(Boolean);
        const searching = tokens.length > 0;
        let matches = 0;

        for (const item of items) {
            const match = searching ? tokens.every((t) => item.haystack.includes(t)) : item.pinned || expanded;
            item.el.hidden = !match;
            if (match) matches++;
        }

        if (list) list.hidden = matches === 0;

        if (more) {
            more.hidden = searching || hiddenCount === 0;
            more.setAttribute('aria-expanded', String(expanded));
            if (moreLabel) moreLabel.textContent = expanded ? 'Ver menos' : `Ver todos (${items.length})`;
        }

        if (empty) {
            const none = searching && matches === 0;
            empty.hidden = !none;
            empty.textContent = none ? `Ningún módulo coincide con «${query.trim()}».` : '';
        }
    }

    function reset() {
        search.value = '';
        apply('');
        if (list) list.scrollTop = 0;
    }

    more?.addEventListener('click', () => {
        expanded = !expanded;
        apply('');
        if (list) list.scrollTop = 0;
    });

    search.addEventListener('input', () => apply(search.value));

    search.addEventListener('keydown', (e) => {
        if (e.isComposing) return;

        if (e.key === 'Escape' && search.value) {
            e.preventDefault();
            e.stopPropagation(); // el primer Esc solo limpia la búsqueda
            reset();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            navElements()[0]?.focus();
        } else if (e.key === 'Enter' && search.value.trim()) {
            e.preventDefault();
            items.find((i) => !i.el.hidden)?.el.click();
        }
    });

    tray.addEventListener('keydown', (e) => {
        if (e.target === search || e.isComposing) return;

        const all = navElements();
        const index = all.indexOf(document.activeElement);
        if (index === -1) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            all[Math.min(index + 1, all.length - 1)].focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (index === 0) search.focus();
            else all[index - 1].focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            all[0].focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            all[all.length - 1].focus();
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
            search.focus(); // escribir con el foco en una fila pasa directo al buscador
        }
    });

    // aria-pressed siempre sincronizado con la clase .active que gestionan tts.js / wakeword.js
    tray.querySelectorAll('[data-toggle]').forEach((btn) => {
        const sync = () => btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
        new MutationObserver(sync).observe(btn, { attributes: true, attributeFilter: ['class'] });
        sync();
    });

    // Al entrar al menú: búsqueda limpia y foco en el buscador
    document.addEventListener('jarvis:modechange', (e) => {
        if (e.detail?.mode !== 'tools') return;
        reset();
        requestAnimationFrame(() => {
            if (dom.container.dataset.mode === 'tools') search.focus();
        });
    });

    apply('');
}