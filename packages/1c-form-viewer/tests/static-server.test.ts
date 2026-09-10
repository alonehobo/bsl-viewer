import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StaticAssetServer } from '../src/static-server.js';

test('asset server binds loopback, serves only tokenized static files and disables caching', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-assets-'));
  const server = new StaticAssetServer(root);
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>ok</title>');
  const url = await server.start();
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(await response.text(), /<title>ok<\/title>/);
  const denied = await fetch(new URL('/index.html', url));
  assert.equal(denied.status, 404);
});

test('asset server exposes only the current preview to the tokenized internal URL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-assets-state-'));
  const server = new StaticAssetServer(root);
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>ok</title>');
  const url = await server.start();
  const before = await fetch(new URL('state.json', url));
  assert.equal(before.status, 404);
  server.setDocument({ resolvedPath: 'C:\\root\\Form.xml', content: '<Form/>', objectMeta: '' });
  const internalUrl = server.internalUrl();
  const internal = await fetch(internalUrl);
  assert.match(internal.url, /[?&]internal=1/);
  const state = await fetch(new URL('state.json', internalUrl));
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), {
    revision: 1,
    path: 'C:\\root\\Form.xml',
    content: '<Form/>',
    objectMeta: '',
  });
  const meta = await fetch(new URL('state-meta.json', internalUrl));
  assert.deepEqual(await meta.json(), { revision: 1, available: true });
});
