import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTemplatePreview() {
  return loadWebModules(root, ['xml-util.js', 'template-preview.js']).window.TemplatePreview;
}

/* Render tests need a DOM stub too: `fakeNode` stands in for createElement. */
function loadRenderSandbox() {
  return loadWebModules(root, ['xml-util.js', 'template-preview.js'], {
    document: { createElement: fakeNode }
  });
}

const TP = loadTemplatePreview();
const T = TP._test;

const mini = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core"
          xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns>
    <size>3</size>
    <columnsItem>
      <index>0</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
    <columnsItem>
      <index>1</index>
      <column><formatIndex>2</formatIndex></column>
    </columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c>
        <c>
          <f>3</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>Заголовок</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
      <c>
        <c>
          <f>4</f>
          <parameter>Номер</parameter>
        </c>
      </c>
    </row>
  </rowsItem>
  <templateMode>true</templateMode>
  <height>2</height>
  <vgRows>2</vgRows>
  <merge>
    <r>0</r>
    <c>0</c>
    <w>1</w>
  </merge>
  <namedItem xsi:type="NamedItemCells">
    <name>Шапка</name>
    <area>
      <type>Rows</type>
      <beginRow>0</beginRow>
      <endRow>0</endRow>
      <beginColumn>-1</beginColumn>
      <endColumn>-1</endColumn>
    </area>
  </namedItem>
  <line width="1" gap="false">
    <v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style>
  </line>
  <font faceName="Arial" height="8" bold="false" italic="false" underline="false" strikeout="false" kind="Absolute" scale="100"/>
  <format><width>40</width></format>
  <format><width>120</width></format>
  <format>
    <font>0</font>
    <horizontalAlignment>Left</horizontalAlignment>
  </format>
  <format>
    <fillType>Parameter</fillType>
  </format>
