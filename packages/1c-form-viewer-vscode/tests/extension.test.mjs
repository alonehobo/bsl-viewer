import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');

test('VS Code manifest exposes the preview command and supported file menus', async () => {
  const manifest = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
  assert.equal(manifest.main, 'extension.js');
  assert.equal(manifest.version, '0.1.4');
  assert.equal(manifest.contributes.commands[0].command, '1cFormViewer.openPreview');
  assert.equal(manifest.contributes.menus.commandPalette[0].when, 'true');
  assert.equal(manifest.contributes.menus['editor/title'][0].command, '1cFormViewer.openPreview');
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /resourceExtname == \.xml/);
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /resourceExtname == \.mxl/);
});

test('webview keeps source content out of HTML and includes all shared renderers', async () => {
  const extension = await readFile(path.join(pkgDir, 'extension.js'), 'utf8');
  const webview = await readFile(path.join(pkgDir, 'ui', 'webview.js'), 'utf8');
  assert.match(extension, /postMessage\(\{\s*type: 'load'/);
  assert.doesNotMatch(extension, /innerHTML\s*=\s*.*content/);
  for (const asset of ['form-preview.js', 'template-preview.js', 'mxl-preview.js', 'viewer.css']) {
    assert.match(extension, new RegExp(asset.replace('.', '\\.'), 'u'));
  }
  assert.match(webview, /textContent =/);
  assert.match(webview, /FormPreview\.detect/);
  assert.match(webview, /MxlPreview\.detect/);
  assert.match(webview, /TemplatePreview\.detect/);
  assert.match(extension, /id="preview-root"/);
  assert.match(webview, /getElementById\('preview-root'\)/);
  assert.match(extension, /createStatusBarItem/);
  assert.match(extension, /1C Preview/);
  assert.match(webview, /type: 'ready'/);
  assert.match(extension, /message\?\.type === 'ready'/);
});
