/* Visual preview of 1C spreadsheet templates (Designer Ext/Template.xml).
 *
 * SpreadsheetDocument XML: xmlns http://v8.1c.ru/8.2/data/spreadsheet
 * This module is read-only: it does not write XML back. */
(function (root) {
'use strict';

/* Width: XML stores eighths of the default font character (~7px). Height: 0.1 mm. */
var WIDTH_PX = 7 / 8;
var HEIGHT_PX = 96 / 254;
var DEFAULT_WIDTH_U = 72;
var DEFAULT_HEIGHT_U = 45;
var DEFAULT_FONT = { faceName: 'Arial', height: 8, bold: false, italic: false, underline: false, strikeout: false };

/* Shared XML helpers live in xml-util.js; aliased locally for brevity. */
var XU = root.XmlUtil;
var localName = XU.localName;
var namedChildren = XU.namedChildren;
var firstChild = XU.firstChild;
var textOf = XU.textOf;
var rawText = XU.rawText;

function detect(xml) {
    if (!xml || typeof xml !== 'string') return false;
    if (xml.indexOf('xcf/logform') >= 0) return false;
    if (xml.indexOf('v8.1c.ru/8.2/data/spreadsheet') >= 0) return true;
    if (xml.indexOf('<rowsItem') < 0 || xml.indexOf('<columns') < 0) return false;
    return /<(?:\w+:)?document[\s>]/.test(xml);
}

/* Template cells keep their line breaks, so read content with rawText. */
function localizedFrom(el) {
    return XU.localizedFrom(el, rawText);
}

function attr(el, name) {
    if (!el || !el.getAttribute) return '';
    return el.getAttribute(name) || '';
}

function intOf(el, fallback) {
    var n = parseInt(textOf(el), 10);
    return isNaN(n) ? (fallback || 0) : n;
}

function widthToPx(u) {
    var n = Number(u);
    if (!isFinite(n)) n = 0;
    return Math.max(0, n * WIDTH_PX);
}

function heightToPx(u) {
    var n = Number(u);
    if (!isFinite(n)) n = 0;
    return Math.max(0, n * HEIGHT_PX);
}

function unitToPx(u) { return widthToPx(u); }

function formatByIndex(formats, idx) {
    var n = parseInt(idx, 10);
    if (!n || n < 1) return null;
    return formats[n - 1] || null;
}

/* Properties a cell must never inherit: width belongs to the column, height to
 * the row, and being a parameter is a trait of the cell itself — a row whose
 * format says `Parameter` would otherwise turn every cell in it into one. */
var ROW_ONLY_PROPS = { width: true, height: true, fillType: true };

/* A cell format sits on top of its row format: 1C resolves the two, and MXL
 * leans on it — a row can carry the font and colours of cells that have no
 * format of their own. */
function effectiveFormat(model, row, cell) {
    var cellFmt = formatByIndex(model.formats, cell && cell.formatIndex);
    var rowFmt = formatByIndex(model.formats, row && row.formatIndex);
    if (!rowFmt) return cellFmt;
    var out = {};
    var k;
    for (k in rowFmt) {
        if (!Object.prototype.hasOwnProperty.call(rowFmt, k)) continue;
        if (ROW_ONLY_PROPS[k]) continue;
        if (rowFmt[k] == null || rowFmt[k] === '') continue;
        out[k] = rowFmt[k];
    }
    if (!cellFmt) return out;
    for (k in cellFmt) {
        if (!Object.prototype.hasOwnProperty.call(cellFmt, k)) continue;
        if (cellFmt[k] == null || cellFmt[k] === '') continue;
        out[k] = cellFmt[k];
    }
    return out;
}

function widthOfFormat(fmt) {
    if (!fmt || fmt.width == null || fmt.width === '') return widthToPx(DEFAULT_WIDTH_U);
    var n = Number(fmt.width);
    if (!isFinite(n) || n <= 0) return widthToPx(DEFAULT_WIDTH_U);
    return Math.max(1, widthToPx(n));
}

function heightOfFormat(fmt) {
    if (!fmt || fmt.height == null || fmt.height === '') {
        return { px: heightToPx(DEFAULT_HEIGHT_U), auto: false };
    }
    var n = Number(fmt.height);
    if (!isFinite(n) || n === 0) return { px: heightToPx(DEFAULT_HEIGHT_U), auto: false };
    if (n < 0) return { px: Math.max(heightToPx(DEFAULT_HEIGHT_U), heightToPx(Math.abs(n))), auto: true };
    return { px: Math.max(4, heightToPx(n)), auto: false };
}

function parseLine(el) {
    var styleText = textOf(el) || 'Solid';
    return {
        width: parseInt(attr(el, 'width') || '1', 10) || 1,
        gap: attr(el, 'gap') === 'true',
        style: styleText
    };
}

function parseFont(el) {
    return {
        faceName: attr(el, 'faceName') || 'Arial',
        height: parseFloat(attr(el, 'height') || '8') || 8,
        bold: attr(el, 'bold') === 'true',
        italic: attr(el, 'italic') === 'true',
        underline: attr(el, 'underline') === 'true',
        strikeout: attr(el, 'strikeout') === 'true',
        kind: attr(el, 'kind') || '',
        scale: parseFloat(attr(el, 'scale') || '100') || 100
    };
}

function parseFormat(el) {
    var fmt = {};
    if (!el) return fmt;
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        var tag = localName(c);
        if (!tag) continue;
        if (tag === 'format') fmt.numberFormat = localizedFrom(c);
        else if (tag === 'width' || tag === 'height') fmt[tag] = textOf(c);
        else if (tag === 'font' || tag === 'border' || tag === 'leftBorder' || tag === 'rightBorder'
            || tag === 'topBorder' || tag === 'bottomBorder' || tag === 'drawingBorder')
            fmt[tag] = textOf(c);
        else if (tag === 'horizontalAlignment' || tag === 'verticalAlignment' || tag === 'textPlacement'
            || tag === 'fillType' || tag === 'backColor' || tag === 'textColor' || tag === 'pattern'
            || tag === 'hyperLink' || tag === 'bySelectedColumns' || tag === 'textOrientation')
            fmt[tag] = textOf(c);
        else fmt[tag] = textOf(c);
    }
    return fmt;
}

function parseCell(content) {
    var cell = { formatIndex: 0, text: '', parameter: '', detailParameter: '', fillType: '' };
    if (!content) return cell;
    var kids = content.children || [];
    for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        var tag = localName(c);
        if (tag === 'f') cell.formatIndex = intOf(c, 0);
        else if (tag === 'tl') cell.text = localizedFrom(c);
        else if (tag === 'parameter') cell.parameter = textOf(c);
        else if (tag === 'detailParameter') cell.detailParameter = textOf(c);
        else if (tag === 'note') cell.note = localizedFrom(c);
    }
    return cell;
}

function parseRow(rowEl) {
    var row = {
        columnsID: textOf(firstChild(rowEl, 'columnsID')),
        formatIndex: intOf(firstChild(rowEl, 'formatIndex'), 0),
        empty: textOf(firstChild(rowEl, 'empty')) === 'true',
        cells: []
    };
    var col = 0;
    var kids = rowEl.children || [];
    for (var i = 0; i < kids.length; i++) {
        var g = kids[i];
        if (localName(g) !== 'c') continue;
        var iEl = firstChild(g, 'i');
        if (iEl) col = intOf(iEl, col);
        var content = firstChild(g, 'c') || null;
        if (!content) {
            var innerKids = g.children || [];
            for (var k = 0; k < innerKids.length; k++) {
                if (localName(innerKids[k]) !== 'i') { content = innerKids[k]; break; }
            }
        }
        var cell = parseCell(content);
        cell.col = col;
        row.cells.push(cell);
        col += 1;
    }
    return row;
}

function parseColumnSet(el, formats) {
    var id = textOf(firstChild(el, 'id'));
    var size = intOf(firstChild(el, 'size'), 0);
    var byIndex = {};
    var items = namedChildren(el, 'columnsItem');
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var idx = intOf(firstChild(it, 'index'), 0);
        var col = firstChild(it, 'column');
        byIndex[idx] = col ? intOf(firstChild(col, 'formatIndex'), 0) : 0;
    }
    var widths = [];
    var maxIdx = size;
    for (var k in byIndex) {
        var ki = parseInt(k, 10);
        if (ki + 1 > maxIdx) maxIdx = ki + 1;
    }
    if (!size) size = maxIdx;
    for (var c = 0; c < size; c++) {
        widths.push(widthOfFormat(formatByIndex(formats, byIndex[c] != null ? byIndex[c] : 0)));
    }
    return { id: id, size: size, widths: widths, formatIndex: byIndex };
}