</document>`;

const formXml = `<?xml version="1.0"?><Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems><InputField name="A"/></ChildItems></Form>`;

test('detects spreadsheet Template.xml and rejects Form.xml', () => {
  assert.equal(TP.detect(mini), true);
  assert.equal(TP.detect(formXml), false);
  assert.equal(TP.detect('<?xml version="1.0"?><Catalog/>'), false);
});

test('parses rows, parameters and named areas', () => {
  const parsed = TP.parse(mini);
  assert.ok(parsed.model, parsed.error);
  const m = parsed.model;
  assert.equal(m.height, 2);
  assert.equal(m.templateMode, true);
  assert.equal(m.namedItems.length, 1);
  assert.equal(m.namedItems[0].name, 'Шапка');
  assert.equal(m.namedItems[0].beginRow, 0);
  const cell0 = T.cellAt(m.rows[0], 0);
  const cell1 = T.cellAt(m.rows[0], 1);
  assert.equal(cell0.text, 'Заголовок');
  assert.equal(cell1.parameter, 'Номер');
  const fmtP = T.formatByIndex(m.formats, 4);
  assert.equal(T.displayText(cell1, fmtP), '<Номер>');
  assert.equal(T.isParamCell(cell1, fmtP), true);
  assert.equal(T.displayText(cell0, T.formatByIndex(m.formats, 3)), 'Заголовок');
});

test('column widths come from format palette (eighths of a character)', () => {
  const parsed = TP.parse(mini);
  const set = T.columnSetOf(parsed.model, '');
  assert.equal(set.size, 3);
  assert.ok(Math.abs(set.widths[0] - T.widthToPx(40)) < 0.01);
  assert.ok(Math.abs(set.widths[1] - T.widthToPx(120)) < 0.01);
  assert.ok(Math.abs(set.widths[2] - T.widthToPx(T.DEFAULT_WIDTH_U)) < 0.01);
});

test('merge origin covers extra columns', () => {
  const parsed = TP.parse(mini);
  const spans = T.buildSpans(parsed.model, 0, 2, '');
  assert.equal(spans.origin[0][0].rowspan, 1);
  assert.equal(spans.origin[0][0].colspan, 2);
  assert.equal(spans.covered[0][1], true);
  assert.equal(spans.covered[0][0], false);
});

test('outline lists named areas', () => {
  const parsed = TP.parse(mini);
  const items = TP.outline(parsed.model, mini);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Шапка');
  assert.equal(items[0].tag, 'TemplateArea');
  assert.ok(items[0].line >= 1);
});

test('itemKey prefers area name', () => {
  assert.equal(TP.itemKey({ name: 'Строка', row: 17 }), 'Строка');
  assert.equal(TP.itemKey({ row: 1, col: 2 }), 'r1c2');
});

test('outline icons differ for row vs column areas', () => {
  const row = TP.outlineIcon({ areaType: 'Rows' });
  const col = TP.outlineIcon({ areaType: 'Columns' });
  assert.equal(row.cls, 'icon-tpl-row');
  assert.equal(col.cls, 'icon-tpl-col');
  assert.notEqual(row.ch, col.ch);
  assert.equal(TP.outlineIcon({ type: 'Columns' }).cls, 'icon-tpl-col');
});

test('centerInScroll puts the target in the middle of the viewport', () => {
  const sc = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 2000,
    scrollWidth: 2000,
    getBoundingClientRect() { return { top: 0, left: 0, height: 200, width: 400 }; }
  };
  const rowHit = {
    getBoundingClientRect() { return { top: 500, left: 10, height: 40, width: 380 }; }
  };
  T.centerInScroll(sc, rowHit, 'v');
  assert.equal(sc.scrollTop, 420);
  assert.equal(sc.scrollLeft, 0);
  const colHit = {
    getBoundingClientRect() { return { top: 0, left: 800, height: 200, width: 40 }; }
  };
  T.centerInScroll(sc, colHit, 'h');
  assert.equal(sc.scrollLeft, 620);
});

function fakeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    children: [],
    parentNode: null,
    attributes: {},
    style: {},
    hidden: false,
    _text: '',
    classList: {
      add(c) {
        const parts = node.className.split(/\s+/).filter(Boolean);
        if (!parts.includes(c)) parts.push(c);
        node.className = parts.join(' ');
      },
      remove(c) {
        node.className = node.className.split(/\s+/).filter((x) => x && x !== c).join(' ');
      }
    },
    setAttribute(k, v) { node.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(node.attributes, k) ? node.attributes[k] : null; },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    addEventListener() {},
    getBoundingClientRect() { return { top: 0, left: 0, height: 0, width: 0 }; },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return walkMatch(node, sel); },
    closest(sel) {
      let cur = node;
      while (cur) {
        if (matchSel(cur, sel)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node._text || node.children.map((c) => c.textContent).join(''); },
    set(v) { node._text = String(v); node.children = []; }
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return ''; },
    set() { node.children = []; node._text = ''; }
  });
  return node;
}

function matchSel(node, sel) {
  const m = String(sel).trim().match(/^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:\[([^=\]]+)="([^"]*)"\])?$/);
  if (!m) return false;
  if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
  if (m[2] && !node.className.split(/\s+/).includes(m[2])) return false;
  if (m[3] && node.getAttribute(m[3]) !== m[4]) return false;
  return true;
}

function walkMatch(root, sel) {
  const out = [];
  function walk(n) {
    for (const c of n.children) {
      if (matchSel(c, sel)) out.push(c);
      walk(c);
    }
  }
  walk(root);
  return out;
}

function hasAncestorClass(node, cls) {
  let cur = node;
  while (cur) {
    if (cur.className && cur.className.split(/\s+/).includes(cls)) return true;
    cur = cur.parentNode;
  }
  return false;
}

test('row numbers live in a left gutter, not on the grid', () => {
  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  const parsed = sandbox.window.TemplatePreview.parse(mini);
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const rowhead = container.querySelector('.tp-rowhead');
  const wrap = container.querySelector('.tp-grid-wrap');
  const left = container.querySelector('.tp-left');
  const right = container.querySelector('.tp-right');
  assert.ok(rowhead, 'rowhead');
  assert.ok(wrap, 'grid wrap');
  assert.ok(left, 'left pane');
  assert.ok(right, 'right pane');
  assert.equal(hasAncestorClass(rowhead, 'tp-left'), true);
  assert.equal(hasAncestorClass(wrap, 'tp-right'), true);
  assert.equal(hasAncestorClass(rowhead, 'tp-grid-wrap'), false);
  assert.equal(left.querySelector('.tp-rowhead') != null, true);
  assert.equal(right.querySelector('.tp-rowhead') != null, false);
  assert.equal(container.querySelectorAll('.tp-colhead-bar').length, 1);
});

const updPath = path.join(root, 'testdata', 'Template.xml');

test('UPD Template.xml: areas, barcode drawing, parameter cells', () => {
  const xml = fs.readFileSync(updPath, 'utf8');
  assert.equal(TP.detect(xml), true);
  const parsed = TP.parse(xml);
  assert.ok(parsed.model, parsed.error);
  const m = parsed.model;
  assert.ok(m.height >= 50);
  const names = m.namedItems.filter((x) => x.kind === 'cells').map((x) => x.name);
  for (const need of ['Шапка', 'ЗаголовокТаблицы', 'Строка', 'Итого', 'Подвал', 'ПодвалНакладной', 'НумерацияЛистов']) {
    assert.ok(names.includes(need), 'missing area ' + need);
  }
  const sh = m.namedItems.find((x) => x.name === 'Шапка');
  assert.equal(sh.beginRow, 1);
  assert.equal(sh.endRow, 10);
  const barcode = m.namedItems.find((x) => x.name === 'КартинкаШтрихкода');
  assert.equal(barcode.kind, 'drawing');
  const draw = m.drawings.find((d) => d.id === barcode.drawingID);
  assert.ok(draw);
  assert.equal(draw.beginRow, 1);
  assert.ok(m.pictures.some((p) => p.data && p.data.indexOf('iVBORw') === 0));
  const barcodeUrl = T.pictureDataUrl(m, draw.pictureIndex);
  assert.ok(barcodeUrl.indexOf('data:image/png;base64,iVBORw') === 0);

  const row1 = m.rows[1];
  const texts = {};
  for (const c of row1.cells) {
    const fmt = T.formatByIndex(m.formats, c.formatIndex);
    texts[c.col] = T.displayText(c, fmt);
  }
  const joined = Object.values(texts).join(' | ');
  assert.match(joined, /Счет-фактура/);
  assert.match(joined, /<Номер>/);
  assert.match(joined, /<Дата>/);

  const groups = T.groupsOf(m);
  assert.ok(groups.length >= 3);
  const area = T.areaForRow(m, 17);
  assert.equal(area && area.name, 'Строка');
  const set = T.viewColumnSet(m);
  assert.ok(set.size >= 19);
  const gStroka = T.groupsOf(m).find((g) => g.start <= 17 && 17 < g.end);
  const header = m.namedItems.find((x) => x.name === 'ЗаголовокТаблицы');
  assert.ok(gStroka);
  assert.equal(gStroka.columnsID, header.columnsID);
  assert.ok(gStroka.start <= header.beginRow);
  assert.ok(gStroka.end > header.endRow);
});

test('pictureDataUrl maps 1-based drawing pictureIndex onto 0-based pictures', () => {
  const xmlStyle = {
    pictures: [
      { index: 0, data: '', mime: 'image/png' },
      { index: 1, data: 'iVBORw0KGgoAAAANSUhE', mime: 'image/png' }
    ]
  };
  assert.ok(T.pictureDataUrl(xmlStyle, 2).includes('iVBORw0KGgoAAAANSUhE'));
  assert.equal(T.pictureDataUrl(xmlStyle, 1), '');
});

const colsMini = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns>
    <size>8</size>
    <columnsItem>
      <index>0</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c>
        <c>
          <f>2</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>ДлиннаяПодписьКоторойНетМеста</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
      <c>
        <i>4</i>
        <c>
          <f>3</f>
          <parameter>СуммаДохода</parameter>
        </c>
      </c>
    </row>
  </rowsItem>
  <templateMode>true</templateMode>
  <height>1</height>
  <namedItem xsi:type="NamedItemCells">
    <name>Вычеты1</name>
    <area>
      <type>Columns</type>
      <beginRow>-1</beginRow>
      <endRow>-1</endRow>
      <beginColumn>0</beginColumn>
      <endColumn>3</endColumn>
    </area>
  </namedItem>
  <namedItem xsi:type="NamedItemCells">
    <name>Вычеты2</name>
    <area>
      <type>Columns</type>
      <beginRow>-1</beginRow>
      <endRow>-1</endRow>
      <beginColumn>4</beginColumn>
      <endColumn>7</endColumn>
    </area>
  </namedItem>
  <namedItem xsi:type="NamedItemCells">
    <name>ЛеваяЧасть</name>
    <area>
      <type>Columns</type>
      <beginRow>-1</beginRow>
      <endRow>-1</endRow>
      <beginColumn>0</beginColumn>
      <endColumn>7</endColumn>
    </area>
  </namedItem>
  <namedItem xsi:type="NamedItemCells">
    <name>Шапка</name>
    <area>
      <type>Rows</type>
      <beginRow>0</beginRow>
      <endRow>0</endRow>
      <beginColumn>-1</beginColumn>
      <endColumn>-1</endColumn>
    </area>
  </namedItem>
  <format><width>24</width></format>
  <format>
    <width>24</width>
    <textPlacement>Auto</textPlacement>
  </format>
  <format>
    <fillType>Parameter</fillType>
    <textPlacement>Auto</textPlacement>
  </format>
</document>`;

