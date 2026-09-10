import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  decodeText,
  formLayoutFor,
  objectMetaCandidates,
  OBJECT_META_MARKER,
  SUPPORTED_EXTENSIONS,
} from './core/document.cjs';
import type { LoadedDocument } from './types.js';

/* The 1C-specific rules — encodings, form descriptors, object metadata — live
 * in packages/1c-preview-core so this server and the VS Code extension resolve
 * the same file the same way. What stays here is this server's own access
 * policy: allow-roots, realpath canonicalisation and the size limit. */
export { decodeText };

export class FileAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileAccessError';
  }
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

export class FileLoader {
  private constructor(
    private readonly roots: string[],
    private readonly requestedRoots: string[],
    private readonly maxBytes: number,
    private readonly cwd: string,
    private readonly allowAnyPath: boolean,
  ) {}

  static async create(
    roots: string[],
    maxBytes: number,
    cwd = process.cwd(),
    allowAnyPath = false,
  ): Promise<FileLoader> {
    const canonicalRoots: string[] = [];
    const requestedRoots: string[] = [];
    for (const root of roots) {
      const requested = path.resolve(cwd, root);
      const canonical = await fs.realpath(requested).catch(() => {
        throw new FileAccessError(`Allowed root does not exist: ${root}`);
      });
      const stat = await fs.stat(canonical);
      if (!stat.isDirectory()) throw new FileAccessError(`Allowed root is not a directory: ${root}`);
      canonicalRoots.push(canonical);
      requestedRoots.push(requested);
    }
    return new FileLoader(canonicalRoots, requestedRoots, maxBytes, cwd, allowAnyPath);
  }

  allowedRoots(): string[] {
    return [...this.roots];
  }

  private assertAllowed(candidate: string): void {
    if (this.allowAnyPath) return;
    if (!this.roots.some((root) => isInside(root, candidate))) {
      throw new FileAccessError(`Path is outside the allowed roots: ${candidate}`);
    }
  }

  private assertRequestedAllowed(candidate: string): void {
    if (this.allowAnyPath) return;
    if (![...this.requestedRoots, ...this.roots].some((root) => isInside(root, candidate))) {
      throw new FileAccessError(`Path is outside the allowed roots: ${candidate}`);
    }
  }

  private async canonicalFile(inputPath: string): Promise<string> {
    const requested = path.resolve(this.cwd, inputPath);
    this.assertRequestedAllowed(requested);
    const canonical = await fs.realpath(requested).catch(() => {
      throw new FileAccessError(`File does not exist: ${inputPath}`);
    });
    this.assertAllowed(canonical);
    const stat = await fs.stat(canonical);
    if (!stat.isFile()) throw new FileAccessError(`Path is not a file: ${inputPath}`);
    return canonical;
  }

  private async maybeResolveFormDescriptor(canonicalPath: string): Promise<string> {
    const layout = formLayoutFor(canonicalPath);
    if (!layout) return canonicalPath;
    try {
      return await this.canonicalFile(layout);
    } catch (error) {
      if (error instanceof FileAccessError && error.message.startsWith('File does not exist:')) return canonicalPath;
      throw error;
    }
  }

  private async readCanonical(filePath: string): Promise<{ content: string; encoding: LoadedDocument['encoding']; size: number }> {
    this.assertAllowed(filePath);
    const stat = await fs.stat(filePath);
    if (stat.size > this.maxBytes) {
      throw new FileAccessError(`File is ${stat.size} bytes; limit is ${this.maxBytes}: ${filePath}`);
    }
    const bytes = await fs.readFile(filePath);
    const decoded = decodeText(bytes);
    return { ...decoded, size: bytes.length };
  }

  private async loadObjectMeta(formPath: string): Promise<string> {
    for (const candidate of objectMetaCandidates(formPath)) {
      try {
        const canonical = await this.canonicalFile(candidate);
        if (normalizeForComparison(canonical) === normalizeForComparison(formPath)) continue;
        const { content } = await this.readCanonical(canonical);
        if (content.includes(OBJECT_META_MARKER)) return content;
      } catch (error) {
        if (error instanceof FileAccessError) continue;
        throw error;
      }
    }
    return '';
  }

  async load(inputPath: string): Promise<LoadedDocument> {
    const requestedPath = path.resolve(this.cwd, inputPath);
    const initial = await this.canonicalFile(inputPath);
    const resolvedPath = await this.maybeResolveFormDescriptor(initial);
    const { content, encoding, size } = await this.readCanonical(resolvedPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      throw new FileAccessError(`Unsupported file extension: ${extension || '(none)'}`);
    }
    return {
      requestedPath,
      resolvedPath,
      content,
      objectMeta: extension === '.xml' ? await this.loadObjectMeta(resolvedPath) : '',
      encoding,
      size,
      extension,
    };
  }
}