function parseMerge(el) {
    return {
        r: intOf(firstChild(el, 'r'), 0),
        c: intOf(firstChild(el, 'c'), 0),
        h: firstChild(el, 'h') ? intOf(firstChild(el, 'h'), 0) : 0,
        w: firstChild(el, 'w') ? intOf(firstChild(el, 'w'), 0) : 0,
        columnsID: textOf(firstChild(el, 'columnsID'))
    };
}

function parseNamedItem(el) {
    var typeAttr = attr(el, 'xsi:type') || attr(el, 'type') || '';
    var name = textOf(firstChild(el, 'name'));
    if (typeAttr.indexOf('NamedItemDrawing') >= 0) {
        return { kind: 'drawing', name: name, drawingID: intOf(firstChild(el, 'drawingID'), 0) };
    }
    var area = firstChild(el, 'area');
    if (!area) return { kind: 'cells', name: name };
    return {
        kind: 'cells',
        name: name,
        type: textOf(firstChild(area, 'type')) || 'Rows',
        beginRow: intOf(firstChild(area, 'beginRow'), 0),
        endRow: intOf(firstChild(area, 'endRow'), 0),
        beginColumn: intOf(firstChild(area, 'beginColumn'), -1),
        endColumn: intOf(firstChild(area, 'endColumn'), -1),
        columnsID: textOf(firstChild(area, 'columnsID'))
    };
}

function parseDrawing(el) {
    return {
        drawingType: textOf(firstChild(el, 'drawingType')),
        id: intOf(firstChild(el, 'id'), 0),
        formatIndex: intOf(firstChild(el, 'formatIndex'), 0),
        beginRow: intOf(firstChild(el, 'beginRow'), 0),
        beginRowOffset: intOf(firstChild(el, 'beginRowOffset'), 0),
        endRow: intOf(firstChild(el, 'endRow'), 0),
        endRowOffset: intOf(firstChild(el, 'endRowOffset'), 0),
        beginColumn: intOf(firstChild(el, 'beginColumn'), 0),
        beginColumnOffset: intOf(firstChild(el, 'beginColumnOffset'), 0),
        endColumn: intOf(firstChild(el, 'endColumn'), 0),
        endColumnOffset: intOf(firstChild(el, 'endColumnOffset'), 0),
        pictureSize: textOf(firstChild(el, 'pictureSize')),
        pictureIndex: intOf(firstChild(el, 'pictureIndex'), 0),
        zOrder: intOf(firstChild(el, 'zOrder'), 0),
        autoSize: textOf(firstChild(el, 'autoSize')) === 'true'
    };
}

function parsePicture(el) {
    var idx = intOf(firstChild(el, 'index'), 0);
    var pic = firstChild(el, 'picture');
    var data = pic ? String(pic.textContent || '').replace(/\s+/g, '') : '';
    var ref = '';
    if (pic && pic.getAttribute) ref = pic.getAttribute('ref') || '';
    var mime = 'image/png';
    if (data.indexOf('/9j') === 0) mime = 'image/jpeg';
    else if (data.indexOf('Qk') === 0) mime = 'image/bmp';
    else if (data.indexOf('R0lG') === 0) mime = 'image/gif';
    return { index: idx, data: data, ref: ref, mime: mime };
}

function parse(xml) {
    if (!xml || typeof xml !== 'string') return { error: 'Пустой XML' };
    var doc;
    try {
        doc = new DOMParser().parseFromString(xml, 'application/xml');
    } catch (e) {
        return { error: 'Не удалось разобрать XML' };
    }
    var parseErr = doc.querySelector && doc.querySelector('parsererror');
    if (parseErr) return { error: textOf(parseErr) || 'Ошибка разбора XML' };
    var root = doc.documentElement;
    if (!root || localName(root) !== 'document') {
        return { error: 'В файле нет корневого document табличного документа' };
    }

    var lines = namedChildren(root, 'line').map(parseLine);
    var fonts = namedChildren(root, 'font').map(parseFont);
    var formats = namedChildren(root, 'format').map(parseFormat);
    var pictures = namedChildren(root, 'picture').map(parsePicture);

    var columnSets = [];
    var columnSetById = {};
    var colNodes = namedChildren(root, 'columns');
    for (var i = 0; i < colNodes.length; i++) {
        var set = parseColumnSet(colNodes[i], formats);
        columnSets.push(set);
        columnSetById[set.id || ''] = set;
    }
    if (!columnSetById['']) {
        columnSetById[''] = columnSets[0] || { id: '', size: 1, widths: [widthToPx(DEFAULT_WIDTH_U)], formatIndex: {} };
    }

    var height = intOf(firstChild(root, 'height'), 0);
    var rowByIndex = {};
    var rowNodes = namedChildren(root, 'rowsItem');
    var maxRow = height - 1;
    for (var r = 0; r < rowNodes.length; r++) {
        var ri = rowNodes[r];
        var index = intOf(firstChild(ri, 'index'), 0);
        var indexTo = firstChild(ri, 'indexTo') ? intOf(firstChild(ri, 'indexTo'), index) : index;
        var rowEl = firstChild(ri, 'row');
        var parsedRow = rowEl ? parseRow(rowEl) : { columnsID: '', formatIndex: 0, empty: true, cells: [] };
        for (var rr = index; rr <= indexTo; rr++) {
            rowByIndex[rr] = parsedRow;
            if (rr > maxRow) maxRow = rr;
        }
    }
    if (height < maxRow + 1) height = maxRow + 1;
    if (height < 1) height = 1;

    var rows = [];
    for (var y = 0; y < height; y++) {
        rows.push(rowByIndex[y] || { columnsID: '', formatIndex: 0, empty: true, cells: [] });
    }

    var merges = namedChildren(root, 'merge').map(parseMerge);
    var unmerges = namedChildren(root, 'verticalUnmerge').map(parseMerge);
    var namedItems = namedChildren(root, 'namedItem').map(parseNamedItem);
    var drawings = namedChildren(root, 'drawing').map(parseDrawing);

    return {
        model: {
            height: height,
            rows: rows,
            columnSets: columnSets,
            columnSetById: columnSetById,
            formats: formats,
            fonts: fonts,
            lines: lines,
            pictures: pictures,
            merges: merges,
            unmerges: unmerges,
            namedItems: namedItems,
            drawings: drawings,
            templateMode: textOf(firstChild(root, 'templateMode')) === 'true'
        }
    };
}

function columnSetOf(model, columnsID) {
    return model.columnSetById[columnsID || ''] || model.columnSetById[''] || { size: 1, widths: [widthToPx(DEFAULT_WIDTH_U)] };
}

function cellAt(row, col) {
    if (!row || !row.cells) return null;
    for (var i = 0; i < row.cells.length; i++) {
        if (row.cells[i].col === col) return row.cells[i];
    }
    return null;
}

function displayText(cell, fmt) {
    if (!cell) return '';
    var fill = (fmt && fmt.fillType) || cell.fillType || '';
    if (fill === 'Parameter' || (!fill && cell.parameter && !cell.text)) {
        return cell.parameter ? ('<' + cell.parameter + '>') : '';
    }
    if (fill === 'Template' && cell.text) {
        return String(cell.text).replace(/\[([^\]\r\n]+)\]/g, '<$1>');
    }
    if (cell.text) return cell.text;
    if (cell.parameter) return '<' + cell.parameter + '>';
    return '';
}

function isParamCell(cell, fmt) {
    if (!cell) return false;
    var fill = (fmt && fmt.fillType) || '';
    if (fill === 'Parameter') return true;
    if (!cell.text && cell.parameter) return true;
    return false;
}

function fontOf(model, fmt) {
    if (!fmt || fmt.font == null || fmt.font === '') return DEFAULT_FONT;
    var idx = parseInt(fmt.font, 10);
    if (isNaN(idx) || idx < 0) return DEFAULT_FONT;
    return model.fonts[idx] || DEFAULT_FONT;
}

function lineOf(model, idx) {
    if (idx == null || idx === '') return null;
    var n = parseInt(idx, 10);
    if (isNaN(n) || n < 0) return null;
    return model.lines[n] || null;
}

