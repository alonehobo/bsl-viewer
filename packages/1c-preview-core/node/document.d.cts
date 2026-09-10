export type DocumentEncoding =
  | 'utf8'
  | 'utf8-bom'
  | 'utf16le'
  | 'utf16be'
  | 'windows-1251';

export declare const OBJECT_META_MARKER: string;
export declare const SUPPORTED_EXTENSIONS: string[];
export declare function decodeText(bytes: Uint8Array): { content: string; encoding: DocumentEncoding };
export declare function formLayoutFor(filePath: string): string;
export declare function objectMetaCandidates(formPath: string): string[];
export declare function isSupportedExtension(filePath: string): boolean;