test('parses nested vertical (Columns) areas', () => {
  const parsed = TP.parse(colsMini);
  assert.ok(parsed.model, parsed.error);
  const cols = T.columnAreaItems(parsed.model);
  assert.equal(cols.length, 3);
  const packed = T.columnAreaLevels(cols);
  const byName = Object.fromEntries(packed.items.map((x) => [x.item.name, x.level]));
  assert.equal(byName['ЛеваяЧасть'], 0);
  assert.equal(byName['Вычеты1'], 1);
  assert.equal(byName['Вычеты2'], 1);
  const b = T.colAreaBounds(cols.find((x) => x.name === 'Вычеты1'), 8);
  assert.equal(b.begin, 0);
  assert.equal(b.end, 3);
  assert.equal(T.placementOf({ textPlacement: 'Auto' }), 'auto');
  assert.equal(T.placementOf({ textPlacement: 'Wrap' }), 'wrap');
  assert.equal(T.placementOf({}), 'auto');
});

test('outline lists column areas before row areas', () => {
  const parsed = TP.parse(colsMini);
  const items = TP.outline(parsed.model, colsMini);
  const names = items.map((x) => x.name);
  assert.equal(names[0], 'Вычеты1');
  assert.ok(names.includes('ЛеваяЧасть'));
  assert.equal(names[names.length - 1], 'Шапка');
  assert.equal(items.find((x) => x.name === 'Вычеты1').areaType, 'Columns');
  assert.equal(items.find((x) => x.name === 'Шапка').areaType, 'Rows');
});