function borderCss(line, color) {
    if (!line) return '';
    var st = String(line.style || 'Solid').toLowerCase();
    if (st === 'none' || st === 'нет') return '';
    var w = Math.max(1, Number(line.width) || 1);
    var kind = 'solid';
    if (st.indexOf('dot') >= 0) kind = 'dotted';
    else if (st.indexOf('dash') >= 0 || st.indexOf('пунктир') >= 0) kind = 'dashed';
    else if (st.indexOf('double') >= 0 || st.indexOf('двойн') >= 0) kind = 'double';
    if (line.gap && kind === 'solid') kind = 'dashed';
    return w + 'px ' + kind + ' ' + (styleColor(color) || '#000');
}

function borderRank(css) {
    if (!css) return 0;
    var w = parseInt(css, 10);
    if (!isFinite(w) || w < 1) return 0;
    if (String(css).indexOf('double') >= 0) w += 0.5;
    return w;
}

function strongerBorder(a, b) {
    return borderRank(b) > borderRank(a) ? b : a;
}

function spanBorders(model, rowIdx, colIdx, rowspan, colspan) {
    var out = { left: '', right: '', top: '', bottom: '' };
    var y, x;
    rowspan = rowspan || 1;
    colspan = colspan || 1;
    function add(cell, cellRow, left, right, top, bottom) {
        if (!cell) return;
        var fmt = effectiveFormat(model, cellRow, cell);
        if (!fmt) return;
        if (left) out.left = strongerBorder(out.left, sideBorder(model, fmt, 'left'));
        if (right) out.right = strongerBorder(out.right, sideBorder(model, fmt, 'right'));
        if (top) out.top = strongerBorder(out.top, sideBorder(model, fmt, 'top'));
        if (bottom) out.bottom = strongerBorder(out.bottom, sideBorder(model, fmt, 'bottom'));
    }
    add(cellAt(model.rows[rowIdx], colIdx), model.rows[rowIdx], true, true, true, true);
    for (y = 0; y < rowspan; y++) {
        var row = model.rows[rowIdx + y];
        for (x = 0; x < colspan; x++) {
            add(cellAt(row, colIdx + x), row, x === 0, x === colspan - 1, y === 0, y === rowspan - 1);
        }
    }
    return out;
}

function colSpanWidth(set, col, colspan) {
    var w = 0;
    var n = colspan || 1;
    var i;
    for (i = 0; i < n; i++) w += set.widths[col + i] || 0;
    return w;
}

/* Auto placement lets a value run over its neighbours, but only while they are
 * empty: 1C stops the text at the first filled cell instead of drawing it
 * underneath. The direction follows the alignment, as in the reference
 * renderer; a centred value grows symmetrically so it stays over its own cell. */
function spillBox(model, row, set, spans, ly, col, colspan, align) {
    var cellW = colSpanWidth(set, col, colspan);
    function free(c) {
        if (c < 0 || c >= set.size) return false;
        if (spans.covered[ly][c] || spans.origin[ly][c]) return false;
        var neighbour = cellAt(row, c);
        if (!neighbour) return true;
        return !displayText(neighbour, effectiveFormat(model, row, neighbour));
    }
    var rightPx = 0;
    var leftPx = 0;
    var c;
    for (c = col + colspan; free(c); c++) rightPx += set.widths[c] || 0;
    for (c = col - 1; free(c); c--) leftPx += set.widths[c] || 0;
    if (align === 'right') return { left: leftPx ? -leftPx : 0, width: cellW + leftPx };
    if (align === 'center') {
        var sym = Math.min(leftPx, rightPx);
        return { left: sym ? -sym : 0, width: cellW + 2 * sym };
    }
    return { left: 0, width: cellW + rightPx };
}

function lockWidth(el, px) {
    var s = (Math.round(px * 10) / 10) + 'px';
    el.style.width = s;
    el.style.minWidth = s;
    el.style.maxWidth = s;
    el.style.boxSizing = 'border-box';
}

function sideBorder(model, fmt, side) {
    if (!fmt) return '';
    var key = side + 'Border';
    var idx = fmt[key];
    if (idx == null || idx === '') idx = fmt.border;
    return borderCss(lineOf(model, idx), fmt.bordersColor);
}

function styleColor(v) {
    if (!v) return '';
    if (v.charAt(0) === '#') return v;
    var s = v.toLowerCase();
    if (s.indexOf('formbackcolor') >= 0 || s.indexOf('fieldbackcolor') >= 0) return '#fff';
    if (s.indexOf('buttonbackcolor') >= 0) return '#f0f0f0';
    return '';
}

function alignCss(v, axis, fallback) {
    var s = String(v || '').toLowerCase();
    if (axis === 'h') {
        if (s === 'center' || s.indexOf('центр') >= 0) return 'center';
        if (s === 'right' || s.indexOf('прав') >= 0) return 'right';
        if (s === 'justify' || s.indexOf('ширин') >= 0) return 'justify';
        if (s) return 'left';
        return fallback || 'left';
    }
    if (s === 'center' || s.indexOf('центр') >= 0) return 'middle';
    if (s === 'bottom' || s.indexOf('низ') >= 0) return 'bottom';
    if (s) return 'top';
    return fallback || 'top';
}

/* Template.xml writes the vertical alignment of every cell out; MXL leaves the
 * bit clear and relies on the platform default, which is the bottom edge. The
 * model says which default applies so the renderer stays format-agnostic. */
function defaultVAlign(model) {
    var d = model && model.defaults;
    return alignCss(d && d.verticalAlignment, 'v', 'top');
}

function rowHeight(model, row) {
    return heightOfFormat(formatByIndex(model.formats, row && row.formatIndex));
}

function unmergeHits(unmerges, row, col, w) {
    for (var i = 0; i < unmerges.length; i++) {
        var u = unmerges[i];
        if (u.r !== row) continue;
        var u1 = u.c + (u.w || 0);
        var c1 = col + (w || 0);
        if (col <= u1 && u.c <= c1) return true;
    }
    return false;
}

function buildSpans(model, start, end, columnsID) {
    var nRows = end - start;
    var set = columnSetOf(model, columnsID);
    var nCols = set.size;
    var origin = [];
    var covered = [];
    var y, x;
    for (y = 0; y < nRows; y++) {
        origin[y] = [];
        covered[y] = [];
        for (x = 0; x < nCols; x++) {
            origin[y][x] = null;
            covered[y][x] = false;
        }
    }

    function applyMerge(m, rr, cc, hh, ww) {
        if (rr < start || rr >= end) return;
        var ly = rr - start;
        var h = Math.min(hh + 1, nRows - ly);
        var w = Math.min(ww + 1, nCols - cc);
        if (h < 1 || w < 1) return;
        if (covered[ly][cc] && !(h === 1 && w === 1)) return;
        origin[ly][cc] = { rowspan: h, colspan: w };
        for (var iy = 0; iy < h; iy++) {
            for (var ix = 0; ix < w; ix++) {
                if (iy === 0 && ix === 0) continue;
                if (ly + iy < nRows && cc + ix < nCols) covered[ly + iy][cc + ix] = true;
            }
        }
    }

    var merges = model.merges || [];
    for (var i = 0; i < merges.length; i++) {
        var m = merges[i];
        if (m.columnsID) {
            if (m.columnsID !== (columnsID || '')) continue;
        } else if (m.r === -1 && columnsID) {
            continue;
        }
        if (m.r === -1) {
            for (var rr = start; rr < end; rr++) {
                if (unmergeHits(model.unmerges || [], rr, m.c, m.w)) continue;
                applyMerge(m, rr, m.c, 0, m.w);
            }
        } else {
            applyMerge(m, m.r, m.c, m.h, m.w);
        }
    }
    return { origin: origin, covered: covered };
}

function groupsOf(model) {
    var groups = [];
    var height = model.height;
    var i = 0;
    while (i < height) {
        var id = model.rows[i].columnsID || '';
        var j = i + 1;
        while (j < height && (model.rows[j].columnsID || '') === id) j++;
        groups.push({ start: i, end: j, columnsID: id });
        i = j;
    }
    return groups;
}

function isColumnArea(it) {
    return !!(it && it.kind === 'cells' && it.type === 'Columns');
}

function isRowArea(it) {
    return !!(it && it.kind === 'cells' && it.type !== 'Columns');
}

function columnAreaItems(model, columnsID) {
    var items = (model && model.namedItems) || [];
    var out = [];
    var filter = arguments.length >= 2;
    var want = columnsID || '';
    for (var i = 0; i < items.length; i++) {
        if (!isColumnArea(items[i]) || !items[i].name) continue;
        if (filter && (items[i].columnsID || '') !== want) continue;
        out.push(items[i]);
    }
    return out;
}

