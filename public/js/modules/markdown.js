/**
 * markdown.js — Renderer Markdown → HTML para respuestas de JARVIS (sin dependencias).
 *
 * Bloques: párrafos, títulos, listas (anidadas, numeradas, tareas), citas, tablas,
 *          bloques de código (también sin cerrar, para el streaming) y reglas.
 * Inline:  `código`, **negrita**, *cursiva*, ~~tachado~~, [enlaces](https://…) y URLs sueltas.
 * Seguridad: todo el texto se escapa antes de generar HTML; solo se enlazan http(s).
 */

export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FENCE_RE = /^\s*(```+|~~~+)\s*([\w+#.-]*)[^`]*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

// ── Inline ───────────────────────────────────────────────────────────────────
function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
}

const link = (url, label) =>
  `<a href="${url}" class="hud-link" target="_blank" rel="noopener noreferrer">${label}</a>`;

function inline(raw) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = escapeHtml(raw);

  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => keep(link(url, emphasis(text))));
  s = s.replace(/https?:\/\/[^\s<\u0000]+/g, (u) => {
    const tail = (u.match(/[.,;:!?)\]]+$/) || [''])[0];
    const url = tail ? u.slice(0, -tail.length) : u;
    return keep(link(url, url)) + tail;
  });
  s = emphasis(s);

  // Los marcadores pueden anidarse (código dentro de un enlace)
  for (let pass = 0; pass < 3 && s.includes('\u0000'); pass++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[i] ?? '');
  }
  return s;
}

// ── Listas ───────────────────────────────────────────────────────────────────
function renderList(lines) {
  let out = '';
  const stack = []; // { indent, type }

  const close = () => {
    const top = stack.pop();
    out += `</li></${top.type}>`;
  };

  for (const line of lines) {
    const m = line.match(LIST_RE);
    if (!m) {
      // Línea de continuación del ítem actual
      if (stack.length) out += `<br>${inline(line.trim())}`;
      continue;
    }

    const indent = m[1].replace(/\t/g, '    ').length;
    const type = /\d/.test(m[2]) ? 'ol' : 'ul';
    let content = m[3].replace(/^\[( |x|X)\]\s+/, (_, c) => (c === ' ' ? '☐ ' : '☑ '));

    while (stack.length && indent < stack[stack.length - 1].indent) close();

    const top = stack[stack.length - 1];
    if (top && top.indent === indent && top.type === type) {
      out += '</li><li>';
    } else {
      if (top && top.indent === indent) close(); // mismo nivel, otro tipo de lista
      const num = parseInt(m[2], 10);
      const start = type === 'ol' && num > 1 ? ` start="${num}"` : '';
      out += `<${type}${start}><li>`;
      stack.push({ indent, type });
    }
    out += inline(content);
  }

  while (stack.length) close();
  return out;
}

// ── Tablas ───────────────────────────────────────────────────────────────────
function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function renderTable(header, sep, rows) {
  const aligns = splitRow(sep).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
  });
  const cell = (tag, text, i) =>
    `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${inline(text)}</${tag}>`;

  return (
    '<table><thead><tr>' +
    splitRow(header).map((c, i) => cell('th', c, i)).join('') +
    '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + splitRow(r).map((c, i) => cell('td', c, i)).join('') + '</tr>').join('') +
    '</tbody></table>'
  );
}

const isTableStart = (line, next) =>
  next !== undefined && line.includes('|') && next.includes('|') && TABLE_SEP_RE.test(next);

// ── Bloques ──────────────────────────────────────────────────────────────────
const isBlank = (l) => !l.trim();

function startsBlock(line, next) {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    LIST_RE.test(line) ||
    QUOTE_RE.test(line) ||
    isTableStart(line, next)
  );
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    let m;

    // Código (si no se cierra, ocupa hasta el final: así se ve bien mientras llega por streaming)
    if ((m = line.match(FENCE_RE))) {
      const fence = m[1];
      const lang = m[2];
      const body = [];
      i++;
      const isClose = (l) => {
        const t = l.trim();
        return t.length >= fence.length && t[0] === fence[0] && /^(`+|~+)$/.test(t);
      };
      while (i < lines.length && !isClose(lines[i])) body.push(lines[i++]);
      i++; // línea de cierre
      out.push(
        `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`
      );
      continue;
    }

    if ((m = line.match(HEADING_RE))) {
      const level = Math.min(m[1].length, 4);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) inner.push(lines[i++].match(QUOTE_RE)[1]);
      out.push(`<blockquote>${renderBlocks(inner)}</blockquote>`);
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const sep = lines[i + 1];
      const rows = [];
      let j = i + 2;
      while (j < lines.length && !isBlank(lines[j]) && lines[j].includes('|')) rows.push(lines[j++]);
      out.push(renderTable(line, sep, rows));
      i = j;
      continue;
    }

    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (LIST_RE.test(l) && !HR_RE.test(l)) {
          items.push(l);
          i++;
        } else if (isBlank(l)) {
          // La lista continúa solo si tras las líneas en blanco hay otro ítem
          let j = i;
          while (j < lines.length && isBlank(lines[j])) j++;
          if (j < lines.length && LIST_RE.test(lines[j])) i = j;
          else break;
        } else if (/^\s{2,}\S/.test(l) && !FENCE_RE.test(l)) {
          items.push(l); // continuación indentada
          i++;
        } else {
          break;
        }
      }
      out.push(renderList(items));
      continue;
    }

    // Párrafo: hasta una línea en blanco o el inicio de otro bloque
    const para = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }

  return out.join('');
}

export function formatMarkdown(text) {
  if (!text) return '';
  return renderBlocks(String(text).replace(/\r\n?/g, '\n').split('\n'));
}