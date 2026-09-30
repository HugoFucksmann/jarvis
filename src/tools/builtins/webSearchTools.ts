import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';

export class WebSearchTool extends BaseTool {
  readonly name = 'web_search';
  readonly description = 'Realiza una búsqueda en internet y devuelve títulos, resúmenes y enlaces relevantes.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['network:search'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'La consulta o palabras clave para buscar en la web.',
      },
      maxResults: {
        type: 'number',
        description: 'Cantidad máxima de resultados deseados (por defecto 5).',
      },
    },
    required: ['query'],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const query = args.query as string;
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 5;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return { success: false, error: 'Query parameter is required and cannot be empty.' };
    }

    try {
      const results = await this.searchDuckDuckGo(query.trim(), maxResults, context.signal);

      return {
        success: true,
        data: {
          query,
          count: results.length,
          results,
        },
      };
    } catch (err: unknown) {
      return { success: false, error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async searchDuckDuckGo(
    query: string,
    maxResults: number,
    signal?: AbortSignal
  ): Promise<Array<{ title: string; snippet: string; url: string }>> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    };

    let html = '';

    // Primary attempt: GET request to html.duckduckgo.com
    try {
      const encodedQuery = encodeURIComponent(query);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
        headers,
        signal: signal || AbortSignal.timeout(10000),
      });
      if (res.ok) {
        html = await res.text();
      }
    } catch {
      // Ignore and proceed to POST fallback
    }

    // Fallback attempt: POST request to html.duckduckgo.com if GET returned nothing
    if (!html || !html.includes('class="result')) {
      const postRes = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ q: query }).toString(),
        signal: signal || AbortSignal.timeout(10000),
      });
      if (postRes.ok) {
        html = await postRes.text();
      }
    }

    if (!html) {
      throw new Error('No se pudo obtener respuesta del motor de búsqueda.');
    }

    return this.parseDuckDuckGoHtml(html, maxResults);
  }

  private parseDuckDuckGoHtml(
    html: string,
    maxResults: number
  ): Array<{ title: string; snippet: string; url: string }> {
    const clean = (text: string) =>
      text
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

    const results: Array<{ title: string; snippet: string; url: string }> = [];

    // DuckDuckGo splits result items with class "result results_links ..."
    const chunks = html.split(/<div\s+class="result\s+/i);

    for (const chunk of chunks.slice(1)) {
      // Discard advertisement blocks
      if (chunk.includes('result--ad')) {
        continue;
      }

      // Title & Target Link
      const titleMatch = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
      if (!titleMatch) continue;

      const rawUrl = titleMatch[1];
      let finalUrl = rawUrl;
      const uddgMatch = /uddg=([^&]+)/.exec(rawUrl);
      if (uddgMatch) {
        try {
          finalUrl = decodeURIComponent(uddgMatch[1]);
        } catch {
          finalUrl = rawUrl;
        }
      }

      // Snippet (contained within <a class="result__snippet" ...>...</a>)
      const snippetMatch = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
      const snippet = snippetMatch ? clean(snippetMatch[1]) : '';

      results.push({
        title: clean(titleMatch[2]),
        snippet,
        url: finalUrl,
      });

      if (results.length >= maxResults) {
        break;
      }
    }

    return results;
  }
}