function colAreaContains(a, b) {
    if (!a || !b || a === b) return false;
    var as = a.endColumn - a.beginColumn;
    var bs = b.endColumn - b.beginColumn;
    return a.beginColumn <= b.beginColumn && a.endColumn >= b.endColumn && as > bs;
}

function columnAreaLevels(items) {
    var out = [];
    var i, j, level, max = 0;
    for (i = 0; i < items.length; i++) {
        level = 0;
        for (j = 0; j < items.length; j++) {
            if (colAreaContains(items[j], items[i])) level++;
        }
        out.push({ item: items[i], level: level });
        if (level > max) max = level;
    }
    return { items: out, maxLevel: out.length ? max : -1 };
}

function colAreaBounds(it, size) {
    if (!it) return null;
    var b = it.beginColumn;
    var e = it.endColumn;
    if (b == null || b < 0) b = 0;
    if (e == null || e < 0) e = size - 1;
    if (b >= size) return null;
    if (e >= size) e = size - 1;
    if (e < b) e = b;
    return { begin: b, end: e };
}

function placementOf(fmt) {
    var p = String((fmt && fmt.textPlacement) || 'Auto').toLowerCase();
    if (p === 'wrap' || p === 'перенос' || p.indexOf('wrap') >= 0) return 'wrap';
    if (p === 'block' || p.indexOf('забив') >= 0) return 'block';
    if (p === 'cut' || p === 'обрез' || p.indexOf('cut') >= 0) return 'cut';
    return 'auto';
}

function areaForRow(model, row) {
    var items = model.namedItems || [];
    var best = null;
    var bestSpan = Infinity;
    var bestRank = 9;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!isRowArea(it)) continue;
        if (row < it.beginRow || row > it.endRow) continue;
        var span = it.endRow - it.beginRow;
        var rank = it.type === 'Rows' ? 0 : 1;
        if (!best || rank < bestRank || (rank === bestRank && span < bestSpan)) {
            best = it;
            bestSpan = span;
            bestRank = rank;
        }
    }
    return best;
}

function rowAreaStarts(model) {
    var starts = {};
    var items = model.namedItems || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.kind !== 'cells') continue;
        if (it.type && it.type !== 'Rows') continue;
        starts[it.beginRow] = it;
    }
    return starts;
}

function eachRowArea(model, fn) {
    var items = model.namedItems || [];
    var used = {};
    var last = model.height - 1;
    var i;
    for (i = 0; i < items.length; i++) {
        var it = items[i];
        if (!isRowArea(it)) continue;
        if (it.type && it.type !== 'Rows') continue;
        if (!it.name || used[it.name]) continue;
        used[it.name] = true;
        var b = Math.max(0, it.beginRow);
        var e = Math.min(last, it.endRow);
        if (e < b) continue;
        fn(it, b, e);
    }
}

function itemKey(it) {
    if (!it) return '';
    if (it.name) return String(it.name);
    if (it.row != null) return 'r' + it.row + 'c' + (it.col || 0);
    return '';
}

function indexNamedLines(xml) {
    var map = {};
    if (!xml) return map;
    var lines = String(xml).split(/\r?\n/);
    var inNamed = false;
    for (var i = 0; i < lines.length; i++) {
        if (/<namedItem\b/.test(lines[i])) inNamed = true;
        if (inNamed) {
            var m = lines[i].match(/<name>([^<]+)<\/name>/);
            if (m && map[m[1]] == null) map[m[1]] = i + 1;
        }
        if (/<\/namedItem>/.test(lines[i])) inNamed = false;
    }
    return map;
}

function outline(model, xml) {
    var out = [];
    var map = indexNamedLines(xml || '');
    var items = (model && model.namedItems) || [];
    var named = items.filter(function (it) { return it.kind === 'cells' && it.name; })
        .sort(function (a, b) {
            var ac = isColumnArea(a) ? 0 : 1;
            var bc = isColumnArea(b) ? 0 : 1;
            if (ac !== bc) return ac - bc;
            if (ac === 0) return a.beginColumn - b.beginColumn;
            return a.beginRow - b.beginRow;
        });
    for (var i = 0; i < named.length; i++) {
        var it = named[i];
        out.push({
            type: 'form',
            tag: 'TemplateArea',
            name: it.name,
            title: it.name,
            id: it.name,
            line: map[it.name] || 1,
            depth: 0,
            areaType: it.type,
            beginRow: it.beginRow,
            endRow: it.endRow,
            beginColumn: it.beginColumn,
            endColumn: it.endColumn
        });
    }
    return out;
}

/* 8x8 fill patterns 1..17 of the spreadsheet format, as in the reference
 * renderer: bit x of row y is a pixel of the pattern colour. Pattern 0 is a
 * solid fill and 255 means no pattern at all. */
var PATTERN_TILES = [
    [0xAA, 0xFF, 0x55, 0xFF, 0xAA, 0xFF, 0x55, 0xFF],
    [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55],
    [0x00, 0x55, 0x00, 0xAA, 0x00, 0x55, 0x00, 0xAA],
    [0xFF, 0x01, 0x01, 0x01, 0xFF, 0x10, 0x10, 0x10],
    [0x11, 0x2A, 0x44, 0xA2, 0x11, 0xA8, 0x44, 0x8A],
    [0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66],
    [0x00, 0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF, 0x00],
    [0x99, 0xCC, 0x66, 0x33, 0x99, 0xCC, 0x66, 0x33],
    [0xCC, 0x99, 0x33, 0x66, 0xCC, 0x99, 0x33, 0x66],
    [0xCC, 0xCC, 0x33, 0x33, 0xCC, 0xCC, 0x33, 0x33],
    [0xDD, 0xDD, 0x77, 0x77, 0xDD, 0xDD, 0x77, 0x77],
    [0xE1, 0xF0, 0x78, 0x3C, 0x1E, 0x0F, 0x87, 0xC3],
    [0x87, 0x0F, 0x1E, 0x3C, 0x78, 0xF0, 0xE1, 0xC3],
    [0x88, 0x44, 0x22, 0x11, 0x88, 0x44, 0x22, 0x11],
    [0x44, 0x88, 0x11, 0x22, 0x44, 0x88, 0x11, 0x22],
    [0x44, 0xFF, 0x44, 0x44, 0x44, 0xFF, 0x44, 0x44],
    [0xC0, 0xC0, 0x33, 0x33, 0x0C, 0x0C, 0x33, 0x33]
];

var PATTERN_SOLID = 0;
var PATTERN_NONE = 255;
var patternUrlCache = {};

function patternTileUrl(tile, color) {
    var key = tile.join(',') + '|' + color;
    if (patternUrlCache[key]) return patternUrlCache[key];
    var rects = '';
    var y, x;
    for (y = 0; y < 8; y++) {
        for (x = 0; x < 8; x++) {
            if ((tile[y] >> x) & 1) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
        }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" '
        + 'shape-rendering="crispEdges" fill="' + color + '">' + rects + '</svg>';
    var url = 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
    patternUrlCache[key] = url;
    return url;
}

/* Returns the background layers of a cell: a colour and, over it, the hatch of
 * the pattern. A pattern without an absolute colour is not drawn — real
 * invoices mark a column with a colourless pattern, and painting it black is
 * wrong. */
function patternFill(fmt) {
    if (!fmt || fmt.pattern == null || fmt.pattern === '') return null;
    var color = styleColor(fmt.patternColor);
    if (!color) return null;
    var n = parseInt(fmt.pattern, 10);
    if (!isFinite(n) || n === PATTERN_NONE) return null;
    if (n === PATTERN_SOLID) return { color: color };
    if (n < 1 || n > PATTERN_TILES.length) return null;
    return { image: patternTileUrl(PATTERN_TILES[n - 1], color) };
}

/* Text orientation is stored in degrees. 90 is the common case — text reading
 * bottom to top — and gets writing-mode so the line box keeps its height; any
 * other angle is a plain rotation. */
function applyOrientation(node, fmt) {
    if (!fmt || fmt.textOrientation == null || fmt.textOrientation === '') return false;
    var deg = Number(fmt.textOrientation);
    if (!isFinite(deg) || !deg) return false;
    if (deg === 90) {
        node.style.writingMode = 'vertical-rl';
        node.style.transform = 'rotate(180deg)';
        return true;
    }
    node.style.display = 'inline-block';
    node.style.transformOrigin = 'left bottom';
    node.style.transform = 'rotate(' + (-deg) + 'deg)';
    return true;
}

/* «Забивать»: 1C repeats the value until it covers the cell. CSS cannot do it,
 * so the line is multiplied in the DOM and the overflow is clipped. The
 * reference measures the glyphs; an estimate from the font size with a margin
 * is enough, because everything past the edge is cut off anyway. */
var BLOCK_MAX_REPEATS = 200;
var BLOCK_MAX_CHARS = 32768;

function blockRepeat(text, widthPx, fontPt) {
    if (!text) return String(text || '');
    var charPx = Math.max(3, (Number(fontPt) || 8) * (96 / 72) * 0.55);
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var lineW = line.length * charPx;
        /* A line that already overruns the cell is simply clipped: there is
         * nothing left to fill. */
        if (!line.length || lineW >= widthPx) continue;
        var reps = Math.ceil((widthPx * 1.2) / lineW) + 1;
        if (reps > BLOCK_MAX_REPEATS) reps = BLOCK_MAX_REPEATS;
        if (reps * line.length > BLOCK_MAX_CHARS) {
            reps = Math.max(1, Math.floor(BLOCK_MAX_CHARS / line.length));
        }
        var out = line;
        for (var k = 1; k < reps; k++) out += line;
        lines[i] = out;
    }
    return lines.join('\n');
}

