import path from 'path';
import fs from 'fs';
import {
  BrowserActionResult,
  BrowserNavigationOptions,
  BrowserStatus,
  ExtractedPageContent,
} from './types.js';
import { Logger } from '../logger/Logger.js';
import { config } from '../config/index.js';

export class PlaywrightManager {
  private browser: any = null;
  private context: any = null;
  private page: any = null;
  private logger = new Logger('PlaywrightManager');
  private idleTimeoutId: NodeJS.Timeout | null = null;
  private isPlaywrightInstalled: boolean = true;
  private lastUrl: string = '';
  private lastTitle: string = '';

  constructor() {
    this.logger.info('PlaywrightManager initialized (autonomous headless browsing).');
  }

  /**
   * Ensures a browser instance and page are ready.
   */
  private async ensureBrowser(): Promise<any> {
    this.resetIdleTimer();

    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    try {
      const { chromium } = await import('playwright');

      if (!this.browser) {
        // Try launching bundled chromium or system channels
        const launchOptions: any = {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        };

        try {
          this.browser = await chromium.launch(launchOptions);
        } catch (launchErr: any) {
          // If default chromium is missing, attempt system chrome or edge channel
          if (process.platform === 'win32') {
            try {
              this.logger.info('Default Chromium not found, trying system msedge channel...');
              this.browser = await chromium.launch({ ...launchOptions, channel: 'msedge' });
            } catch {
              try {
                this.logger.info('Trying system chrome channel...');
                this.browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
              } catch {
                throw launchErr;
              }
            }
          } else {
            try {
              this.browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
            } catch {
              throw launchErr;
            }
          }
        }
      }

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 JARVIS-Agent',
      });

