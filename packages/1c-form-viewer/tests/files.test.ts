import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeText, FileLoader } from '../src/files.js';

async function sandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), '1c-form-viewer-'));
}

test('decodes UTF-8 BOM, UTF-16 LE/BE and Windows-1251', () => {
  assert.deepEqual(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), { content: 'A', encoding: 'utf8-bom' });
  assert.deepEqual(decodeText(Uint8Array.from([0xff, 0xfe, 0x10, 0x04])), { content: 'А', encoding: 'utf16le' });
  assert.deepEqual(decodeText(Uint8Array.from([0xfe, 0xff, 0x04, 0x10])), { content: 'А', encoding: 'utf16be' });
  const cp1251 = Uint8Array.from([0x3c, 0x78, 0x3e, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x3c, 0x2f, 0x78, 0x3e]);
  assert.deepEqual(decodeText(cp1251), { content: '<x>Привет</x>', encoding: 'windows-1251' });
});

test('resolves a form descriptor and loads object metadata', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const forms = path.join(root, 'Catalogs', 'Products', 'Forms');
  const actual = path.join(forms, 'Card', 'Ext', 'Form.xml');
  await fs.mkdir(path.dirname(actual), { recursive: true });
  await fs.writeFile(path.join(forms, 'Card.xml'), '<FormDescriptor/>');
  await fs.writeFile(actual, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  await fs.writeFile(path.join(root, 'Catalogs', 'Products.xml'), '<MetaDataObject/>');

  const loader = await FileLoader.create([root], 1024 * 1024);
  const loaded = await loader.load(path.join(forms, 'Card.xml'));
  assert.equal(loaded.resolvedPath, await fs.realpath(actual));
  assert.match(loaded.content, /xcf\/logform/);
  assert.equal(loaded.objectMeta, '<MetaDataObject/>');
});

test('rejects traversal, directories, unsupported files and oversized files', async (t) => {
  const base = await sandbox();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'allowed');
  await fs.mkdir(root);
  const outside = path.join(base, 'outside.xml');
  await fs.writeFile(outside, '<Form/>');
  await fs.writeFile(path.join(root, 'large.xml'), '12345');
  await fs.writeFile(path.join(root, 'note.txt'), 'hello');
  const loader = await FileLoader.create([root], 4);

  await assert.rejects(loader.load(outside), /outside the allowed roots/);
  await assert.rejects(loader.load(root), /not a file/);
  await assert.rejects(loader.load(path.join(root, 'large.xml')), /limit is 4/);
  const normalLoader = await FileLoader.create([root], 1024);
  await assert.rejects(normalLoader.load(path.join(root, 'note.txt')), /Unsupported file extension/);
});

test('rejects a symlink that escapes an allowed root', async (t) => {
  const base = await sandbox();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'allowed');
  const outsideDirectory = path.join(base, 'outside');
  const outside = path.join(outsideDirectory, 'escape.xml');
  await fs.mkdir(root);
  await fs.mkdir(outsideDirectory);
  await fs.writeFile(outside, '<Form/>');
  const link = path.join(root, 'junction');
  await fs.symlink(outsideDirectory, link, process.platform === 'win32' ? 'junction' : 'dir');
  const loader = await FileLoader.create([root], 1024);
  await assert.rejects(loader.load(path.join(link, 'escape.xml')), /outside the allowed roots/);
});

test('opens a form when optional object metadata is outside the allowed root', async (t) => {
  const base = await sandbox();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const forms = path.join(base, 'Object', 'Forms');
  const actual = path.join(forms, 'Card', 'Ext', 'Form.xml');
  await fs.mkdir(path.dirname(actual), { recursive: true });
  await fs.writeFile(actual, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  const loader = await FileLoader.create([forms], 1024);
  const loaded = await loader.load(actual);
  assert.equal(loaded.objectMeta, '');
});