function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
}

function applyCellStyle(td, model, cell, fmt, hPx, auto, place, borders) {
    var font = fontOf(model, fmt);
    td.style.fontFamily = (font.faceName || 'Arial') + ', Arial, sans-serif';
    td.style.fontSize = (font.height || 8) + 'pt';
    td.style.fontWeight = font.bold ? 'bold' : 'normal';
    td.style.fontStyle = font.italic ? 'italic' : 'normal';
    var dec = '';
    if (font.underline) dec += 'underline ';
    if (font.strikeout) dec += 'line-through ';
    if (dec) td.style.textDecoration = dec.trim();
    place = place || placementOf(fmt);
    td.style.textAlign = alignCss(fmt && fmt.horizontalAlignment, 'h');
    td.style.verticalAlign = alignCss(fmt && fmt.verticalAlignment, 'v', defaultVAlign(model));
    if (place === 'cut' || place === 'block') {
        /* `pre` rather than `nowrap`: 1C draws the value line by line and only
         * refuses to wrap. The overflow is clipped either way. */
        td.style.whiteSpace = 'pre';
        td.style.overflow = 'hidden';
    } else if (place === 'wrap') {
        td.style.whiteSpace = 'pre-wrap';
        td.style.overflow = 'hidden';
        td.style.wordBreak = 'break-word';
    } else {
        td.style.whiteSpace = 'nowrap';
        td.style.overflow = 'visible';
    }
    if (fmt) {
        var bg = styleColor(fmt.backColor);
        if (bg) td.style.background = bg;
        var pat = patternFill(fmt);
        if (pat && pat.color) td.style.background = pat.color;
        else if (pat && pat.image) td.style.backgroundImage = pat.image;
        var fg = styleColor(fmt.textColor);
        if (fg) td.style.color = fg;
    }
    if (!borders && fmt) {
        borders = {
            left: sideBorder(model, fmt, 'left'),
            right: sideBorder(model, fmt, 'right'),
            top: sideBorder(model, fmt, 'top'),
            bottom: sideBorder(model, fmt, 'bottom')
        };
    }
    if (borders) {
        if (borders.left) td.style.borderLeft = borders.left;
        if (borders.right) td.style.borderRight = borders.right;
        if (borders.top) td.style.borderTop = borders.top;
        if (borders.bottom) td.style.borderBottom = borders.bottom;
    }
    td.style.height = hPx + 'px';
    if (place !== 'auto') {
        td.style.maxHeight = hPx + 'px';
        if (!auto) td.style.overflow = 'hidden';
    }
}