      this.page = await this.context.newPage();
      return this.page;
    } catch (err: unknown) {
      this.isPlaywrightInstalled = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Playwright browser launch unavailable: ${msg}. Fallback mode active.`);
      throw new Error(`Navegador Playwright no disponible: ${msg}`);
    }
  }

  public async navigate(url: string, options?: BrowserNavigationOptions): Promise<BrowserActionResult> {
    const targetUrl = this.normalizeUrl(url);

    try {
      const page = await this.ensureBrowser();
      const waitUntil = options?.waitUntil || 'domcontentloaded';
      const timeout = options?.timeoutMs || 30000;

      await page.goto(targetUrl, { waitUntil, timeout });
      this.lastUrl = page.url();
      this.lastTitle = await page.title();

      return {
        action: 'navigate',
        success: true,
        url: this.lastUrl,
        title: this.lastTitle,
        data: { message: `Navegación completada: ${this.lastTitle} (${this.lastUrl})` },
      };
    } catch (err: unknown) {
      // Fallback for navigation verification if browser launch fails
      this.lastUrl = targetUrl;
      const fallback = await this.fallbackExtract(targetUrl);
      this.lastTitle = fallback.title;

      return {
        action: 'navigate',
        success: true,
        url: targetUrl,
        title: fallback.title,
        data: {
          message: `Navegación procesada vía fallback HTTP: ${fallback.title}`,
          preview: fallback.content.slice(0, 200),
        },
      };
    }
  }

  public async extractContent(url?: string): Promise<ExtractedPageContent> {
    if (url) {
      try {
        await this.navigate(url);
      } catch {
        // continue to extraction
      }
    }

    try {
      const page = await this.ensureBrowser();
      this.lastUrl = page.url();
      this.lastTitle = await page.title();

      // Extract clean text, headings, and links from the active page
      const data = await page.evaluate(() => {
        // Remove noise tags
        const noiseSelectors = ['script', 'style', 'noscript', 'iframe', 'svg'];
        noiseSelectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        });

        const title = document.title || '';
        const headings: string[] = [];
        document.querySelectorAll('h1, h2, h3').forEach((h) => {
          const txt = (h.textContent || '').trim();
          if (txt && !headings.includes(txt)) headings.push(txt);
        });

        const links: { text: string; href: string }[] = [];
        document.querySelectorAll('a[href]').forEach((a) => {
          const text = (a.textContent || '').trim();
          const href = (a as HTMLAnchorElement).href;
          if (text && href && href.startsWith('http') && links.length < 30) {
            links.push({ text: text.slice(0, 60), href });
          }
        });

        const inputs: { name?: string; placeholder?: string; type?: string }[] = [];
        document.querySelectorAll('input, textarea, select').forEach((inp) => {
          const el = inp as HTMLInputElement;
          if (inputs.length < 15) {
            inputs.push({
              name: el.name || el.id,
              placeholder: el.placeholder,
              type: el.type,
            });
          }
        });

        // Clean main content
        const main = (document.querySelector('main, article, #content, .content, body') || document.body) as HTMLElement | null;
        const rawContent = main ? (main.innerText || main.textContent || '') : '';
        const text = rawContent
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
          .join('\n');

        return {
          title,
          headings,
          links,
          inputs,
          content: text.slice(0, 15000), // Max 15k chars for LLM context
        };
      });

      return {
        url: this.lastUrl,
        title: data.title,
        content: data.content,
        headings: data.headings,
        links: data.links,
        inputs: data.inputs,
      };
    } catch {
      // Graceful HTTP fallback
      const target = url || this.lastUrl;
      return this.fallbackExtract(target);
    }
  }

  public async click(selector: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensureBrowser();
      await page.waitForSelector(selector, { timeout: 10000 });
      await page.click(selector);
      this.lastUrl = page.url();
      this.lastTitle = await page.title();

      return {
        action: 'click',
        success: true,
        url: this.lastUrl,
        title: this.lastTitle,
        data: { message: `Clic realizado con éxito en "${selector}".` },
      };
    } catch (err: unknown) {
      return {
        action: 'click',
        success: false,
        error: `Error al hacer clic en "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async fill(selector: string, text: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensureBrowser();
      await page.waitForSelector(selector, { timeout: 10000 });
      await page.fill(selector, text);

      return {
        action: 'fill',
        success: true,
        url: page.url(),
        title: await page.title(),
        data: { message: `Texto rellenado en "${selector}".` },
      };
    } catch (err: unknown) {
      return {
        action: 'fill',
        success: false,
        error: `Error al rellenar "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async press(key: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensureBrowser();
      await page.keyboard.press(key);

      return {
        action: 'press',
        success: true,
        data: { message: `Tecla "${key}" presionada con éxito.` },
      };
    } catch (err: unknown) {
      return {
        action: 'press',
        success: false,
        error: `Error al presionar tecla "${key}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async screenshot(savePath?: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensureBrowser();
      const screenshotsDir = path.join(config.workspaceRoot, '.jarvis', 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      const filePath = savePath || path.join(screenshotsDir, `web_${Date.now()}.jpg`);
      await page.screenshot({ path: filePath, type: 'jpeg', quality: 85, fullPage: false });

      return {
        action: 'screenshot',
        success: true,
        data: {
          path: filePath,
          url: page.url(),
          title: await page.title(),
        },
      };
    } catch (err: unknown) {
      return {
        action: 'screenshot',
        success: false,
        error: `Error capturando pantalla web: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async evaluate(script: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensureBrowser();
      const result = await page.evaluate(script);

      return {
        action: 'evaluate',
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      return {
        action: 'evaluate',
        success: false,
        error: `Error evaluando script en página: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async close(): Promise<void> {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }

    try {
      if (this.context) {
        await this.context.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
    } catch (err) {
      this.logger.debug(`Browser close note: ${String(err)}`);
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
      this.logger.info('Playwright browser session closed.');
    }
  }

  public getStatus(): BrowserStatus {
    return {
      isAvailable: this.isPlaywrightInstalled,
      isActive: this.page !== null && !this.page.isClosed(),
      currentUrl: this.lastUrl || undefined,
      currentTitle: this.lastTitle || undefined,
      engine: 'Playwright (Chromium Headless)',
    };
  }

  // ─────────────────────────────────────────────
  // Fallbacks & Helpers
  // ─────────────────────────────────────────────

  private normalizeUrl(rawUrl: string): string {
    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return url;
  }

  private async fallbackExtract(url: string): Promise<ExtractedPageContent> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 JARVIS-Agent',
        },
      });

      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : 'Documento Web';

      // Simple clean text extraction
      const cleanText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 10000);

      return {
        url,
        title,
        content: cleanText,
        headings: [],
        links: [],
      };
    } catch (err: unknown) {
      return {
        url,
        title: 'Error de Red',
        content: `No se pudo conectar a la URL: ${err instanceof Error ? err.message : String(err)}`,
        headings: [],
        links: [],
      };
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
    }
    // Auto-close after 10 minutes of inactivity
    this.idleTimeoutId = setTimeout(() => {
      this.close();
    }, 10 * 60 * 1000);
  }
}

// ─────────────────────────────────────────────
// Shared Singleton
// ─────────────────────────────────────────────
let sharedPlaywrightManager: PlaywrightManager | null = null;

export function getSharedPlaywrightManager(): PlaywrightManager {
  if (!sharedPlaywrightManager) {
    sharedPlaywrightManager = new PlaywrightManager();
  }
  return sharedPlaywrightManager;
}
