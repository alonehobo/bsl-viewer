import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViewerOptions } from './types.js';
import { SERVER_NAME, VERSION } from './version.js';

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export interface CliConfig extends ViewerOptions {
  stdio: boolean;
  help: boolean;
  version: boolean;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function parsePositiveInt(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

export function parseViewport(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error('--viewport must use WIDTHxHEIGHT, for example 1440x900');
  const width = parsePositiveInt(match[1], '--viewport width');
  const height = parsePositiveInt(match[2], '--viewport height');
  if (width < 320 || height < 240 || width > 7680 || height > 4320) {
    throw new Error('--viewport must be between 320x240 and 7680x4320');
  }
  return { width, height };
}

export function defaultAssetsDir(): string {
  const ownDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.basename(ownDirectory) === 'dist'
    ? path.join(ownDirectory, 'web')
    : path.resolve(ownDirectory, '..', 'dist', 'web');
}

export function parseCliArgs(args: string[], cwd = process.cwd()): CliConfig {
  const roots: string[] = [];
  let viewport = DEFAULT_VIEWPORT;
  let headless = false;
  let maxBytes = DEFAULT_MAX_BYTES;
  let allowAnyPath = false;
  let stdio = false;
  let help = false;
  let version = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--root') roots.push(path.resolve(cwd, requireValue(args, i++, arg)));
    else if (arg === '--viewport') viewport = parseViewport(requireValue(args, i++, arg));
    else if (arg === '--max-bytes') maxBytes = parsePositiveInt(requireValue(args, i++, arg), arg);
    else if (arg === '--allow-any-path') allowAnyPath = true;
    else if (arg === '--headless') headless = true;
    else if (arg === '--stdio') stdio = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--version' || arg === '-v') version = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return {
    roots: roots.length ? roots : [path.resolve(cwd)],
    allowAnyPath,
    viewport,
    headless,
    maxBytes,
    stdio,
    help,
    version,
    assetsDir: defaultAssetsDir(),
  };
}

export const HELP = `${SERVER_NAME} ${VERSION}

Usage:
  1c-form-viewer --stdio [--root <path>... | --allow-any-path]
                 [--viewport 1440x900] [--headless]
                 [--max-bytes 67108864]

Options:
  --stdio               Run as a local MCP server over standard I/O.
  --root <path>         Allow read-only access below this directory (repeatable).
  --allow-any-path      Allow absolute paths anywhere on this machine (read-only).
  --viewport <WxH>      Browser viewport, default 1440x900.
  --headless            Hide the Edge window (intended for CI).
  --max-bytes <number>  Maximum source file size, default 67108864.
  --help                Show this help.
  --version             Show the package version.
`;
