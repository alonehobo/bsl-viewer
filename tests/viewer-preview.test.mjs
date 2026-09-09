/* Tests for the preview-provider registry in web/viewer.js: which module claims
 * a file, which module draws it, and the per-provider chrome flags. Everything
 * else in viewer.js needs Monaco and a real DOM; this part does not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules, parseXmlDom } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* viewer.js ends by appending Monaco's loader script; in this stub its onload
 * never fires, so the module's functions are defined and nothing else runs. */
function stubDom() {
  const noop = () => {};
  const element = () => ({
    style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, addEventListener: noop,
    appendChild: noop, querySelector: () => null, querySelectorAll: () => [],
    textContent: '', innerHTML: '', children: []
  });
  return {
    location: { hostname: 'bslview.invalid' },
    localStorage: { getItem: () => null, setItem: noop },
    addEventListener: noop,
    document: {
      head: { appendChild: noop },
      body: element(),
      createElement: element,
      getElementById: element,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop
    },
    DOMParser: function DOMParser() {
      this.parseFromString = (xml) => parseXmlDom(xml);
    }
  };
}

function loadViewer() {
  const sandbox = loadWebModules(
    root,
    ['xml-util.js', 'bsl-format.js', 'form-preview.js', 'template-preview.js', 'mxl-preview.js', 'viewer.js'],
    stubDom()
  );
  return sandbox.window.ViewerInternals;
}

const V = loadViewer();

function read(name) {
  return fs.readFileSync(path.join(root, 'testdata', name), 'utf8');
}

/* detect() for the form provider consults state.language, so set it the way
 * applyLoad would before asking. */
function detectAs(language, content) {
  V.state.language = language;
  return V.detectProvider(content);
}

function select(id) {
  V.state.previewId = id;
}

test('form preview toggle uses a window icon instead of the edit-mode eye', () => {
  const html = fs.readFileSync(path.join(root, 'web', 'viewer.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  assert.match(html, /<symbol id="i-window"/);
  assert.match(html, /id="btn-preview"[^>]*>[\s\S]*?<use href="#i-window">/);
  assert.match(js, /setIcon\('btn-preview', state\.previewMode \? 'code' : 'window'\)/);
});

// --- registry shape --------------------------------------------------------

test('every provider names a parser and a viewer module and its chrome', () => {
  assert.ok(V.providers.length >= 3);
  for (const p of V.providers) {
    assert.ok(p.id, 'provider has an id');
    assert.equal(typeof p.detect, 'function');
    assert.equal(typeof p.parse, 'function');
    assert.ok(p.parser && p.viewer, `${p.id} names both modules`);
    assert.ok(p.rootCls && p.emptyCls && p.emptyMsg, `${p.id} has an empty-state`);
    assert.ok(p.outlineTitle && p.sourceTitle, `${p.id} has button titles`);
  }
});

test('provider ids are unique and lookup finds them', () => {
  const ids = V.providers.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(V.providerById(id).id, id);
  assert.equal(V.providerById('nope'), null);
});

/* This is the coupling that used to be implicit: an .mxl file is decoded by
 * MxlPreview but drawn by TemplatePreview, because both build the same model. */
test('mxl parses through MxlPreview and renders through TemplatePreview', () => {
  const mxl = V.providerById('mxl');
  assert.equal(mxl.parser, 'MxlPreview');
  assert.equal(mxl.viewer, 'TemplatePreview');
});

// --- detection -------------------------------------------------------------

test('a managed form is claimed by the form provider', () => {
  assert.equal(detectAs('xml', read('Форма.xml')).id, 'form');
});

test('a spreadsheet template is claimed by the template provider', () => {
  assert.equal(detectAs('xml', read('Template.xml')).id, 'template');
});

test('a binary MXL is claimed by the mxl provider', () => {
  const mxl = fs.readFileSync(path.join(root, 'testdata', 'mxl-capabilities.mxl')).toString('utf8');
  assert.equal(detectAs('plaintext', mxl).id, 'mxl');
});

/* Order matters: a form is also well-formed XML, and only the form provider
 * gates on the language being xml. */
test('form detection wins over template for the same content', () => {
  const form = read('Форма.xml');
  assert.equal(V.providers.findIndex((p) => p.id === 'form'), 0);
  assert.equal(detectAs('xml', form).id, 'form');
});

test('a form is not claimed when the language is not xml', () => {
  assert.equal(detectAs('bsl', read('Форма.xml')), null);
});

test('ordinary source and markup are claimed by nobody', () => {
  assert.equal(detectAs('bsl', 'Процедура П()\nКонецПроцедуры'), null);
  assert.equal(detectAs('markdown', '# Заголовок\n\nтекст'), null);
  assert.equal(detectAs('xml', '<?xml version="1.0"?><Catalog><Name>Товары</Name></Catalog>'), null);
  assert.equal(detectAs('plaintext', ''), null);
});

// --- state derived from the active provider --------------------------------

test('no provider means no document preview', () => {
  select('');
  assert.equal(V.currentProvider(), null);
  assert.equal(V.isDocPreview(), false);
  assert.equal(V.isFormView(), false);
  assert.equal(V.docTree(), false);
  assert.equal(V.previewView(), null);
});

test('an unknown provider id degrades to no preview', () => {
  select('does-not-exist');
  assert.equal(V.currentProvider(), null);
  assert.equal(V.isDocPreview(), false);
});

test('the form provider drives the form-only chrome', () => {
  select('form');
  assert.equal(V.isDocPreview(), true);
  assert.equal(V.isFormView(), true);
  assert.equal(V.docTree(), true, 'form outline is a collapsible tree');
  const view = V.previewView();
  assert.ok(view.render && view.outline && view.itemKey, 'form view module is complete');
  assert.ok(view.outlineExpandTo && view.outlineCollapseAll, 'form view can fold its tree');
});

test('spreadsheet providers are document views, not form views', () => {
  for (const id of ['template', 'mxl']) {
    select(id);
    assert.equal(V.isDocPreview(), true, `${id} is a document preview`);
    assert.equal(V.isFormView(), false, `${id} is not a form`);
    assert.equal(V.docTree(), false, `${id} outline is flat`);
    assert.ok(V.previewView().render, `${id} view module can render`);
  }
});

/* A form mockup stands in for the real 1C window, so it forces light chrome;
 * a template is an ordinary document and follows the user's theme. */
test('only the form provider forces light chrome while previewing', () => {
  V.state.isDark = true;

  select('form');
  V.state.previewMode = true;
  assert.equal(V.formPreviewOpen(), true);
  assert.equal(V.uiIsDark(), false);

  V.state.previewMode = false;
  assert.equal(V.formPreviewOpen(), false, 'closed preview does not force light');
  assert.equal(V.uiIsDark(), true);

  select('template');
  V.state.previewMode = true;
  assert.equal(V.formPreviewOpen(), false);
  assert.equal(V.uiIsDark(), true, 'a template keeps the dark theme');

  V.state.isDark = false;
  V.state.previewMode = false;
});

test('canPreviewLang covers markdown, html and any claimed document', () => {
  select('');
  V.state.language = 'bsl';
  assert.equal(V.canPreviewLang(), false);
  V.state.language = 'markdown';
  assert.equal(V.canPreviewLang(), true);
  V.state.language = 'html';
  assert.equal(V.canPreviewLang(), true);

  V.state.language = 'plaintext';
  select('mxl');
  assert.equal(V.canPreviewLang(), true, 'an mxl is plaintext but still previewable');
  select('');
});
