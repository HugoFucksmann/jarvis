/**
 * types.ts — Browser navigation and Playwright abstraction types.
 */

export interface BrowserNavigationOptions {
  timeoutMs?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ExtractedPageContent {
  url: string;
  title: string;
  content: string; // Clean text or markdown
  headings: string[];
  links: { text: string; href: string }[];
  inputs?: { name?: string; placeholder?: string; type?: string }[];
  screenshotPath?: string;
}

export interface BrowserActionResult {
  action: string;
  success: boolean;
  url?: string;
  title?: string;
  data?: unknown;
  error?: string;
}

export interface BrowserStatus {
  isAvailable: boolean;
  isActive: boolean;
  currentUrl?: string;
  currentTitle?: string;
  engine: string;
}
