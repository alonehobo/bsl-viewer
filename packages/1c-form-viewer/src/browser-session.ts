import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { StaticAssetServer } from './static-server.js';
import type { BrowserPreviewState, LoadedDocument, ViewerOptions } from './types.js';

type JsonObject = Record<string, unknown>;

interface ViewerApi {
  ready: boolean;
  load(input: { path: string; content: string; objectMeta: string }): BrowserPreviewState;
  state(): BrowserPreviewState;
  inspect(options: { query?: string; visibleOnly?: boolean }): JsonObject[];
  selectElement(id: string): JsonObject;
  switchTab(pageId: string, pagesId?: string): BrowserPreviewState;
  scroll(options: JsonObject): JsonObject;
  elementSelector(id: string): string;
}

declare global {
  interface Window {
    AgentViewer: ViewerApi;
  }
}

export type CaptureScope = 'viewport' | 'document' | 'element';

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly assets: StaticAssetServer;

  constructor(private readonly options: ViewerOptions) {
    this.assets = new StaticAssetServer(options.assetsDir);
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    const url = await this.assets.start();
    let browser: Browser;
    try {
      browser = await chromium.launch({
        channel: 'msedge',
        headless: this.options.headless,
      });
    } catch (error) {
      await this.assets.close();
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Microsoft Edge could not be started. Install Edge or use a Windows host with Edge available. ${detail}`);
    }
    /* Everything past a successful launch has to clean up after itself. Leaving
     * a launched browser behind on a failed newContext/goto left an orphan Edge
     * process running and the next call simply launched another one. */
    try {
      /* Compare identity before clearing: a late 'disconnected' from a replaced
       * browser must not wipe the handles of its successor. */
      browser.once('disconnected', () => {
        if (this.browser !== browser) return;
        this.browser = null;
        this.context = null;
        this.page = null;
      });
      const context = await browser.newContext({ viewport: this.options.viewport });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.AgentViewer?.ready === true);
      this.browser = browser;
      this.context = context;
      this.page = page;
      return page;
    } catch (error) {
      await browser.close().catch(() => undefined);
      await this.assets.close();
      throw error;
    }
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No preview is open. Call open_preview first.');
    }
    return this.page;
  }

  async open(document: LoadedDocument): Promise<BrowserPreviewState> {
    const page = await this.ensurePage();
    this.assets.setDocument(document);
    const state = await page.evaluate((input) => window.AgentViewer.load(input), {
      path: document.resolvedPath,
      content: document.content,
      objectMeta: document.objectMeta,
    });
    await page.waitForTimeout(25);
    return state;
  }

  async state(): Promise<BrowserPreviewState> {
    return this.requirePage().evaluate(() => window.AgentViewer.state());
  }

  async inspect(query?: string, visibleOnly = false): Promise<JsonObject[]> {
    return this.requirePage().evaluate(
      (options) => window.AgentViewer.inspect(options),
      { query, visibleOnly },
    );
  }

  async switchTab(pageId: string, pagesId?: string): Promise<BrowserPreviewState> {
    const page = this.requirePage();
    const result = await page.evaluate(
      ({ targetPageId, ownerPagesId }) => window.AgentViewer.switchTab(targetPageId, ownerPagesId),
      { targetPageId: pageId, ownerPagesId: pagesId },
    );
    await page.waitForTimeout(25);
    return result;
  }

  async selectElement(elementId: string): Promise<JsonObject> {
    const page = this.requirePage();
    const result = await page.evaluate((id) => window.AgentViewer.selectElement(id), elementId);
    await page.waitForTimeout(25);
    return result;
  }

  async scroll(options: JsonObject): Promise<JsonObject> {
    const page = this.requirePage();
    const result = await page.evaluate((input) => window.AgentViewer.scroll(input), options);
    await page.waitForTimeout(25);
    return result;
  }

  async capture(scope: CaptureScope, elementId?: string): Promise<Buffer> {
    const page = this.requirePage();
    if (scope === 'element') {
      if (!elementId) throw new Error('element_id is required when scope is element.');
      const selector = await page.evaluate((id) => window.AgentViewer.elementSelector(id), elementId);
      return page.locator(selector).first().screenshot({ type: 'png' });
    }
    return page.screenshot({ type: 'png', fullPage: scope === 'document' });
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    this.assets.clearDocument();
    if (browser) await browser.close();
    await this.assets.close();
  }

  previewUrl(): string {
    this.requirePage();
    return this.assets.internalUrl();
  }
}
