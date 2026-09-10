#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { BrowserSession } from './browser-session.js';
import { parseCliArgs, HELP } from './config.js';
import { ViewerController } from './controller.js';
import { FileLoader } from './files.js';
import { createMcpServer } from './mcp-server.js';

async function main(): Promise<void> {
  const config = parseCliArgs(process.argv.slice(2));
  if (config.help) {
    process.stdout.write(HELP);
    return;
  }
  if (config.version) {
    process.stdout.write('0.1.0\n');
    return;
  }
  if (!config.stdio) throw new Error('Only STDIO transport is supported. Pass --stdio.');

  const loader = await FileLoader.create(config.roots, config.maxBytes, process.cwd(), config.allowAnyPath);
  const browser = new BrowserSession(config);
  const controller = new ViewerController(loader, browser);
  const handle = serveStdio(() => createMcpServer(controller), {
    onerror: (error) => process.stderr.write(`[1c-form-viewer] ${error.message}\n`),
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await controller.close().catch(() => undefined);
    await handle.close().catch(() => undefined);
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  process.stdin.once('end', () => void close());
}

main().catch((error) => {
  process.stderr.write(`1c-form-viewer: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