function renderGroupTable(model, group, ctx, rowHeights) {
    var set = columnSetOf(model, group.columnsID);
    var spans = buildSpans(model, group.start, group.end, group.columnsID);
    var table = el('table', 'tp-grid');
    table.style.tableLayout = 'fixed';
    var colgroup = el('colgroup');
    var c;
    for (c = 0; c < set.size; c++) {
        var col = document.createElement('col');
        lockWidth(col, set.widths[c]);
        if (col.setAttribute) col.setAttribute('width', String(Math.round(set.widths[c])));
        colgroup.appendChild(col);
    }
    table.appendChild(colgroup);
    table.style.width = set.widths.reduce(function (a, b) { return a + b; }, 0) + 'px';

    var tbody = el('tbody');
    var starts = rowAreaStarts(model);
    for (var y = group.start; y < group.end; y++) {
        var ly = y - group.start;
        var row = model.rows[y];
        var rh = rowHeights[y];
        var tr = el('tr');
        tr.style.height = rh + 'px';
        tr.setAttribute('data-row', String(y));
        var area = areaForRow(model, y);
        if (area) tr.setAttribute('data-area', area.name);
        if (starts[y]) tr.className = 'tp-area-start';
        for (c = 0; c < set.size; c++) {
            if (spans.covered[ly][c]) continue;
            var sp = spans.origin[ly][c];
            var td = el('td');
            td.setAttribute('data-row', String(y));
            td.setAttribute('data-col', String(c));
            var spanRows = sp && sp.rowspan > 1 ? sp.rowspan : 1;
            var spanCols = sp && sp.colspan > 1 ? sp.colspan : 1;
            var cellH = 0;
            var i;
            for (i = 0; i < spanRows; i++) cellH += rowHeights[y + i] || rh;
            if (sp) {
                if (sp.rowspan > 1) td.rowSpan = sp.rowspan;
                if (sp.colspan > 1) td.colSpan = sp.colspan;
            }
            lockWidth(td, colSpanWidth(set, c, spanCols));
            var cell = cellAt(row, c);
            var fmt = effectiveFormat(model, row, cell);
            var place = placementOf(fmt);
            var text = displayText(cell, fmt);
            var cellPx = spanRows === 1 ? rh : cellH;
            var borders = spanBorders(model, y, c, spanRows, spanCols);
            applyCellStyle(td, model, cell, fmt, cellPx, false, place, borders);
            if (spanRows !== 1) {
                td.style.height = '';
                td.style.maxHeight = '';
            }
            if (text) td.className = (td.className ? td.className + ' ' : '') + 'tp-has-text';
            var inner = el('div', 'tp-cell tp-place-' + place);
            inner.style.height = cellPx + 'px';
            /* The inner box fills the cell, so `vertical-align` on the td can
             * never move the text: the alignment has to live here. */
            var va = alignCss(fmt && fmt.verticalAlignment, 'v', defaultVAlign(model));
            inner.style.display = 'flex';
            inner.style.flexDirection = 'column';
            inner.style.justifyContent =
                va === 'bottom' ? 'flex-end' : va === 'middle' ? 'center' : 'flex-start';
            if (place === 'auto') {
                inner.style.overflow = 'visible';
                inner.style.whiteSpace = 'nowrap';
            } else {
                inner.style.overflow = 'hidden';
            }
            if (text && place === 'auto' && spanCols === 1 && spanRows === 1) {
                var box = spillBox(model, row, set, spans, ly, c,
                    spanCols, alignCss(fmt && fmt.horizontalAlignment, 'h'));
                lockWidth(inner, box.width);
                if (box.left) inner.style.marginLeft = box.left + 'px';
                inner.style.overflow = 'hidden';
            }
            if (text) {
                var shown = place === 'block'
                    ? blockRepeat(text, colSpanWidth(set, c, spanCols), fontOf(model, fmt).height)
                    : text;
                var node = inner;
                if (isParamCell(cell, fmt) || (fmt && fmt.fillType === 'Template')) {
                    node = el('span', 'tp-param', shown);
                    inner.appendChild(node);
                } else {
                    inner.textContent = shown;
                }
                if (applyOrientation(inner, fmt)) inner.style.display = 'block';
            }
            td.appendChild(inner);
            td.addEventListener('click', (function (rowIdx, colIdx, cellRef) {
                return function (ev) {
                    ev.stopPropagation();
                    if (ctx.onSelect) ctx.onSelect({
                        name: (cellRef && (cellRef.parameter || cellRef.text)) || ('R' + (rowIdx + 1) + 'C' + (colIdx + 1)),
                        row: rowIdx,
                        col: colIdx,
                        id: 'r' + rowIdx + 'c' + colIdx,
                        area: area ? area.name : ''
                    });
                };
            })(y, c, cell));
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    var groupEl = el('div', 'tp-group');
    groupEl.style.position = 'relative';
    groupEl.appendChild(table);
    var lines = renderColAreaLines(model, set, group.columnsID);
    if (lines) groupEl.appendChild(lines);
    return groupEl;
}

function pictureDataUrl(model, pictureIndex) {
    var pics = model.pictures || [];
    var pic = null;
    var want = pictureIndex;
    var i;
    for (i = 0; i < pics.length; i++) {
        if (pics[i].index === want || pics[i].index === want - 1) { pic = pics[i]; break; }
    }
    if (!pic && want >= 1 && pics[want - 1]) pic = pics[want - 1];
    if (!pic && pics[want]) pic = pics[want];
    if (!pic || !pic.data) return '';
    return 'data:' + (pic.mime || 'image/png') + ';base64,' + pic.data;
}

function colLefts(set) {
    var lefts = [0];
    var acc = 0;
    for (var i = 0; i < set.size; i++) {
        acc += set.widths[i] || 0;
        lefts.push(acc);
    }
    return lefts;
}

function renderDrawings(model, wrap, rowTops, rowHeights) {
    var layer = el('div', 'tp-drawings');
    var drawings = model.drawings || [];
    drawings = drawings.slice().sort(function (a, b) { return (a.zOrder || 0) - (b.zOrder || 0); });
    for (var i = 0; i < drawings.length; i++) {
        var d = drawings[i];
        /* Charts, OLE objects and the like carry no geometry we can honour;
         * drawing an empty frame in their place is worse than leaving the
         * sheet alone, so they are skipped, as in the reference renderer. */
        if (d.drawingType === 'Other') continue;
        var row = model.rows[d.beginRow] || model.rows[0];
        var set = columnSetOf(model, row && row.columnsID);
        var lefts = colLefts(set);
        var x0 = (lefts[d.beginColumn] || 0) + widthToPx(d.beginColumnOffset);
        var x1 = (lefts[d.endColumn] || 0) + widthToPx(d.endColumnOffset);
        var y0 = (rowTops[d.beginRow] || 0) + heightToPx(d.beginRowOffset);
        var y1 = (rowTops[d.endRow] || 0) + heightToPx(d.endRowOffset);
        var w = x1 - x0;
        var h = y1 - y0;
        /* Degenerate geometry: 1C does not always write cell anchors for a
         * caption or a rectangle, and a zero-sized box would be an invisible
         * dot. The reference renderer falls back to the natural size of the
         * content, so the object at least reads. */
        if (w < 8 || h < 8) {
            var lines = String(d.text || '').split(/\r?\n/);
            var widest = 0;
            for (var li = 0; li < lines.length; li++) {
                if (lines[li].length > widest) widest = lines[li].length;
            }
            var fontPt = fontOf(model, formatByIndex(model.formats, d.formatIndex)).height || 8;
            var chPx = fontPt * (96 / 72) * 0.55;
            if (w < 8) w = Math.max(60, widest * chPx + 8);
            if (h < 8) h = Math.max(20, lines.length * fontPt * (96 / 72) * 1.2 + 6);
        }
        w = Math.max(4, w);
        h = Math.max(4, h);
        var box = el('div', 'tp-drawing');
        box.style.left = x0 + 'px';
        box.style.top = y0 + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
        var fmt = formatByIndex(model.formats, d.formatIndex);
        var b = fmt ? borderCss(lineOf(model, fmt.drawingBorder), fmt.bordersColor) : '';
        /* A caption or a rectangle is nothing but its frame and its text: when
         * the format names no line, 1C still draws a thin one. */
        if (!b && (d.drawingType === 'Text' || d.drawingType === 'Rectangle')) {
            b = '1px solid ' + (styleColor(fmt && fmt.bordersColor) || '#000');
        }
        if (b && b !== 'none') box.style.border = b;
        if (fmt) {
            var dbg = styleColor(fmt.backColor);
            if (dbg) box.style.background = dbg;
            var dpat = patternFill(fmt);
            if (dpat && dpat.color) box.style.background = dpat.color;
            else if (dpat && dpat.image) box.style.backgroundImage = dpat.image;
        }
        /* A drawing that is not a picture carries pictureIndex 0, which means
         * «no picture» — resolving it would hand a caption the first image of
         * the document. */
        var url = d.pictureIndex ? pictureDataUrl(model, d.pictureIndex) : '';
        if (url) {
            var img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.style.objectFit = 'contain';
            img.style.width = '100%';
            img.style.height = '100%';
            box.appendChild(img);
        } else if (d.text) {
            var cap = el('div', 'tp-drawing-text', d.text);
            var dfont = fontOf(model, fmt);
            cap.style.fontFamily = (dfont.faceName || 'Arial') + ', Arial, sans-serif';
            cap.style.fontSize = (dfont.height || 8) + 'pt';
            cap.style.fontWeight = dfont.bold ? 'bold' : 'normal';
            cap.style.fontStyle = dfont.italic ? 'italic' : 'normal';
            var dfg = styleColor(fmt && fmt.textColor);
            if (dfg) cap.style.color = dfg;
            box.appendChild(cap);
        }
        layer.appendChild(box);
    }
    wrap.appendChild(layer);
}

var COLHEAD_H = 18;
var COL_AREA_ROW_H = 16;

function syncChrome(container) {
    var wrap = container.querySelector('.tp-grid-wrap');
    var model = container._tpModel;
    if (!wrap || !model) return;
    var wrapRect = wrap.getBoundingClientRect();
    var rowTops = [];
    var rowHeights = [];
    var y;
    for (y = 0; y < model.height; y++) {
        var tr = wrap.querySelector('tr[data-row="' + y + '"]');
        var r = tr ? tr.getBoundingClientRect() : null;
        if (r && r.height > 0.5) {
            rowTops[y] = r.top - wrapRect.top + wrap.scrollTop;
            rowHeights[y] = r.height;
        } else {
            rowTops[y] = y ? rowTops[y - 1] + rowHeights[y - 1] : 0;
            rowHeights[y] = y ? rowHeights[y - 1] : 17;
        }
    }
    var nums = container.querySelectorAll('.tp-row-num');
    var last = model.height - 1;
    var totalH = (rowTops[last] || 0) + (rowHeights[last] || 0);
    var rowhead = container.querySelector('.tp-rowhead');
    if (rowhead) rowhead.style.height = totalH + 'px';
    for (y = 0; y < nums.length; y++) {
        nums[y].style.top = (rowTops[y] || 0) + 'px';
        nums[y].style.height = rowHeights[y] + 'px';
    }
    var rail = container.querySelector('.tp-areas');
    if (rail) {
        rail.style.height = totalH + 'px';
        var labels = rail.querySelectorAll('.tp-area-label');
        for (var i = 0; i < labels.length; i++) {
            var area = areaRange(model, labels[i].getAttribute('data-id'));
            if (!area) continue;
            var b = Math.max(0, area.beginRow);
            var e = Math.min(last, area.endRow);
            labels[i].style.top = (rowTops[b] || 0) + 'px';
            labels[i].style.height = Math.max(12, (rowTops[e] || 0) + (rowHeights[e] || 0) - (rowTops[b] || 0)) + 'px';
        }
    }
    syncRowAreaLines(container, rowTops, rowHeights, last);
    container._tpRowTops = rowTops;
    container._tpRowHeights = rowHeights;
}

function viewColumnSet(model, columnsID) {
    if (columnsID != null && columnsID !== false) {
        return columnSetOf(model, columnsID);
    }
    var best = null;
    var rows = model.rows || [];
    for (var i = 0; i < rows.length; i++) {
        var s = columnSetOf(model, rows[i].columnsID);
        if (!best || s.size > best.size) best = s;
    }
    return best || columnSetOf(model, '');
}

function fillColHead(bar, set) {
    bar.innerHTML = '';
    var table = el('table', 'tp-grid tp-colhead-table');
    table.style.tableLayout = 'fixed';
    var colgroup = el('colgroup');
    var tr = el('tr', 'tp-colhead');
    var c;
    for (c = 0; c < set.size; c++) {
        var col = document.createElement('col');
        lockWidth(col, set.widths[c]);
        if (col.setAttribute) col.setAttribute('width', String(Math.round(set.widths[c])));
        colgroup.appendChild(col);
        var th = el('th', '', String(c + 1));
        lockWidth(th, set.widths[c]);
        tr.appendChild(th);
    }
    table.appendChild(colgroup);
    table.style.width = set.widths.reduce(function (a, b) { return a + b; }, 0) + 'px';
    var thead = el('thead');
    thead.appendChild(tr);
    table.appendChild(thead);
    bar.appendChild(table);
}

function areaRange(model, name) {
    var items = model.namedItems || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.kind !== 'cells') continue;
        if (it.name === name) return it;
    }
    return null;
}

