import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scripts, styles } from '1c-preview-core/manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const read = (...parts) => readFile(path.join(pkgDir, ...parts), 'utf8');

test('the manifest exposes the preview command and the supported file menus', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.main, 'extension.js');
  assert.equal(manifest.contributes.commands[0].command, '1cFormViewer.openPreview');
  assert.equal(manifest.contributes.menus.commandPalette[0].when, 'true');
  assert.equal(manifest.contributes.menus['editor/title'][0].command, '1cFormViewer.openPreview');
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /resourceExtname == \.xml/);
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /resourceExtname == \.mxl/);
});

/* vsce runs vscode:prepublish, not prepack. Without it a package can be cut
 * from whatever happens to be sitting in media/, which is how an extension
 * ships with renderers older than the core it was built from. */
test('packaging rebuilds the shared assets first', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.scripts['vscode:prepublish'], 'npm run build');
  assert.match(manifest.scripts.build, /sync/);
});

test('the webview loads exactly the shared assets, in the core load order', async () => {
  const assets = JSON.parse(await read('media', 'assets.json'));
  assert.deepEqual(assets.scripts, scripts);
  assert.deepEqual(assets.styles, styles);

  const extension = await read('extension.js');
  assert.match(extension, /assets\.scripts\s*$/m, 'script tags are generated from the manifest');
  assert.match(extension, /assets\.styles\s*$/m, 'style tags are generated from the manifest');
  for (const name of [...scripts, ...styles]) {
    assert.doesNotMatch(extension, new RegExp(`['"\`]${name.replace('.', '\.')}['"\`]`),
      `${name} must not be hardcoded in extension.js`);
  }
});

/* The renderers are shared, so the rules for claiming a file have to be too —
 * otherwise the same export opens in VS Code and refuses to open over MCP. */
test('the webview claims files through the shared provider registry', async () => {
  const webview = await read('ui', 'webview.js');
  assert.match(webview, /PreviewProviders\.detect\(/);
  assert.match(webview, /PreviewProviders\.parse\(/);
  assert.match(webview, /PreviewProviders\.view\(/);
  for (const global of ['FormPreview.detect', 'MxlPreview.detect', 'TemplatePreview.detect']) {
    assert.doesNotMatch(webview, new RegExp(global.replace('.', '\.')),
      `${global} must go through the shared registry`);
  }
});

/* Encodings, form descriptors and object metadata are 1C rules, not VS Code
 * rules; a second copy here is what let the extension drift from the MCP
 * server in the first place. */
test('file rules come from the shared core, not a second copy', async () => {
  const extension = await read('extension.js');
  assert.match(extension, /require\('\.\/core\/document\.cjs'\)/);
  assert.match(extension, /core\.decodeText\(/);
  assert.match(extension, /core\.objectMetaCandidates\(/);
  assert.match(extension, /core\.formLayoutFor\(/);
  assert.doesNotMatch(extension, /0xef|windows-1251|MetaDataObject/,
    'decoding and metadata rules must not be reimplemented here');
});

test('opening a form descriptor resolves to the layout the renderers want', async () => {
  const { formLayoutFor } = await import('1c-preview-core/node/document.cjs');
  const layout = formLayoutFor(path.join('C:', 'cfg', 'Catalogs', 'Товары', 'Forms', 'ФормаСписка.xml'));
  assert.equal(layout, path.join('C:', 'cfg', 'Catalogs', 'Товары', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml'));
  assert.equal(formLayoutFor(path.join('C:', 'cfg', 'Catalogs', 'Товары.xml')), '');

  const extension = await read('extension.js');
  assert.match(extension, /resolveDocumentUri/);
});

test('source content never reaches the webview as markup', async () => {
  const extension = await read('extension.js');
  const webview = await read('ui', 'webview.js');
  assert.match(extension, /postMessage\(\{\s*type: 'load'/);
  assert.doesNotMatch(extension, /innerHTML\s*=\s*.*content/);
  assert.match(webview, /textContent =/);
  assert.match(extension, /id="preview-root"/);
  assert.match(webview, /getElementById\('preview-root'\)/);
  assert.match(webview, /type: 'ready'/);
  assert.match(extension, /message\?\.type === 'ready'/);
});
