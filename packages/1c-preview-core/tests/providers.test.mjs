import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { browserAssets, browserPath, nodeFiles, scripts, styles, sprite } from '../manifest.mjs';

/* The registry only ever asks a renderer whether it claims some content, so a
 * stub per module is enough to pin the claiming rules themselves. */
function load(stubs) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  Object.assign(sandbox, stubs);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(browserPath('providers.js'), 'utf8'), sandbox);
  return sandbox.PreviewProviders;
}

const claims = (id) => ({
  detect: (content) => content === id,
  parse: (content, meta) => ({ model: { content, meta } }),
});

const all = {
  FormPreview: claims('form'),
  MxlPreview: claims('mxl'),
  TemplatePreview: claims('template'),
};

test('every entry names both modules, a label and its chrome', () => {
  const providers = load(all);
  assert.deepEqual(Array.from(providers.list, (p) => p.id), ['form', 'mxl', 'template']);
  for (const entry of providers.list) {
    assert.ok(entry.parser && entry.viewer, `${entry.id} names both modules`);
    assert.ok(entry.label, `${entry.id} has a label`);
    assert.ok(entry.rootCls && entry.emptyCls && entry.emptyMsg, `${entry.id} has an empty state`);
    assert.ok(entry.outlineTitle && entry.sourceTitle, `${entry.id} has button titles`);
  }
});

/* An .mxl is decoded by MxlPreview and drawn by TemplatePreview: the one place
 * that coupling is written down. */
test('mxl parses through MxlPreview and renders through TemplatePreview', () => {
  const providers = load(all);
  const mxl = providers.byId('mxl');
  assert.equal(mxl.parser, 'MxlPreview');
  assert.equal(mxl.viewer, 'TemplatePreview');
  assert.equal(providers.view(mxl), all.TemplatePreview);
});

test('a provider is unusable until both its modules are on the page', () => {
  const providers = load({ FormPreview: all.FormPreview });
  assert.ok(providers.ready(providers.byId('form')));
  assert.ok(!providers.ready(providers.byId('mxl')));
  assert.equal(providers.detect('mxl', {}), null, 'a half-loaded provider claims nothing');
});

test('detection order puts a managed form ahead of plain XML', () => {
  const providers = load({
    FormPreview: { detect: () => true, parse: () => ({ model: {} }) },
    MxlPreview: claims('mxl'),
    TemplatePreview: { detect: () => true, parse: () => ({ model: {} }) },
  });
  assert.equal(providers.detect('<Form/>', {}).id, 'form');
});

test('a host that knows the language keeps a form from claiming non-XML', () => {
  const providers = load(all);
  assert.equal(providers.detect('form', { language: 'xml' }).id, 'form');
  assert.equal(providers.detect('form', { language: 'markdown' }), null);
  /* A host that has no notion of language is not filtered. */
  assert.equal(providers.detect('form', {}).id, 'form');
  assert.equal(providers.detect('mxl', { language: 'markdown' }).id, 'mxl', 'only the form provider is gated');
});

test('unrecognised content is claimed by nobody', () => {
  const providers = load(all);
  assert.equal(providers.detect('/* just code */', {}), null);
  assert.ok(providers.unsupportedMessage);
});

/* FormPreview.parse takes the owning object's metadata; the others take
 * content only, and must not be handed a stray second argument. */
test('only the form provider is given object metadata', () => {
  const providers = load(all);
  const form = providers.parse(providers.byId('form'), 'form', { objectMeta: '<MetaDataObject/>' });
  assert.equal(form.model.meta, '<MetaDataObject/>');
  const template = providers.parse(providers.byId('template'), 'template', { objectMeta: '<MetaDataObject/>' });
  assert.equal(template.model.meta, undefined);
  const withoutContext = providers.parse(providers.byId('form'), 'form');
  assert.equal(withoutContext.model.meta, '');
});

test('the manifest lists files that exist, and providers.js loads last', () => {
  assert.equal(scripts[0], 'xml-util.js', 'renderers alias XmlUtil at load time');
  assert.equal(scripts[scripts.length - 1], 'providers.js');
  for (const name of browserAssets) assert.ok(fs.existsSync(browserPath(name)), `${name} exists`);
  assert.ok(fs.existsSync(browserPath(sprite)), 'the icon sprite exists');
  assert.deepEqual(styles, ['viewer.css']);
  for (const name of nodeFiles) {
    assert.ok(fs.existsSync(path.join(path.dirname(browserPath('x')), '..', 'node', name)), `${name} exists`);
  }
});