function renderColAreaRail(model, set) {
    var packed = columnAreaLevels(columnAreaItems(model, set && set.id));
    if (packed.maxLevel < 0) return null;
    var lefts = colLefts(set);
    var totalW = lefts[set.size] || 0;
    var rows = packed.maxLevel + 1;
    var rail = el('div', 'tp-col-areas');
    rail.style.position = 'relative';
    rail.style.height = (rows * COL_AREA_ROW_H) + 'px';
    rail.style.width = totalW + 'px';
    var i;
    for (i = 0; i < packed.items.length; i++) {
        var rec = packed.items[i];
        var it = rec.item;
        var bnds = colAreaBounds(it, set.size);
        if (!bnds) continue;
        var lab = el('div', 'tp-col-area-label', it.name);
        lab.style.position = 'absolute';
        lab.style.left = (lefts[bnds.begin] || 0) + 'px';
        lab.style.width = Math.max(12, (lefts[bnds.end + 1] || totalW) - (lefts[bnds.begin] || 0)) + 'px';
        lab.style.top = (rec.level * COL_AREA_ROW_H) + 'px';
        lab.style.height = COL_AREA_ROW_H + 'px';
        lab.setAttribute('data-id', it.name);
        lab.title = it.name;
        rail.appendChild(lab);
    }
    return rail;
}

function renderColAreaLines(model, set, columnsID) {
    var items = columnAreaItems(model, columnsID || '');
    if (!items.length) return null;
    var lefts = colLefts(set);
    var seen = {};
    var layer = el('div', 'tp-col-area-lines');
    var i;
    function addLine(x) {
        var key = String(Math.round(x * 10) / 10);
        if (seen[key] || x < 0) return;
        seen[key] = true;
        var ln = el('div', 'tp-col-area-line');
        ln.style.left = x + 'px';
        ln.style.top = '0';
        ln.style.bottom = '0';
        ln.style.height = '100%';
        layer.appendChild(ln);
    }
    for (i = 0; i < items.length; i++) {
        var bnds = colAreaBounds(items[i], set.size);
        if (!bnds) continue;
        addLine(lefts[bnds.begin] || 0);
        addLine(lefts[bnds.end + 1] || lefts[set.size] || 0);
    }
    if (!layer.children.length) return null;
    return layer;
}

function renderAreaRail(model, rowHeights, rowTops, totalH) {
    var rail = el('div', 'tp-areas');
    rail.style.height = totalH + 'px';
    rail.style.position = 'relative';
    eachRowArea(model, function (it, b, e) {
        var top = rowTops[b] || 0;
        var bottom = (rowTops[e] || 0) + (rowHeights[e] || 0);
        var lab = el('div', 'tp-area-label', it.name);
        lab.style.position = 'absolute';
        lab.style.left = '0';
        lab.style.right = '0';
        lab.style.top = top + 'px';
        lab.style.height = Math.max(12, bottom - top) + 'px';
        lab.setAttribute('data-id', it.name);
        lab.title = it.name;
        rail.appendChild(lab);
    });
    return rail;
}

function addRowAreaLine(layer, y, row, edge) {
    var ln = el('div', 'tp-row-area-line');
    ln.style.top = y + 'px';
    ln.setAttribute('data-row', String(row));
    ln.setAttribute('data-edge', edge);
    layer.appendChild(ln);
}

function renderRowAreaLines(model, rowTops, rowHeights) {
    var layer = el('div', 'tp-row-area-lines');
    eachRowArea(model, function (it, b, e) {
        addRowAreaLine(layer, rowTops[b] || 0, b, 'start');
        addRowAreaLine(layer, (rowTops[e] || 0) + (rowHeights[e] || 0), e, 'end');
    });
    return layer.children.length ? layer : null;
}

function syncRowAreaLines(container, rowTops, rowHeights, last) {
    var lines = container.querySelectorAll('.tp-row-area-line');
    if (!lines.length) return;
    var i;
    for (i = 0; i < lines.length; i++) {
        var row = parseInt(lines[i].getAttribute('data-row'), 10);
        if (!isFinite(row) || row < 0) continue;
        if (row > last) row = last;
        var y = rowTops[row] || 0;
        if (lines[i].getAttribute('data-edge') === 'end') y += rowHeights[row] || 0;
        lines[i].style.top = y + 'px';
    }
}

function renderRowHead(model, rowHeights) {
    var col = el('div', 'tp-rowhead');
    col.style.position = 'relative';
    for (var i = 0; i < model.height; i++) {
        var lab = el('div', 'tp-row-num', String(i + 1));
        lab.style.position = 'absolute';
        lab.style.left = '0';
        lab.style.right = '0';
        lab.style.top = '0';
        lab.style.height = rowHeights[i] + 'px';
        lab.setAttribute('data-row', String(i));
        col.appendChild(lab);
    }
    return col;
}

function syncAreaHighlight(container, id) {
    var ov = container.querySelector('.tp-hi');
    var model = container._tpModel;
    var rowTops = container._tpRowTops;
    var rowHeights = container._tpRowHeights;
    if (!ov || !model || !rowTops) return;
    var area = areaRange(model, id);
    if (!area) {
        ov.hidden = true;
        return;
    }
    ov.hidden = false;
    if (isColumnArea(area)) {
        var set = viewColumnSet(model, area.columnsID);
        var lefts = colLefts(set);
        var bnds = colAreaBounds(area, set.size);
        if (!bnds) { ov.hidden = true; return; }
        var last = model.height - 1;
        var bottom = (rowTops[last] || 0) + (rowHeights[last] || 0);
        ov.style.left = (lefts[bnds.begin] || 0) + 'px';
        ov.style.width = Math.max(1, (lefts[bnds.end + 1] || lefts[set.size] || 0) - (lefts[bnds.begin] || 0)) + 'px';
        ov.style.right = 'auto';
        ov.style.top = '0';
        ov.style.height = Math.max(1, bottom) + 'px';
        return;
    }
    if (area.beginRow == null) {
        ov.hidden = true;
        return;
    }
    var b = Math.max(0, area.beginRow);
    var e = Math.min(model.height - 1, area.endRow);
    var top = rowTops[b] || 0;
    var bottom = (rowTops[e] || 0) + (rowHeights[e] || 0);
    ov.style.left = '0';
    ov.style.right = '0';
    ov.style.width = 'auto';
    ov.style.top = top + 'px';
    ov.style.height = Math.max(1, bottom - top) + 'px';
}

function centerInScroll(sc, target, axis) {
    if (!sc || !target) return;
    if (!sc.getBoundingClientRect || !target.getBoundingClientRect) return;
    var sr = sc.getBoundingClientRect();
    var tr = target.getBoundingClientRect();
    if (!(sr.width > 0 || sr.height > 0)) return;
    axis = axis || 'both';
    if (axis === 'v' || axis === 'both') {
        var nextTop = sc.scrollTop + (tr.top - sr.top) - (sr.height - tr.height) / 2;
        var maxTop = Math.max(0, (sc.scrollHeight || 0) - sr.height);
        sc.scrollTop = Math.max(0, Math.min(nextTop, maxTop));
    }
    if (axis === 'h' || axis === 'both') {
        var nextLeft = sc.scrollLeft + (tr.left - sr.left) - (sr.width - tr.width) / 2;
        var maxLeft = Math.max(0, (sc.scrollWidth || 0) - sr.width);
        sc.scrollLeft = Math.max(0, Math.min(nextLeft, maxLeft));
    }
}

function outlineIcon(it) {
    if (it && (it.areaType === 'Columns' || it.type === 'Columns')) {
        return { cls: 'icon-tpl-col', ch: '|' };
    }
    return { cls: 'icon-tpl-row', ch: '\u2014' };
}

