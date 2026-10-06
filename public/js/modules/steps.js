/**
 * steps.js — Traza minimizada del paso a paso del agente.
 *
 * Dos tipos de paso:
 *   · note → comentario del agente (texto emitido antes de usar una herramienta)
 *   · tool → ejecución de una herramienta (estado, nombre, argumento, duración)
 *
 * Mientras la tarea corre se ve solo el último paso; al terminar queda una
 * línea resumen ("4 pasos · 3.2 s") que despliega el detalle al pulsarla.
 * El contenedor se inyecta solo, entre la cabecera y #response-body.
 */
import { state, dom } from './state.js';
import { formatMarkdown } from './markdown.js';
import { openExternalUrl } from './ui.js';

const MAX_ARG_CHARS = 160;
const ARG_KEYS = ['command', 'cmd', 'path', 'file_path', 'filePath', 'file', 'query', 'url', 'pattern', 'text', 'prompt'];
const CHEVRON =
    '<svg class="steps-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>';

let root = null;
let list = null;
let summaryBtn = null;
let summaryLabel = null;
let tools = []; // { el, name, id, t0, done }
let count = 0;
let startedAt = 0;
let finished = false;

// ── Utilidades ───────────────────────────────────────────────────────────────
function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
}

function oneLine(text, max = MAX_ARG_CHARS) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Quita la sintaxis markdown para la vista de una línea. */
function plain(md) {
    return oneLine(
        String(md ?? '')
            .replace(/```[a-z]*\n?/gi, '')
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
            .replace(/(\*\*|__|~~|`)/g, '')
            .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2'),
        600
    );
}

/** Resume los argumentos de una herramienta en una sola línea legible. */
function summarizeArgs(args) {
    if (args == null || args === '') return '';
    if (typeof args === 'string') return oneLine(args);
    if (typeof args === 'object') {
        const key = ARG_KEYS.find((k) => typeof args[k] === 'string' && args[k]);
        if (key) return oneLine(args[key]);
        const first = Object.values(args).find((v) => typeof v === 'string' && v);
        if (first) return oneLine(first);
        try {
            return oneLine(JSON.stringify(args));
        } catch {
            return '';
        }
    }
    return oneLine(args);
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 100) return '<0.1s';
    return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

// ── Construcción perezosa del contenedor ─────────────────────────────────────
function ensure() {
    if (root) return true;
    if (!dom.body?.parentNode) return false;

    root = h('div', 'steps');
    root.hidden = true;
    root.dataset.open = 'false';
    root.dataset.state = 'running';
    root.innerHTML =
        `<button type="button" class="steps-summary" aria-expanded="false">${CHEVRON}<span class="steps-label"></span></button>` +
        '<ol class="steps-list" aria-label="Pasos del agente"></ol>';

    summaryBtn = root.querySelector('.steps-summary');
    summaryLabel = root.querySelector('.steps-label');
    list = root.querySelector('.steps-list');
    dom.body.parentNode.insertBefore(root, dom.body);

    summaryBtn.addEventListener('click', () => {
        const open = root.dataset.open !== 'true';
        root.dataset.open = String(open);
        summaryBtn.setAttribute('aria-expanded', String(open));
        if (open) list.scrollTop = list.scrollHeight;
    });

    // Clic (o Enter/Espacio) en un paso → mostrar el texto completo (con formato en comentarios)
    const toggleStep = (e) => {
        const link = e.target.closest('a');
        if (link?.href) {
            e.preventDefault();
            openExternalUrl(link.href);
            return;
        }
        const li = e.target.closest('.step');
        if (!li) return;
        const open = li.classList.toggle('is-expanded');
        if (li.classList.contains('step-note')) {
            const box = li.querySelector('.step-text');
            if (open) box.innerHTML = formatMarkdown(li._raw);
            else box.textContent = plain(li._raw);
        }
    };
    list.addEventListener('click', toggleStep);
    list.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        toggleStep(e);
    });
    return true;
}

function updateSummary() {
    if (!summaryLabel) return;
    const n = `${count} ${count === 1 ? 'paso' : 'pasos'}`;
    summaryLabel.textContent = finished ? `${n} · ${formatDuration(Date.now() - startedAt)}` : n;
}

function push(li) {
    if (!ensure()) return;
    if (!count) startedAt = state.taskStart || Date.now();
    count += 1;
    state.stepCount = count;
    list.appendChild(li);
    root.hidden = false;
    updateSummary();
    list.scrollTop = list.scrollHeight;
}

// ── API pública ──────────────────────────────────────────────────────────────
export function hasSteps() {
    return count > 0;
}

export function resetSteps() {
    tools = [];
    count = 0;
    state.stepCount = 0;
    startedAt = 0;
    finished = false;
    if (!root) return;
    list.innerHTML = '';
    root.hidden = true;
    root.dataset.open = 'false';
    root.dataset.state = 'running';
    summaryBtn.setAttribute('aria-expanded', 'false');
}

/** Comentario del agente (una línea; clic para ver completo). */
export function addNote(text) {
    const clean = String(text ?? '').trim();
    if (!clean) return;
    const li = h('li', 'step step-note');
    li.tabIndex = 0;
    li.title = 'Ver completo';
    li._raw = clean;
    li.append(h('span', 'step-dot'), h('div', 'step-text', plain(clean)));
    push(li);
}

/** Inicio de una herramienta. */
export function startTool(name, args, id) {
    const li = h('li', 'step step-tool');
    li.tabIndex = 0;
    li.dataset.state = 'running';
    li.title = 'Ver completo';
    const time = h('span', 'step-time');
    li.append(h('span', 'step-dot'), h('span', 'step-chip', name || 'herramienta'), h('span', 'step-arg', summarizeArgs(args)), time);
    tools.push({ el: li, time, name, id, t0: Date.now(), done: false });
    push(li);
}

/** Fin de una herramienta (por id si existe; si no, la última en curso con ese nombre). */
export function endTool(name, ok = true, id) {
    const running = tools.filter((t) => !t.done);
    const entry =
        (id != null && running.find((t) => t.id === id)) ||
        [...running].reverse().find((t) => t.name === name) ||
        running[running.length - 1];
    if (!entry) return;
    entry.done = true;
    entry.el.dataset.state = ok ? 'ok' : 'fail';
    entry.time.textContent = formatDuration(Date.now() - entry.t0);
}

/** Cierra la traza: lo que siga en curso queda como detenido y se pliega al resumen. */
export function finishSteps() {
    if (!root || finished || !count) return;
    finished = true;
    tools.forEach((t) => {
        if (!t.done) {
            t.done = true;
            t.el.dataset.state = 'stopped';
        }
    });
    root.dataset.state = 'done';
    updateSummary();
}