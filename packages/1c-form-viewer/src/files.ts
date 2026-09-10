import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LoadedDocument } from './types.js';

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
    if (path.extname(canonicalPath).toLowerCase() !== '.xml') return canonicalPath;
    if (path.basename(path.dirname(canonicalPath)).toLowerCase() !== 'forms') return canonicalPath;
    const name = path.basename(canonicalPath, path.extname(canonicalPath));
    const layout = path.join(path.dirname(canonicalPath), name, 'Ext', 'Form.xml');
    try {
      return await this.canonicalFile(layout);
    } catch (error) {
      if (error instanceof FileAccessError && error.message.startsWith('File does not exist:')) return canonicalPath;
      throw error;
    }
  }

  private objectMetaCandidates(formPath: string): string[] {
    if (path.basename(formPath).toLowerCase() !== 'form.xml') return [];
    const extDir = path.dirname(formPath);
    if (path.basename(extDir).toLowerCase() !== 'ext') return [];
    const formDir = path.dirname(extDir);
    const formsDir = path.dirname(formDir);
    if (path.basename(formsDir).toLowerCase() !== 'forms') return [];
    const objectDir = path.dirname(formsDir);
    const objectName = path.basename(objectDir);
    if (!objectName) return [];
    return [
      path.join(path.dirname(objectDir), `${objectName}.xml`),
      path.join(objectDir, `${objectName}.xml`),
    ];
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
    for (const candidate of this.objectMetaCandidates(formPath)) {
      try {
        const canonical = await this.canonicalFile(candidate);
        if (normalizeForComparison(canonical) === normalizeForComparison(formPath)) continue;
        const { content } = await this.readCanonical(canonical);
        if (content.includes('MetaDataObject')) return content;
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
    if (extension !== '.xml' && extension !== '.mxl') {
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

export function decodeText(bytes: Uint8Array): { content: string; encoding: LoadedDocument['encoding'] } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { content: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { content: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2);
    const swapped = new Uint8Array(body.length - (body.length % 2));
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return { content: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf16be' };
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
  } catch {
    return { content: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  }
}
