import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { TOOL_NAMES } from '../src/mcp-server.js';

/* The native server speaks the protocol by hand instead of going through the
 * SDK, so nothing but a real round trip proves its replies parse. It shipped a
 * stray closing brace that made every successful tools/call malformed while
 * tools/list and the error path stayed valid, which is exactly the shape of bug
 * a schema-only check misses. Skipped when the binary has not been built. */
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');

function nativeExecutable(): string | null {
  const configured = process.env.NATIVE_MCP_EXE;
  const candidate = configured
    ? path.resolve(repositoryDir, configured)
    : path.join(repositoryDir, 'artifacts', '1c-form-viewer-native-win-x64', '1c-form-viewer.exe');
  return existsSync(candidate) ? candidate : null;
}

class NativeClient {
  private nextId = 1;
  private readonly pending = new Map<number, (value: Record<string, unknown>) => void>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  static start(executable: string, args: string[]): NativeClient {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new NativeClient(child);
    createInterface({ input: child.stdout }).on('line', (line) => client.accept(line));
    return client;
  }

  private accept(line: string): void {
    if (!line.trim()) return;
    /* Deliberately strict: a malformed reply must fail the test, not be skipped. */
    const message = JSON.parse(line) as { id?: number };
    const resolve = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (resolve) {
      this.pending.delete(message.id as number);
      resolve(message as Record<string, unknown>);
    }
  }

  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => reject(new Error(`${method} timed out`)), 10_000).unref();
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise;
  }

  async stop(): Promise<void> {
    this.child.stdin.end();
    await new Promise((resolve) => this.child.once('close', resolve));
  }
}

test('the native server answers initialize, tools/list and a successful tools/call with parseable JSON', async (t) => {
  const executable = nativeExecutable();
  if (!executable) {
    t.skip('native binary not built; run npm run build:native or set NATIVE_MCP_EXE');
    return;
  }
  const client = NativeClient.start(executable, ['--stdio', '--root', repositoryDir]);
  t.after(() => client.stop());

  const initialized = await client.send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'native-contract-test', version: '1.0.0' },
  });
  const serverInfo = (initialized.result as { serverInfo: { name: string; version: string } }).serverInfo;
  assert.match(serverInfo.version, /^\d+\.\d+\.\d+/);

  const listed = await client.send('tools/list', {});
  const tools = (listed.result as { tools: Array<{ name: string; inputSchema: { type: string } }> }).tools;
  assert.deepEqual(tools.map((tool) => tool.name), [...TOOL_NAMES]);
  for (const tool of tools) assert.equal(tool.inputSchema.type, 'object');

  /* close_preview on a server that never started is a no-op, so this exercises
   * the success envelope without opening a browser window. */
  const closed = await client.send('tools/call', { name: 'close_preview', arguments: {} });
  const result = closed.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
  assert.notEqual(result.isError, true);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), { closed: true });

  const failed = await client.send('tools/call', { name: 'open_preview', arguments: {} });
  assert.equal((failed.result as { isError: boolean }).isError, true);
});
