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

    try {
      // Use DuckDuckGo HTML endpoint without JavaScript dependencies
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: context.signal || AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Search engine responded with status: ${response.status}` };
      }

      const html = await response.text();
      const results: Array<{ title: string; snippet: string; url: string }> = [];

      // Regex parser for DuckDuckGo HTML results
      const resultBlockRegex = /<div class="result__body">([\s\S]*?)<\/div>/g;
      let match: RegExpExecArray | null;

      while ((match = resultBlockRegex.exec(html)) !== null && results.length < maxResults) {
        const block = match[1];

        // Extract title & link
        const linkMatch = /<a class="result__snippet[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
          || /<a class="result__url[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

        const titleMatch = /<a class="result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

        // Extract snippet
        const snippetMatch = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/i.exec(block);

        const clean = (text: string) => text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();

        if (titleMatch) {
          const rawUrl = titleMatch[1];
          // DuckDuckGo redirects often look like /l/?uddg=https%3A%2F%2F...
          let finalUrl = rawUrl;
          const uddgMatch = /uddg=([^&]+)/.exec(rawUrl);
          if (uddgMatch) {
            try {
              finalUrl = decodeURIComponent(uddgMatch[1]);
            } catch {
              finalUrl = rawUrl;
            }
          }

          results.push({
            title: clean(titleMatch[2]),
            snippet: snippetMatch ? clean(snippetMatch[1]) : '',
            url: finalUrl,
          });
        }
      }

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
}