test('render draws a top rail for vertical areas and Auto overflow', () => {
  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  const parsed = sandbox.window.TemplatePreview.parse(colsMini);
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const rail = container.querySelector('.tp-col-areas');
  assert.ok(rail, 'column area rail');
  const labels = walkMatch(container, '.tp-col-area-label').map((n) => n.textContent);
  assert.ok(labels.includes('ЛеваяЧасть'));
  assert.ok(labels.includes('Вычеты1'));
  assert.ok(labels.includes('Вычеты2'));
  assert.ok(container.querySelector('.tp-col-area-lines'));
  const autoCell = walkMatch(container, '.tp-place-auto');
  assert.ok(autoCell.length >= 1);
  assert.equal(autoCell[0].style.overflow, 'visible');
  assert.equal(autoCell[0].style.whiteSpace, 'nowrap');
  const hasText = walkMatch(container, '.tp-has-text');
  assert.ok(hasText.length >= 1);
});

const ndflPath = 'e:\\Bases\\ERP_DESIGNER\\src\\cf\\CommonTemplates\\Форма2НДФЛс2024\\Ext\\Template.xml';

const borderMini = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns>
    <size>3</size>
    <columnsItem>
      <index>0</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
    <columnsItem>
      <index>1</index>
      <column><formatIndex>2</formatIndex></column>
    </columnsItem>
    <columnsItem>
      <index>2</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c>
        <c>
          <f>3</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>A</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
      <c>
        <c>
          <f>4</f>
        </c>
      </c>
      <c>
        <c>
          <f>5</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>B</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
    </row>
  </rowsItem>
  <height>1</height>
  <merge>
    <r>0</r>
    <c>0</c>
    <w>1</w>
  </merge>
  <line width="1" gap="false">Solid</line>
  <format><width>16</width></format>
  <format><width>80</width></format>
  <format>
    <leftBorder>0</leftBorder>
    <topBorder>0</topBorder>
  </format>
  <format>
    <rightBorder>0</rightBorder>
    <topBorder>0</topBorder>
  </format>
  <format>
    <border>0</border>
  </format>
</document>`;

test('merge origin right/bottom borders apply to the whole span', () => {
  const parsed = TP.parse(borderMini);
  const originAll = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet">
  <columns><size>2</size>
    <columnsItem><index>0</index><column><formatIndex>1</formatIndex></column></columnsItem>
    <columnsItem><index>1</index><column><formatIndex>1</formatIndex></column></columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c><c><f>2</f><tl><v8:item><v8:lang>ru</v8:lang><v8:content>X</v8:content></v8:item></tl></c></c>
      <c><c><f>1</f></c></c>
    </row>
  </rowsItem>
  <height>1</height>
  <merge><r>0</r><c>0</c><w>1</w></merge>
  <line width="1" gap="false">Solid</line>
  <format><width>24</width></format>
  <format>
    <leftBorder>0</leftBorder>
    <topBorder>0</topBorder>
    <rightBorder>0</rightBorder>
    <bottomBorder>0</bottomBorder>
  </format>
</document>`;
  const p2 = TP.parse(originAll);
  const br = T.spanBorders(p2.model, 0, 0, 1, 2);
  assert.match(br.left, /solid/);
  assert.match(br.right, /solid/);
  assert.match(br.top, /solid/);
  assert.match(br.bottom, /solid/);
  const edge = T.spanBorders(parsed.model, 0, 0, 1, 2);
  assert.match(edge.left, /solid/);
  assert.match(edge.right, /solid/);
});

