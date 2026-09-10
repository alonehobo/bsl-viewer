import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadMxlPreview() {
  const code = fs.readFileSync(path.join(root, 'web', 'mxl-preview.js'), 'utf8');
  const sandbox = { window: {}, navigator: { language: 'ru-RU' } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.MxlPreview;
}

const MP = loadMxlPreview();
const T = MP._test;

function readMxl(name) {
  return fs.readFileSync(path.join(root, 'testdata', name));
}

function readMxlText(name) {
  return readMxl(name).toString('utf8');
}

test('detect: MOXCEL header and body, not XML', () => {
  assert.equal(MP.detect('not a spreadsheet'), false);
  assert.equal(MP.detect('<?xml version="1.0"?><document xmlns="http://v8.1c.ru/8.2/data/spreadsheet"/>'), false);
  const text = readMxlText('mxl-text-placement.mxl');
  assert.equal(text.slice(0, 6), 'MOXCEL');
  assert.equal(MP.detect(text), true);
  const body = T.stripHeader(text);
  assert.equal(body.charAt(0), '{');
  assert.equal(MP.detect(body), true);
});

test('rejects 1C 7.7 binary MOXCEL', () => {
  const buf = Buffer.concat([
    Buffer.from('MOXCEL'),
    Buffer.from([0, 0, 0, 0, 0, 7, 0]),
    Buffer.alloc(16)
  ]);
  const text = buf.toString('binary');
  assert.equal(T.isV77(text), true);
  const parsed = MP.parse(text);
  assert.ok(parsed.error && parsed.error.includes('7.7'));
});

test('lexer: strings, nesting, doubled quotes', () => {
  const v = T.parseBody('{8,1,9,{"a""b",-5},00000000-0000-0000-0000-000000000000}');
  const root = v[0].v;
  assert.equal(root[0].t, 'n');
  assert.equal(root[0].v, 8);
  assert.equal(root[3].v[0].v, 'a"b');
  assert.equal(root[3].v[1].v, -5);
  assert.equal(root[4].t, 'a');
});

test('mxl-text-placement.mxl parses into a grid model', () => {
  const parsed = MP.parse(readMxlText('mxl-text-placement.mxl'));
  assert.equal(parsed.error, undefined, parsed.error);
  const m = parsed.model;
  assert.ok(m.height >= 1);
  assert.ok(m.rows.length === m.height);
  assert.ok(m.formats.length >= 1);
  assert.ok(m.fonts.length >= 1);
  assert.ok(m.columnSetById['']);
  const texts = [];
  for (const row of m.rows) {
    for (const cell of row.cells) {
      if (cell.text) texts.push(cell.text);
    }
  }
  assert.ok(texts.length >= 4, 'too few cells with text: ' + texts.length);
});

test('mxl-capabilities.mxl: colors, title, vertical text', () => {
  const parsed = MP.parse(readMxlText('mxl-capabilities.mxl'));
  assert.equal(parsed.error, undefined, parsed.error);
  const doc = parsed.doc;
  assert.equal(doc.rows.length, 30);
  assert.ok(doc.colors.length >= 70, 'colors: ' + doc.colors.length);
  const title = doc.rows.find((r) => r.index === 0);
  assert.ok(title);
  const titleFmt = doc.formats[title.cells[0].format - 1];
  assert.equal(doc.colors[titleFmt.text_color].rgb, '#ffffff');
  assert.equal(doc.colors[titleFmt.bg_color].rgb, '#1f4e79');
  const palette = doc.rows.find((r) => r.index === 4);
  const redFmt = doc.formats[palette.cells[0].format - 1];
  assert.equal(doc.colors[redFmt.bg_color].rgb, '#ff0000');
  const row27 = doc.rows.find((r) => r.index === 27);
  const vertical = row27.cells.map((c) => doc.formats[c.format - 1]).find((f) => f && f.orientation === 900);
  assert.ok(vertical, 'no format with orientation 900');
  assert.ok(doc.fonts.some((f) => f.strikeout));
  assert.equal(doc.formats[title.format - 1].height, 120);
  const model = parsed.model;
  assert.equal(model.formats[title.cells[0].format - 1].textColor, '#ffffff');
  assert.equal(model.formats[title.cells[0].format - 1].backColor, '#1f4e79');
});

test('mxl-borders-merges.mxl: merges and line table', () => {
  const parsed = MP.parse(readMxlText('mxl-borders-merges.mxl'));
  assert.equal(parsed.error, undefined, parsed.error);
  assert.ok(parsed.doc.merges.length >= 1, 'no merges');
  assert.ok(parsed.doc.lines.length >= 1, 'no lines');
  assert.ok(parsed.model.merges.length >= 1);
  const m = parsed.model.merges[0];
  assert.ok(m.w >= 0 && m.h >= 0);
});

test('mxl-patterns-drawings.mxl: patterns, picture, drawings', () => {
  const parsed = MP.parse(readMxlText('mxl-patterns-drawings.mxl'));
  assert.equal(parsed.error, undefined, parsed.error);
  const doc = parsed.doc;
  const patterns = [];
  for (const row of doc.rows) {
    if (row.index >= 4 && row.index <= 7) {
      for (const cell of row.cells) {
        const fmt = doc.formats[cell.format - 1];
        patterns.push(fmt.pattern);
        assert.ok(fmt.pattern_color != null);
      }
    }
  }
  const expected = [255, 0].concat(Array.from({ length: 17 }, (_, i) => i + 1));
  assert.deepEqual(patterns, expected);
  assert.equal(doc.drawings.length, 4);
  assert.equal(doc.drawings.map((d) => d.kind).join(','), 'Picture,Text,Rectangle,Other');
  assert.equal(doc.pictures.length, 1);
  const pic = Buffer.from(doc.pictures[0], 'base64');
  assert.deepEqual([...pic.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(doc.drawings[0].picture, 1);
  assert.ok(String(doc.drawings[1].text || '').includes('Текстовый'));
  assert.equal(parsed.model.pictures[0].mime, 'image/png');
  assert.ok(parsed.model.pictures[0].data.length > 20);
});

test('height 0 in MXL becomes auto in the preview model', () => {
  const fmt = T.convertFormat({ height: 0 }, { colors: [] });
  assert.equal(fmt.height, '-45');
  const fmt2 = T.convertFormat({ height: 120 }, { colors: [] });
  assert.equal(Number(fmt2.height), Math.round(120 * 254 / 288));
  const fmt3 = T.convertFormat({ height: -92 }, { colors: [] });
  assert.equal(fmt3.height, '-92');
});

test('localized string takes ru from {n, langs, pairs}', () => {
  const loc = T.parseBody('{1,2,{"ru","Универсальный"},{"en","Universal"}}')[0].v;
  assert.equal(T.localizedText(loc), 'Универсальный');
  const cell = T.cellFromValue(T.parseBody('{16,1,{1,2,{"ru","Универсальный"},{"en","X"}}}')[0].v);
  assert.equal(cell.text, 'Универсальный');
});

test('named items: nested Rows range and drawing', () => {
  const v = T.parseBody('{2,"Шапка",{1,{1,-1,1,-1,10,f01e015f-e43b-412e-b84b-633884f6d03c},0},"КартинкаШтрихкода",{2,14,0}}')[0];
  const items = T.namedItemsFromValue(v);
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'Шапка');
  assert.equal(items[0].type, 'Rows');
  assert.equal(items[0].beginRow, 1);
  assert.equal(items[0].endRow, 10);
  assert.equal(items[0].columnsID, 'f01e015f-e43b-412e-b84b-633884f6d03c');
  assert.equal(items[1].kind, 'drawing');
  assert.equal(items[1].drawingID, 14);
});

test('cell marker bit 8 is detailParameter and does not steal localized text', () => {
  const cell = T.cellFromValue(T.parseBody('{24,101,"Товар",{1,1,{"","ТоварКод"}},0}')[0].v);
  assert.equal(cell.text, 'ТоварКод');
  assert.equal(cell.detailParameter, 'Товар');
  const plain = T.cellFromValue(T.parseBody('{16,103,{1,1,{"","ТоварНаименование"}},0}')[0].v);
  assert.equal(plain.text, 'ТоварНаименование');
});

test('format bit 15 is fillType Parameter/Template/Text', () => {
  const param = T.formatFromValue(T.parseBody('{50129,0,2,-92,124,6,8,3,1}')[0].v);
  assert.equal(param.fillType, 'Parameter');
  assert.equal(param.height, -92);
  const text = T.formatFromValue(T.parseBody('{50113,0,-92,32,6,8,3,0}')[0].v);
  assert.equal(text.fillType, 'Text');
  const tpl = T.formatFromValue(T.parseBody('{33153,3,339,2,2}')[0].v);
  assert.equal(tpl.fillType, 'Template');
});

test('UPD MXL: named areas, title, parameters, barcode', () => {
  const parsed = MP.parse(readMxlText('upd.mxl'));
  assert.equal(parsed.error, undefined, parsed.error);
  const m = parsed.model;
  const shapka = m.namedItems.find((it) => it.name === 'Шапка');
  assert.ok(shapka, 'no Шапка');
  assert.equal(shapka.beginRow, 1);
  assert.equal(shapka.endRow, 10);
  assert.equal(shapka.columnsID, 'f01e015f-de4c-4f97-9fbe-a244c4c30c6c');
  const texts = [];
  const params = [];
  for (const row of m.rows) {
    for (const cell of row.cells) {
      if (cell.text) texts.push(cell.text);
      if (cell.parameter) params.push(cell.parameter);
    }
  }
  assert.ok(texts.some((t) => String(t).includes('Универсальный')), 'title missing');
  assert.ok(params.includes('Номер'));
  assert.ok(params.includes('ТоварНаименование'));
  assert.ok(params.includes('ТоварКод'), 'ТоварКод lost: marker 24 / detailParameter');
  assert.ok(params.includes('ПредставлениеПоставщика'));
  assert.ok(params.includes('ФИОРуководителя'));
  assert.ok(params.includes('ПредставлениеГТД'));
  assert.ok(!params.includes('от'), 'static «от» must not become a parameter');
  assert.equal(m.rows[1].columnsID, shapka.columnsID);
  const barcode = m.drawings.find((d) => d.pictureIndex === 2);
  assert.ok(barcode, 'no barcode drawing');
  assert.equal(barcode.beginRow, 1);
  assert.equal(barcode.beginColumn, 10);
  assert.ok(m.pictures.some((p) => p.data && p.data.length > 20));
  const colMerge = m.merges.find((x) => x.r === -1 && x.c === 2 && x.w === 5);
  assert.ok(colMerge, 'column-wide merge cols 2-7 missing');
  assert.equal(colMerge.columnsID, '39a7acbe-e43b-412e-b84b-633884f6d03c');
  const unmergeStroka = m.unmerges.find((x) => x.r === 17 && x.c === 2);
  assert.ok(unmergeStroka, 'Строка must unmerge cols 2-7');
});

test('columnMergesFromValue reads r=-1 records with columns GUID', () => {
  const v = T.parseBody('{2,{2,-1,7,-1,0,39a7acbe-e43b-412e-b84b-633884f6d03c},{6,-1,11,-1,0,f01e015f-de4c-4f97-9fbe-a244c4c30c6c}}')[0];
  const items = T.columnMergesFromValue(v);
  assert.equal(items.length, 2);
  assert.equal(items[0].left, 2);
  assert.equal(items[0].right, 7);
  assert.equal(items[0].columnsID, '39a7acbe-e43b-412e-b84b-633884f6d03c');
  const packed = T.mergesFromValue(T.parseBody('{2,{2,17,7,17,2},{16,19,17,19,0}}')[0]);
  assert.equal(packed.unmerges.length, 1);
  assert.equal(packed.unmerges[0].top, 17);
  assert.equal(packed.merges.length, 1);
  assert.equal(packed.merges[0].top, 19);
});

test('unknown MOXCEL variant is rejected instead of parsed as noise', () => {
  const good = readMxlText('mxl-capabilities.mxl');
  assert.equal(T.isUnknownMoxcel(good), false);
  // versionHigh 9 instead of 8
  const bad = 'MOXCEL\u0000\u0009\u0000\u0001\u0000\u000c\u0000\uFEFF{8,1,9}';
  assert.equal(T.isUnknownMoxcel(bad), true);
  const parsed = MP.parse(bad);
  assert.ok(parsed.error && parsed.error.includes('неизвестный вариант'));
  // a headerless body (what the tests and the viewer pass around) still parses
  assert.equal(T.isUnknownMoxcel(T.stripHeader(good)), false);
});

test('pattern and background are two layers, border colour survives', () => {
  const doc = {
    colors: [{ rgb: '#ff0000' }, { rgb: '#00ff00' }, { rgb: '#0000ff' }]
  };
  const solid = T.convertFormat({ pattern: 0, pattern_color: 1, bg_color: 0 }, doc);
  assert.equal(solid.backColor, '#ff0000');
  assert.equal(solid.pattern, '0');
  assert.equal(solid.patternColor, '#00ff00');
  const hatch = T.convertFormat({ pattern: 7, pattern_color: 2, bg_color: 0 }, doc);
  assert.equal(hatch.backColor, '#ff0000', 'background must survive under a hatch');
  assert.equal(hatch.pattern, '7');
  assert.equal(hatch.patternColor, '#0000ff');
  // no pattern colour means no pattern at all
  assert.equal(T.convertFormat({ pattern: 3 }, doc).pattern, undefined);
  assert.equal(T.convertFormat({ pattern: 255, pattern_color: 1 }, doc).pattern, undefined);
  assert.equal(T.convertFormat({ borders_color: 2 }, doc).bordersColor, '#0000ff');
});

test('a graphic object keeps its caption, its frame index and the default alignment', () => {
  const parsed = MP.parse(readMxlText('mxl-patterns-drawings.mxl'));
  assert.ok(!parsed.error, parsed.error);
  const m = parsed.model;
  assert.equal(m.defaults.verticalAlignment, 'Bottom');
  const caption = m.drawings.find((d) => d.drawingType === 'Text');
  assert.ok(caption, 'no text drawing');
  assert.ok(caption.text.includes('Текстовый рисунок'));
  const rect = m.drawings.find((d) => d.drawingType === 'Rectangle');
  assert.equal(rect.text, 'Прямоугольник');
  assert.ok(m.drawings.some((d) => d.drawingType === 'Other'), 'Other kind must reach the model');
  const framed = T.convertFormat({ border_left: 3, border_bottom: 4 }, { colors: [] });
  assert.equal(framed.drawingBorder, '3');
  assert.equal(T.convertFormat({ border_bottom: 4 }, { colors: [] }).drawingBorder, '4');
  assert.equal(T.convertFormat({}, { colors: [] }).drawingBorder, undefined);
});

test('the grid grows with merges, extra groups leave undefined columns out', () => {
  const parsed = MP.parse(readMxlText('mxl-borders-merges.mxl'));
  const bottom = Math.max(...parsed.doc.merges.map((x) => x.bottom));
  assert.ok(parsed.model.height > bottom, 'a merge must not fall outside the grid');
  // An extra group is its own band: a column it never defines is simply not
  // there, or the band inflates with phantom columns on the right. The default
  // group describes the whole sheet, so it keeps the fallback width — and so
  // does any column that actually carries a cell.
  const group = { id: 'g', columns: [{ col: 0, format: 1 }] };
  const formats = [{ width: '40' }];
  const extra = T.convertColumnSet('g', group, formats, 3, false, null);
  assert.equal(extra.size, 3);
  assert.equal(extra.widths[0], 40 * 7 / 8);
  assert.equal(extra.widths[1], 0);
  assert.equal(extra.widths[2], 0);
  const held = T.convertColumnSet('g', group, formats, 3, false, { 2: true });
  assert.equal(held.widths[1], 0);
  assert.ok(held.widths[2] > 0, 'a column with a cell in it must stay visible');
  const def = T.convertColumnSet('', group, formats, 3, true, null);
  assert.ok(def.widths[1] > 0 && def.widths[2] > 0);
});
