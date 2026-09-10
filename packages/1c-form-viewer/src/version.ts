import { createRequire } from 'node:module';

/* One source for the version: package.json. It used to be repeated in the CLI,
 * the --help text and the MCP handshake, which is three things to forget on a
 * release. Resolved from the compiled file, so dist/version.js finds the
 * package.json one directory up in both the workspace and an installed copy. */
const manifest = createRequire(import.meta.url)('../package.json') as { version: string };

export const VERSION = manifest.version;
export const SERVER_NAME = '1c-form-viewer';
