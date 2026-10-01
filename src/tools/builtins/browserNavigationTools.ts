import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import { getSharedPlaywrightManager } from '../../browser/PlaywrightManager.js';

export class BrowseWebTool extends BaseTool {
  readonly name = 'browse_web';
  readonly description =
    'Navega y extrae información de páginas web de forma INVISIBLE y en segundo plano con Playwright (headless). El usuario NO verá ninguna ventana abrirse. Úsalo SOLO para leer contenido, scraping, rellenar formularios o tomar capturas de pantalla de forma automatizada. Si el usuario quiere ABRIR una página en su navegador visible, usa la herramienta "open_url" en su lugar.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = ['browser:navigate'];
  readonly parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'extract', 'click', 'fill', 'press', 'screenshot', 'evaluate', 'close'],
        description:
          'Acción a realizar: "extract" (lee y extrae texto limpio de la página en modo headless), "navigate" (visita una URL en modo headless invisible, NO abre ventana visible), "click" (hace clic en un elemento), "fill" (escribe en un campo de texto), "press" (presiona una tecla como Enter), "screenshot" (captura visual de la página en background), "evaluate" (ejecuta JS) o "close" (cierra el navegador headless).',
      },
      url: {
        type: 'string',
        description: 'Dirección URL a navegar o extraer (ej: "https://docs.python.org" o "lanacion.com.ar").',
      },
      selector: {
        type: 'string',
        description: 'Selector CSS o texto del elemento interactivo para "click" o "fill" (ej: "button.submit", "input[name=q]", "a.nav-link").',
      },
      text: {
        type: 'string',
        description: 'Texto a escribir cuando la acción es "fill".',
      },
      key: {
        type: 'string',
        description: 'Tecla a presionar cuando la acción es "press" (ej: "Enter", "Tab", "Escape").',
      },
      script: {
        type: 'string',
        description: 'Código JavaScript a evaluar cuando la acción es "evaluate".',
      },
      savePath: {
        type: 'string',
        description: 'Ruta opcional para guardar la captura cuando la acción es "screenshot".',
      },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const action = (args.action as string)?.toLowerCase();
    const url = (args.url as string)?.trim();
    const selector = (args.selector as string)?.trim();
    const text = (args.text as string) || '';
    const key = (args.key as string) || 'Enter';
    const script = (args.script as string) || '';
    const savePath = (args.savePath as string)?.trim();

    const manager = getSharedPlaywrightManager();

    try {
      switch (action) {
        case 'navigate': {
          if (!url) {
            return { success: false, error: 'La acción "navigate" requiere el parámetro "url".' };
          }
          const res = await manager.navigate(url);
          return {
            success: res.success,
            data: {
              action: 'navigate',
              url: res.url,
              title: res.title,
              message: `Página cargada correctamente: "${res.title}"`,
            },
          };
        }

        case 'extract': {
          const content = await manager.extractContent(url);
          return {
            success: true,
            data: {
              action: 'extract',
              url: content.url,
              title: content.title,
              headings: content.headings,
              sampleLinks: content.links.slice(0, 10),
              inputs: content.inputs,
              textLength: content.content.length,
              content: content.content,
            },
          };
        }

        case 'click': {
          if (!selector) {
            return { success: false, error: 'La acción "click" requiere el parámetro "selector".' };
          }
          const res = await manager.click(selector);
          return {
            success: res.success,
            data: res.data || { message: res.error },
            error: res.error,
          };
        }

        case 'fill': {
          if (!selector) {
            return { success: false, error: 'La acción "fill" requiere el parámetro "selector".' };
          }
          const res = await manager.fill(selector, text);
          return {
            success: res.success,
            data: res.data,
            error: res.error,
          };
        }

        case 'press': {
          const res = await manager.press(key);
          return {
            success: res.success,
            data: res.data,
            error: res.error,
          };
        }

        case 'screenshot': {
          const res = await manager.screenshot(savePath);
          return {
            success: res.success,
            data: res.data,
            error: res.error,
          };
        }

        case 'evaluate': {
          if (!script) {
            return { success: false, error: 'La acción "evaluate" requiere el parámetro "script".' };
          }
          const res = await manager.evaluate(script);
          return {
            success: res.success,
            data: res.data,
            error: res.error,
          };
        }

        case 'close': {
          await manager.close();
          return {
            success: true,
            data: { message: 'Sesión de navegador en segundo plano cerrada.' },
          };
        }

        default:
          return {
            success: false,
            error: `Acción "${action}" no reconocida. Acciones válidas: navigate, extract, click, fill, press, screenshot, evaluate, close.`,
          };
      }
    } catch (err: unknown) {
      return {
        success: false,
        error: `Error en browse_web (${action}): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
