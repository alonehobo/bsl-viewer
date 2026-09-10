import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  decodeText,
  formLayoutFor,
  isSupportedExtension,
  objectMetaCandidates,
  SUPPORTED_EXTENSIONS,
} from '../node/document.cjs';

const cfg = path.join('C:', 'cfg', 'Catalogs', 'Товары');

test('BOMs decide the encoding', () => {
  assert.deepEqual(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), { content: 'A', encoding: 'utf8-bom' });
  assert.deepEqual(decodeText(Uint8Array.from([0xff, 0xfe, 0x10, 0x04])), { content: 'А', encoding: 'utf16le' });
  assert.deepEqual(decodeText(Uint8Array.from([0xfe, 0xff, 0x04, 0x10])), { content: 'А', encoding: 'utf16be' });
});

test('without a BOM, valid UTF-8 is UTF-8 and the rest is Windows-1251', () => {
  assert.deepEqual(decodeText(new TextEncoder().encode('<x>Привет</x>')), {
    content: '<x>Привет</x>',
    encoding: 'utf8',
  });
  const cp1251 = Uint8Array.from([0x3c, 0x78, 0x3e, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x3c, 0x2f, 0x78, 0x3e]);
  assert.deepEqual(decodeText(cp1251), { content: '<x>Привет</x>', encoding: 'windows-1251' });
});

/* An odd trailing byte must not throw: exports get truncated in the wild. */
test('a truncated UTF-16BE payload still decodes', () => {
  const { encoding } = decodeText(Uint8Array.from([0xfe, 0xff, 0x04, 0x10, 0x04]));
  assert.equal(encoding, 'utf16be');
});

test('a form descriptor resolves to its layout, and nothing else does', () => {
  assert.equal(
    formLayoutFor(path.join(cfg, 'Forms', 'ФормаСписка.xml')),
    path.join(cfg, 'Forms', 'ФормаСписка', 'Ext', 'Form.xml'),
  );
  assert.equal(formLayoutFor(path.join(cfg, 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')), '');
  assert.equal(formLayoutFor(path.join(cfg, 'Товары.xml')), '');
  assert.equal(formLayoutFor(path.join(cfg, 'Templates', 'Печать.xml')), '');
  assert.equal(formLayoutFor(path.join(cfg, 'Forms', 'Отчёт.mxl')), '');
});

test('object metadata is looked for in the two places 1C writes it', () => {
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Forms', 'Ф', 'Ext', 'Form.xml')), [
    path.join(path.dirname(cfg), 'Товары.xml'),
    path.join(cfg, 'Товары.xml'),
  ]);
});

test('only a real form layout has object metadata', () => {
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Forms', 'ФормаСписка.xml')), []);
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Ext', 'Form.xml')), []);
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Товары.xml')), []);
});

test('the supported extensions are the ones every host offers', () => {
  assert.deepEqual(SUPPORTED_EXTENSIONS, ['.xml', '.mxl']);
  assert.ok(isSupportedExtension('a/b/Form.XML'));
  assert.ok(isSupportedExtension('a/b/Печать.mxl'));
  assert.ok(!isSupportedExtension('a/b/Module.bsl'));
  assert.ok(!isSupportedExtension('a/b/README'));
});
