import { BrowserSession, type CaptureScope } from './browser-session.js';
import { FileLoader } from './files.js';
import type { BrowserPreviewState, LoadedDocument } from './types.js';

export interface PreviewResponse {
  document: Omit<LoadedDocument, 'content' | 'objectMeta'>;
  state: BrowserPreviewState;
}

export class ViewerController {
  private activePath = '';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly loader: FileLoader,
    private readonly browser: BrowserSession,
  ) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private summary(document: LoadedDocument, state: BrowserPreviewState): PreviewResponse {
    const { content: _content, objectMeta: _objectMeta, ...safeDocument } = document;
    return { document: safeDocument, state };
  }

  open(inputPath: string): Promise<PreviewResponse> {
    return this.exclusive(async () => {
      const document = await this.loader.load(inputPath);
      const state = await this.browser.open(document);
      this.activePath = inputPath;
      return this.summary(document, state);
    });
  }

  reload(): Promise<PreviewResponse> {
    return this.exclusive(async () => {
      if (!this.activePath) throw new Error('No preview is open. Call open_preview first.');
      const previous = await this.browser.state();
      const document = await this.loader.load(this.activePath);
      let state = await this.browser.open(document);
      const activePages = previous.tabs.filter((tab) => tab.active && typeof tab.pageId === 'string');
      for (const tab of activePages) {
        try {
          state = await this.browser.switchTab(String(tab.pageId), String(tab.pagesId || '') || undefined);
        } catch {
          // The document changed and this page no longer exists; keep the renderer default.
        }
      }
      return this.summary(document, state);
    });
  }

  inspect(query?: string, visibleOnly = false) {
    return this.exclusive(async () => ({
      elements: await this.browser.inspect(query, visibleOnly),
      state: await this.browser.state(),
    }));
  }

  switchTab(pageId: string, pagesId?: string) {
    return this.exclusive(() => this.browser.switchTab(pageId, pagesId));
  }

  selectElement(elementId: string) {
    return this.exclusive(() => this.browser.selectElement(elementId));
  }

  scroll(options: Record<string, unknown>) {
    return this.exclusive(() => this.browser.scroll(options));
  }

  capture(scope: CaptureScope, elementId?: string) {
    return this.exclusive(() => this.browser.capture(scope, elementId));
  }

  screenshot() {
    return this.exclusive(() => this.browser.capture('viewport'));
  }

  previewUrl() {
    return this.exclusive(async () => ({
      previewUrl: this.browser.previewUrl(),
      externalEdge: true,
    }));
  }

  close(): Promise<{ closed: true }> {
    return this.exclusive(async () => {
      await this.browser.close();
      this.activePath = '';
      return { closed: true };
    });
  }
}
