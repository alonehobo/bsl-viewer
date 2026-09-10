import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../src/mcp-server.js';
import type { ViewerController } from '../src/controller.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const state = {
  format: 'form' as const,
  path: 'C:\\root\\Form.xml',
  selectedId: '',
  summary: { elements: 2 },
  tabs: [],
  scrolls: [],
};

class FakeController {
  opened = false;
  requireOpen() {
    if (!this.opened) throw new Error('No preview is open. Call open_preview first.');
  }
  async open() {
    this.opened = true;
    return { document: { requestedPath: state.path, resolvedPath: state.path, encoding: 'utf8', size: 10, extension: '.xml' }, state };
  }
  async reload() { this.requireOpen(); return this.open(); }
  async inspect() { this.requireOpen(); return { elements: [{ id: '1' }], state }; }
  async switchTab(_pageId: string, pagesId?: string) {
    this.requireOpen();
    if (!pagesId) throw new Error('page_id is ambiguous; provide pages_id.');
    return state;
  }
  async selectElement() { this.requireOpen(); return { found: true, state }; }
  async scroll() { this.requireOpen(); return { state }; }
  async capture() { this.requireOpen(); return png; }
  async screenshot() { this.requireOpen(); return png; }
  async close() { this.opened = false; return { closed: true as const }; }
}

async function connected(fake = new FakeController()) {
  const server = createMcpServer(fake as unknown as ViewerController);
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, fake };
}

test('advertises all tool schemas and read-only annotations', async (t) => {
  const { client, server } = await connected();
  t.after(async () => { await client.close(); await server.close(); });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), [
    'open_preview', 'reload_preview', 'inspect_preview', 'switch_tab',
    'select_element', 'scroll_preview', 'capture_preview', 'close_preview',
  ]);
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
  }
});

test('visual navigation results contain structured text and PNG blocks', async (t) => {
  const { client, server } = await connected();
  t.after(async () => { await client.close(); await server.close(); });
  const opened = await client.callTool({ name: 'open_preview', arguments: { path: 'Form.xml' } });
  assert.equal(opened.isError, undefined);
  assert.equal(opened.content[0].type, 'text');
  assert.equal(opened.content[1].type, 'image');
  if (opened.content[1].type === 'image') {
    assert.equal(opened.content[1].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(opened.content[1].data, 'base64'), png);
  }
  assert.equal((opened.structuredContent as { state: { format: string } }).state.format, 'form');
});

test('tool failures are returned as MCP errors for missing sessions and ambiguous page IDs', async (t) => {
  const { client, server } = await connected();
  t.after(async () => { await client.close(); await server.close(); });
  const missing = await client.callTool({ name: 'reload_preview', arguments: {} });
  assert.equal(missing.isError, true);
  assert.match((missing.content[0] as { text: string }).text, /No preview is open/);

  await client.callTool({ name: 'open_preview', arguments: { path: 'Form.xml' } });
  const ambiguous = await client.callTool({ name: 'switch_tab', arguments: { page_id: 'same' } });
  assert.equal(ambiguous.isError, true);
  assert.match((ambiguous.content[0] as { text: string }).text, /ambiguous/);
});

