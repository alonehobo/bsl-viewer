export type PreviewFormat = 'form' | 'template' | 'mxl';

export interface ViewerOptions {
  roots: string[];
  viewport: { width: number; height: number };
  headless: boolean;
  maxBytes: number;
  assetsDir: string;
}

export interface LoadedDocument {
  requestedPath: string;
  resolvedPath: string;
  content: string;
  objectMeta: string;
  encoding: 'utf8-bom' | 'utf8' | 'utf16le' | 'utf16be' | 'windows-1251';
  size: number;
  extension: string;
}

export interface BrowserPreviewState {
  format: PreviewFormat;
  path: string;
  selectedId: string;
  summary: Record<string, unknown>;
  tabs: Array<Record<string, unknown>>;
  scrolls: Array<Record<string, unknown>>;
}

