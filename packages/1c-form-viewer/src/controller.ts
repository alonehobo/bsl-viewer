import { BrowserSession, type CaptureScope } from './browser-session.js';
import { FileLoader } from './files.js';
import type { BrowserPreviewState, LoadedDocument } from './types.js';

export interface PreviewResponse {
  document: Omit<LoadedDocument, 'content' | 'objectMeta'>;
  state: BrowserPreviewState;
}

/* A tool answer and the picture of the page it describes. The screenshot used
 * to be taken by a second call after the operation had already left the queue,
 * so another tool could move the page in between and the PNG showed something
 * the JSON never claimed. Both now happen in one turn of the queue. */
export interface Visual<T> {
  payload: T;
  image: Buffer;
}

const DEFAULT_INSPECT_LIMIT = 500;

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

  private visual<T>(operation: () => Promise<T>): Promise<Visual<T>> {
    return this.exclusive(async () => {
      const payload = await operation();
      return { payload, image: await this.browser.capture('viewport') };
    });
  }

  private summary(document: LoadedDocument, state: BrowserPreviewState): PreviewResponse {
    const { content: _content, objectMeta: _objectMeta, ...safeDocument } = document;
    return { document: safeDocument, state };
  }

  open(inputPath: string): Promise<Visual<PreviewResponse>> {
    return this.visual(async () => {
      const document = await this.loader.load(inputPath);
      const state = await this.browser.open(document);
      this.activePath = inputPath;
      return this.summary(document, state);
    });
  }

  reload(): Promise<Visual<PreviewResponse>> {
    return this.visual(async () => {
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

  inspect(query?: string, visibleOnly = false, limit = DEFAULT_INSPECT_LIMIT) {
    return this.visual(async () => {
      const found = await this.browser.inspect(query, visibleOnly);
      /* A large form can hold thousands of elements. Returning all of them made
       * one tool answer bigger than the rest of the conversation, so cut the
       * list and say so instead of quietly shipping everything. */
      const elements = found.slice(0, limit);
      return {
        elements,
        truncated: found.length > elements.length,
        totalElements: found.length,
        state: await this.browser.state(),
      };
    });
  }

  switchTab(pageId: string, pagesId?: string) {
    return this.visual(() => this.browser.switchTab(pageId, pagesId));
  }

  selectElement(elementId: string) {
    return this.visual(() => this.browser.selectElement(elementId));
  }

  scroll(options: Record<string, unknown>) {
    return this.visual(() => this.browser.scroll(options));
  }

  capture(scope: CaptureScope, elementId?: string) {
    return this.exclusive(async () => ({
      payload: { scope, elementId: elementId || '', state: await this.browser.state() },
      image: await this.browser.capture(scope, elementId),
    }));
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
