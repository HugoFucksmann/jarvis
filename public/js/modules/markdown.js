/**
 * markdown.js — Minimal Markdown-to-HTML renderer for JARVIS responses.
 */

export function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Markdown links: [Title](https://...)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" class="hud-link" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Bare URLs
  html = html.replace(
    /(^|[^"'<>])(https?:\/\/[^\s<]+)/g,
    '$1<a href="$2" class="hud-link" target="_blank" rel="noopener noreferrer">$2</a>'
  );
  // Unordered lists
  html = html.replace(/^\s*[-*•]\s+(.*)$/gm, '<li>$1</li>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}