test('column widths stay distinct after a merge (not equalized to default)', () => {
  const parsed = TP.parse(borderMini);
  const set = T.columnSetOf(parsed.model, '');
  assert.ok(Math.abs(set.widths[0] - T.widthToPx(16)) < 0.01);
  assert.ok(Math.abs(set.widths[1] - T.widthToPx(80)) < 0.01);
  assert.ok(set.widths[0] < set.widths[1] / 2);
  assert.ok(Math.abs(T.colSpanWidth(set, 0, 2) - (set.widths[0] + set.widths[1])) < 0.01);

  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const td = walkMatch(container, 'td').find((n) => n.getAttribute('data-col') === '0');
  assert.ok(td, 'merged origin td');
  assert.equal(td.colSpan, 2);
  const expected = String(Math.round((set.widths[0] + set.widths[1]) * 10) / 10) + 'px';
  assert.equal(td.style.maxWidth, expected);
  assert.equal(td.style.minWidth, expected);
  assert.match(td.style.borderLeft, /solid/);
  assert.match(td.style.borderRight, /solid/);
});

const invoicePath = 'e:\\Bases\\ERP_DESIGNER\\src\\cf\\DataProcessors\\ПечатьСчетовНаОплату\\Templates\\ПФ_MXL_СчетНаОплату\\Ext\\Template.xml';

test('invoice template column widths follow format palette, not the 72-unit default', () => {
  if (!fs.existsSync(invoicePath)) return;
  const xml = fs.readFileSync(invoicePath, 'utf8');
  const parsed = TP.parse(xml);
  assert.ok(parsed.model, parsed.error);
  const set = T.columnSetOf(parsed.model, '');
  assert.equal(set.size, 41);
  assert.ok(Math.abs(set.widths[0] - T.widthToPx(8)) < 0.01);
  assert.ok(Math.abs(set.widths[1] - T.widthToPx(24)) < 0.01);
  const uniq = new Set(set.widths.map((w) => Math.round(w * 10) / 10));
  assert.ok(uniq.size >= 4, 'expected varied column widths, got ' + [...uniq].join(','));
  const def = T.widthToPx(T.DEFAULT_WIDTH_U);
  assert.ok([...uniq].some((w) => Math.abs(w - def) > 1), 'widths look like the default 72');
  const colAreas = T.columnAreaItems(parsed.model, '');
  assert.equal(colAreas.length, 0);
  const tableId = '95fc5831-7776-4061-a145-d1f1235b4efe';
  const tableAreas = T.columnAreaItems(parsed.model, tableId);
  assert.ok(tableAreas.some((x) => x.name === 'КолонкаКодов'));
  assert.ok(tableAreas.some((x) => x.name === 'ПерваяКолонкаТовара'));
});

test('2-NDFL template has nested vertical areas ЛеваяЧасть/Вычеты', () => {
  if (!fs.existsSync(ndflPath)) {
    return;
  }
  const xml = fs.readFileSync(ndflPath, 'utf8');
  const parsed = TP.parse(xml);
  assert.ok(parsed.model, parsed.error);
  const cols = T.columnAreaItems(parsed.model);
  const names = cols.map((x) => x.name).sort();
  assert.equal(names.join(','), 'Вычеты1,Вычеты2,Вычеты3,Вычеты4,ЛеваяЧасть,ПраваяЧасть');
  const packed = T.columnAreaLevels(cols);
  const byName = Object.fromEntries(packed.items.map((x) => [x.item.name, x.level]));
  assert.equal(byName['ЛеваяЧасть'], 0);
  assert.equal(byName['ПраваяЧасть'], 0);
  assert.equal(byName['Вычеты1'], 1);
  assert.equal(byName['Вычеты4'], 1);
  const left = cols.find((x) => x.name === 'ЛеваяЧасть');
  assert.equal(left.beginColumn, 0);
  assert.equal(left.endColumn, 25);
});