function highlight(container, id) {
    if (!container || !id) return null;
    var prev = container.querySelectorAll('.tp-selected');
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove('tp-selected');
    var safe = String(id).replace(/"/g, '');
    var hit = container.querySelector('.tp-area-label[data-id="' + safe + '"]')
        || container.querySelector('.tp-col-area-label[data-id="' + safe + '"]');
    var rows = container.querySelectorAll('tr[data-area="' + safe + '"]');
    if (hit) hit.classList.add('tp-selected');
    for (var r = 0; r < rows.length; r++) {
        rows[r].classList.add('tp-selected');
        if (!hit) hit = rows[r];
    }
    var cell = container.querySelector('td[data-id="' + safe + '"]');
    if (cell) {
        cell.classList.add('tp-selected');
        hit = cell;
    }
    syncAreaHighlight(container, id);
    var model = container._tpModel;
    var bar = container.querySelector('.tp-colhead-bar');
    var area = model ? areaRange(model, id) : null;
    if (bar && model && area && area.columnsID != null) {
        fillColHead(bar, viewColumnSet(model, area.columnsID));
    }
    var sc = container.querySelector('.tp-scroll');
    var ov = container.querySelector('.tp-hi');
    var target = (ov && !ov.hidden) ? ov : hit;
    var axis = 'both';
    if (area && isColumnArea(area)) axis = 'h';
    else if (area) axis = 'v';
    centerInScroll(sc, target, axis);
    return hit;
}

/* A row-group's own column set (`renderGroupTable`) is already correct — each
 * group draws with its own widths. The sticky ruler at the top is the part
 * that used to freeze on the widest set at mount and never follow the scroll:
 * scrolled into a section with its own (usually narrower, unevenly sized)
 * columns, the ruler kept showing the wrong widths and any Columns-type named
 * area belonging to that section never appeared in it. */
function buildColumnChrome(model, columnsID) {
    var set = viewColumnSet(model, columnsID);
    var colAreas = renderColAreaRail(model, set);
    var colHead = el('div', 'tp-colhead-bar');
    fillColHead(colHead, set);
    var chromeH = COLHEAD_H + (colAreas ? (columnAreaLevels(columnAreaItems(model, set.id)).maxLevel + 1) * COL_AREA_ROW_H : 0);
    return { colAreas: colAreas, colHead: colHead, chromeH: chromeH };
}

function groupForRowIndex(groups, row) {
    for (var i = 0; i < groups.length; i++) {
        if (row >= groups[i].start && row < groups[i].end) return groups[i];
    }
    return groups[0] || { columnsID: '' };
}

function rowAtScrollTop(rowTops, rowHeights, height, scrollTop) {
    var row = 0;
    for (var y = 0; y < height; y++) {
        row = y;
        if ((rowTops[y] || 0) + (rowHeights[y] || 0) > scrollTop + 1) break;
    }
    return row;
}

/* Re-picks the ruler for whichever row-group now sits at the top of the
 * viewport, and only touches the DOM when that group actually changed. */
function updateColumnChrome(container) {
    var model = container._tpModel;
    var groups = container._tpGroups;
    var rowTops = container._tpRowTops;
    var rowHeights = container._tpRowHeights;
    var sc = container.querySelector('.tp-scroll');
    var colChrome = container.querySelector('.tp-col-chrome');
    var corner = container.querySelector('.tp-corner');
    if (!model || !groups || !rowTops || !sc || !colChrome || !corner) return;
    var row = rowAtScrollTop(rowTops, rowHeights, model.height, sc.scrollTop);
    var columnsID = groupForRowIndex(groups, row).columnsID || '';
    if (columnsID === container._tpChromeColumnsID) return;
    container._tpChromeColumnsID = columnsID;
    var chrome = buildColumnChrome(model, columnsID);
    colChrome.innerHTML = '';
    if (chrome.colAreas) colChrome.appendChild(chrome.colAreas);
    colChrome.appendChild(chrome.colHead);
    corner.style.height = chrome.chromeH + 'px';
    corner.style.flexBasis = chrome.chromeH + 'px';
    if (container._tpOnAreaClick && chrome.colAreas) {
        chrome.colAreas.addEventListener('click', container._tpOnAreaClick);
    }
}

function render(model, container, options) {
    options = options || {};
    container.innerHTML = '';
    container.className = 'tp-root';
    if (!model) {
        container.appendChild(el('div', 'tp-empty', 'Нет модели макета'));
        return;
    }
    var scroll = el('div', 'tp-scroll');
    var sheet = el('div', 'tp-sheet');

    var groups = groupsOf(model);
    var rowHeights = [];
    var rowTops = [];
    var acc = 0;
    var y;
    for (y = 0; y < model.height; y++) {
        rowTops[y] = acc;
        var rh = rowHeight(model, model.rows[y]);
        rowHeights[y] = rh.px;
        acc += rh.px;
    }

    var left = el('div', 'tp-left');
    var corner = el('div', 'tp-corner');
    var leftBody = el('div', 'tp-left-body');
    var chrome0 = buildColumnChrome(model, groupForRowIndex(groups, 0).columnsID || '');
    var colChrome = el('div', 'tp-col-chrome');
    var colAreas = chrome0.colAreas;
    if (colAreas) colChrome.appendChild(colAreas);
    colChrome.appendChild(chrome0.colHead);
    corner.style.height = chrome0.chromeH + 'px';
    corner.style.flexBasis = chrome0.chromeH + 'px';
    var rail = renderAreaRail(model, rowHeights, rowTops, acc);
    var nums = renderRowHead(model, rowHeights);
    leftBody.appendChild(rail);
    leftBody.appendChild(nums);
    left.appendChild(corner);
    left.appendChild(leftBody);

    var right = el('div', 'tp-right');
    var gridWrap = el('div', 'tp-grid-wrap');
    var ctx = { onSelect: options.onSelect };
    for (var g = 0; g < groups.length; g++) {
        gridWrap.appendChild(renderGroupTable(model, groups[g], ctx, rowHeights));
    }
    var hi = el('div', 'tp-hi');
    hi.hidden = true;
    gridWrap.appendChild(hi);
    var rowLines = renderRowAreaLines(model, rowTops, rowHeights);
    if (rowLines) gridWrap.appendChild(rowLines);
    renderDrawings(model, gridWrap, rowTops, rowHeights);
    right.appendChild(colChrome);
    right.appendChild(gridWrap);

    sheet.appendChild(left);
    sheet.appendChild(right);
    scroll.appendChild(sheet);
    container.appendChild(scroll);
    container._tpOnSelect = options.onSelect;
    container._tpModel = model;
    container._tpRowTops = rowTops;
    container._tpRowHeights = rowHeights;
    container._tpGroups = groups;
    container._tpChromeColumnsID = groupForRowIndex(groups, 0).columnsID || '';
    syncChrome(container);

    if (options.onSelect) {
        function onAreaClick(ev) {
            var lab = ev.target.closest && (ev.target.closest('.tp-area-label') || ev.target.closest('.tp-col-area-label'));
            if (!lab) return;
            options.onSelect({ name: lab.getAttribute('data-id'), id: lab.getAttribute('data-id') });
        }
        container._tpOnAreaClick = onAreaClick;
        rail.addEventListener('click', onAreaClick);
        if (colAreas) colAreas.addEventListener('click', onAreaClick);
    }
    scroll.addEventListener('scroll', function () { updateColumnChrome(container); });
}

root.TemplatePreview = {
    detect: detect,
    parse: parse,
    render: render,
    outline: outline,
    outlineIcon: outlineIcon,
    highlight: highlight,
    itemKey: itemKey,
    _test: {
        unitToPx: widthToPx,
        widthToPx: widthToPx,
        heightToPx: heightToPx,
        WIDTH_PX: WIDTH_PX,
        HEIGHT_PX: HEIGHT_PX,
        DEFAULT_WIDTH_U: DEFAULT_WIDTH_U,
        DEFAULT_HEIGHT_U: DEFAULT_HEIGHT_U,
        displayText: displayText,
        isParamCell: isParamCell,
        widthOfFormat: widthOfFormat,
        heightOfFormat: heightOfFormat,
        formatByIndex: formatByIndex,
        columnSetOf: columnSetOf,
        cellAt: cellAt,
        groupsOf: groupsOf,
        viewColumnSet: viewColumnSet,
        areaForRow: areaForRow,
        columnAreaItems: columnAreaItems,
        columnAreaLevels: columnAreaLevels,
        colAreaBounds: colAreaBounds,
        placementOf: placementOf,
        effectiveFormat: effectiveFormat,
        borderCss: borderCss,
        sideBorder: sideBorder,
        alignCss: alignCss,
        defaultVAlign: defaultVAlign,
        patternFill: patternFill,
        blockRepeat: blockRepeat,
        spillBox: spillBox,
        isColumnArea: isColumnArea,
        eachRowArea: eachRowArea,
        buildSpans: buildSpans,
        spanBorders: spanBorders,
        colSpanWidth: colSpanWidth,
        parseRow: parseRow,
        parseMerge: parseMerge,
        parseNamedItem: parseNamedItem,
        localizedFrom: localizedFrom,
        centerInScroll: centerInScroll,
        outlineIcon: outlineIcon,
        pictureDataUrl: pictureDataUrl
    }
};

})(window);
