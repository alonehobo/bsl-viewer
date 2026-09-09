/* MXL8 (1C 8.x / BAS spreadsheet) → the same document model as TemplatePreview.
 *
 * Format and parser logic follow azubar/SpreadSheet (MIT),
 * spreadsheet/src/mxl_parser.rs and docs/format-mxl.md.
 * This module does not rasterize; TemplatePreview.render draws the grid. */
(function (root) {
'use strict';

var ROWS_START_INDEX = 15;
var DEFAULT_WIDTH_U = 72;
var DEFAULT_HEIGHT_U = 45;
var HEIGHT_MXL_TO_XML = 254 / 288;

function err(msg) { return { error: String(msg || 'Ошибка разбора MXL') }; }

function asNum(v) {
    return v && v.t === 'n' ? v.v : null;
}

function asStr(v) {
    return v && v.t === 's' ? v.v : null;
}

function asList(v) {
    return v && v.t === 'l' ? v.v : null;
}

function asAtom(v) {
    return v && v.t === 'a' ? v.v : null;
}

function parseBody(text) {
    var stack = [[]];
    var i = 0;
    var n = text.length;
    while (i < n) {
        var ch = text.charCodeAt(i);
        if (ch === 32 || ch === 9 || ch === 13 || ch === 10 || ch === 44) { i++; continue; }
        if (ch === 123) { stack.push([]); i++; continue; }
        if (ch === 125) {
            var done = stack.pop();
            if (!done || !stack.length) throw new Error('MXL: несбалансированные скобки');
            stack[stack.length - 1].push({ t: 'l', v: done });
            i++;
            continue;
        }
        if (ch === 34) {
            var s = '';
            i++;
            for (;;) {
                if (i >= n) throw new Error('MXL: незакрытая строка в кавычках');
                if (text.charCodeAt(i) === 34) {
                    if (i + 1 < n && text.charCodeAt(i + 1) === 34) { s += '"'; i += 2; }
                    else { i++; break; }
                } else {
                    s += text.charAt(i);
                    i++;
                }
            }
            stack[stack.length - 1].push({ t: 's', v: s });
            continue;
        }
        var start = i;
        while (i < n) {
            ch = text.charCodeAt(i);
            if (ch === 32 || ch === 9 || ch === 13 || ch === 10 || ch === 44 || ch === 123 || ch === 125) break;
            i++;
        }
        var tok = text.slice(start, i);
        if (/^-?\d+$/.test(tok)) stack[stack.length - 1].push({ t: 'n', v: parseInt(tok, 10) });
        else stack[stack.length - 1].push({ t: 'a', v: tok });
    }
    if (stack.length !== 1) throw new Error('MXL: не хватает закрывающих скобок');
    return stack[0];
}

function stripHeader(text) {
    if (!text) return '';
    var s = String(text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var mox = s.indexOf('MOXCEL');
    if (mox === 0) {
        var brace = s.indexOf('{');
        if (brace < 0) return s;
        return s.slice(brace);
    }
    var t = s.replace(/^\s+/, '');
    return t;
}

function isV77(text) {
    if (!text || text.indexOf('MOXCEL') !== 0) return false;
    var i;
    for (i = 6; i <= 10; i++) {
        if (text.charCodeAt(i) !== 0) return false;
    }
    var v = text.charCodeAt(11);
    return v === 6 || v === 7;
}

function detect(text) {
    if (!text || typeof text !== 'string') return false;
    if (text.indexOf('xcf/logform') >= 0) return false;
    if (text.indexOf('v8.1c.ru/8.2/data/spreadsheet') >= 0) return false;
    if (text.indexOf('MOXCEL') === 0) return true;
    var s = stripHeader(text);
    return /^\{\s*8\s*,\s*1\s*,/.test(s);
}

function cellFromValue(fields) {
    if (!fields || fields.length < 2) return null;
    var marker = asNum(fields[0]);
    if (marker == null) return null;
    var format = asNum(fields[1]);
    if (format == null || format < 0) format = 0;
    var text = null;
    var next = 2;
    if (marker & 2) {
        var tv = asList(fields[next]);
        if (tv && tv.length >= 2) {
            var kind = asStr(tv[0]);
            if (kind === 'S') text = asStr(tv[1]);
            else if (kind === 'N' || kind === 'B' || kind === 'D') {
                if (asStr(tv[1]) != null) text = asStr(tv[1]);
                else if (asNum(tv[1]) != null) text = String(asNum(tv[1]));
            } else if (asStr(tv[1]) != null) text = asStr(tv[1]);
            next += 1;
        }
    }
    if (marker & 4) next += 1;
    if (marker & 16) {
        var locText = localizedText(asList(fields[next]));
        if (locText) text = locText;
    }
    return { format: format, text: text };
}

function localizedText(loc) {
    if (!loc || !loc.length) return null;
    var pairs = [];
    var i;
    for (i = 0; i < loc.length; i++) {
        var pair = asList(loc[i]);
        if (pair && pair.length >= 2 && asStr(pair[0]) != null && asStr(pair[1]) != null) {
            pairs.push({ lang: asStr(pair[0]), text: asStr(pair[1]) });
        }
    }
    if (!pairs.length) return null;
    for (i = 0; i < pairs.length; i++) {
        if (pairs[i].lang === 'ru') return pairs[i].text;
    }
    return pairs[0].text;
}

function parseRows(root, start) {
    var i = start;
    function numAt(idx) {
        var n = asNum(root[idx]);
        if (n == null) throw new Error('MXL8: ожидалось число в поле ' + idx);
        return n;
    }
    var nrows = numAt(i);
    if (nrows < 0 || nrows > 1000000) throw new Error('MXL8: неправдоподобное число строк ' + nrows);
    i += 1;
    var rows = [];
    var prev = -1;
    var r;
    for (r = 0; r < nrows; r++) {
        var index = numAt(i);
        var format = numAt(i + 1);
        var ncells = numAt(i + 2);
        if (index <= prev || index < 0) throw new Error('MXL8: номера строк не возрастают');
        if (ncells < 0 || ncells > 100000) throw new Error('MXL8: неправдоподобное число ячеек ' + ncells);
        prev = index;
        i += 3;
        var cells = [];
        var c;
        for (c = 0; c < ncells; c++) {
            var col = numAt(i);
            var cellFields = asList(root[i + 1]);
            if (!cellFields) throw new Error('MXL8: ожидался объект ячейки');
            if (col < 0) throw new Error('MXL8: отрицательный номер колонки');
            var cell = cellFromValue(cellFields) || { format: 0, text: null };
            cells.push({ col: col, format: cell.format, text: cell.text });
            i += 2;
        }
        rows.push({ index: index, format: format < 0 ? 0 : format, cells: cells });
    }
    return { rows: rows, end: i };
}

function columnGroupFromValue(v) {
    var fields = asList(v);
    if (!fields || fields.length < 4) return null;
    if (asNum(fields[0]) == null) return null;
    var n = asNum(fields[3]);
    if (n == null || n < 0 || fields.length !== 4 + 2 * n) return null;
    var columns = [];
    var k;
    for (k = 0; k < n; k++) {
        var col = asNum(fields[4 + 2 * k]);
        var fmt = asNum(fields[5 + 2 * k]);
        if (col == null || fmt == null || col < 0 || fmt < 0) return null;
        columns.push({ col: col, format: fmt });
    }
    return { columns: columns, id: groupId(asAtom(fields[2]) || asStr(fields[2])) };
}

function groupId(guid) {
    if (!guid) return '';
    var s = String(guid);
    if (s === '00000000-0000-0000-0000-000000000000') return '';
    return s;
}

function formatFromValue(fields) {
    var fmt = {};
    if (!fields || !fields.length) return fmt;
    var flags = asNum(fields[0]);
    if (flags == null || flags < 0) return fmt;
    var vi = 1;
    var bit;
    for (bit = 0; bit < 40; bit++) {
        if (Math.floor(flags / Math.pow(2, bit)) % 2 === 0) continue;
        var value = asNum(fields[vi]);
        vi += 1;
        if (value == null) continue;
        if (bit === 0) fmt.font = value;
        else if (bit === 1) fmt.border_left = value;
        else if (bit === 2) fmt.border_top = value;
        else if (bit === 3) fmt.border_right = value;
        else if (bit === 4) fmt.border_bottom = value;
        else if (bit === 5) fmt.borders_color = value;
        else if (bit === 6) fmt.height = value;
        else if (bit === 7 && value >= 0) fmt.width = value;
        else if (bit === 8 && value >= 0) fmt.h_align = value;
        else if (bit === 9 && value >= 0) fmt.v_align = value;
        else if (bit === 10 && value >= 0) fmt.text_color = value;
        else if (bit === 11 && value >= 0) fmt.bg_color = value;
        else if (bit === 12 && value >= 0) fmt.pattern = value;
        else if (bit === 13 && value >= 0) fmt.pattern_color = value;
        else if (bit === 14 && value >= 0) fmt.text_control = value;
        else if (bit === 15 && value >= 0) {
            fmt.fillType = value === 1 ? 'Parameter' : value === 2 ? 'Template' : 'Text';
        }
        else if (bit === 18) fmt.orientation = value;
    }
    return fmt;
}

var FF_FAMILY = 1, FF_HEIGHT = 2, FF_WEIGHT = 4, FF_ITALIC = 8, FF_UNDERLINE = 16, FF_STRIKEOUT = 32;

function firstString(fields) {
    var i;
    for (i = 0; i < (fields || []).length; i++) {
        var s = asStr(fields[i]);
        if (s) return s;
    }
    return '';
}

function fontFromValue(fields) {
    var font = { faceName: 'Arial', height: 8, bold: false, italic: false, underline: false, strikeout: false };
    if (!fields || fields.length < 3) return font;
    var tag = asNum(fields[0]);
    if (tag !== 6 && tag !== 7) return font;
    var kind = asNum(fields[1]);
    if (kind === 0) {
        var h = asNum(fields[3]);
        if (h > 0) font.height = h / 10;
        var w = asNum(fields[7]);
        font.bold = w != null && w >= 600;
        font.italic = !!asNum(fields[8]);
        font.underline = !!asNum(fields[9]);
        font.strikeout = !!asNum(fields[10]);
        var name = firstString(fields);
        if (name) font.faceName = name;
        return font;
    }
    var flags = asNum(fields[2]) || 0;
    var vi = 3;
    if (fields[vi] && fields[vi].t === 'l') vi += 1;
    function take(present, isStr) {
        if (!present) return null;
        var v = fields[vi];
        vi += 1;
        if (isStr) return asStr(v) || asAtom(v);
        return asNum(v);
    }
    var fam = take(!!(flags & FF_FAMILY), true);
    if (fam) font.faceName = fam;
    else if (flags & FF_FAMILY) take(true, false);
    var h2 = take(!!(flags & FF_HEIGHT), false);
    if (h2 > 0) font.height = h2 / 10;
    var w2 = take(!!(flags & FF_WEIGHT), false);
    if (w2 != null) font.bold = w2 >= 600;
    var it = take(!!(flags & FF_ITALIC), false);
    if (it != null) font.italic = it !== 0;
    var un = take(!!(flags & FF_UNDERLINE), false);
    if (un != null) font.underline = un !== 0;
    var st = take(!!(flags & FF_STRIKEOUT), false);
    if (st != null) font.strikeout = st !== 0;
    return font;
}

function colorFromValue(v) {
    var fields = asList(v);
    if (!fields || fields.length < 3 || asNum(fields[0]) !== 3) return null;
    var kind = asNum(fields[1]);
    var inner = asList(fields[2]);
    var value = inner && inner.length ? asNum(inner[0]) : null;
    if (kind === 0 && value != null && value >= 0 && value <= 0xFFFFFF) {
        return {
            rgb: '#' + ('000000' + (
                ((value & 0xFF) << 16) | (value & 0xFF00) | ((value >> 16) & 0xFF)
            ).toString(16)).slice(-6)
        };
    }
    return { auto: true };
}

function findColorTable(root, start) {
    var i = start;
    while (i + 1 < root.length) {
        var n = asNum(root[i]);
        if (n > 0 && n <= 10000 && i + n < root.length) {
            var colors = [];
            var k;
            var ok = true;
            for (k = 0; k < n; k++) {
                var c = colorFromValue(root[i + 1 + k]);
                if (!c) { ok = false; break; }
                colors.push(c);
            }
            if (ok && colors.length === n) return { colors: colors, end: i + 1 + n };
        }
        i += 1;
    }
    return null;
}

function lineFromRecord(rec) {
    if (!rec || rec.length < 5 || asNum(rec[0]) !== 4 || asNum(rec[1]) !== 0) return null;
    var kind = asNum(rec[3]);
    var thickness = asNum(rec[4]);
    if (kind == null || thickness == null) return null;
    if (kind < 0) kind = 0;
    if (thickness < 0) thickness = 0;
    return { kind: kind, thickness: thickness };
}

function findLineTable(root) {
    var fi;
    for (fi = 0; fi < root.length; fi++) {
        var items = asList(root[fi]);
        if (!items || !items.length) continue;
        var n = asNum(items[0]);
        if (n == null || n < 1 || n > 100000 || items.length !== 1 + 3 * n) continue;
        var lines = [];
        var ok = true;
        var k;
        for (k = 0; k < n; k++) {
            var rec = asList(items[2 + 3 * k]);
            var line = rec && lineFromRecord(rec);
            if (!line) { ok = false; break; }
            lines.push(line);
        }
        if (ok && lines.length) return lines;
    }
    return [];
}

function drawingFromValue(v) {
    var fields = asList(v);
    if (!fields || fields.length < 11) return null;
    var cellLike = asList(fields[0]);
    var cell = cellFromValue(cellLike);
    if (!cell) return null;
    var kindNum = asNum(fields[1]);
    if (kindNum == null) return null;
    var kind = kindNum === 2 ? 'Rectangle' : kindNum === 3 ? 'Text' : kindNum === 5 ? 'Picture' : 'Other';
    function num(idx) {
        var n = asNum(fields[idx]);
        if (n == null) return null;
        return n < 0 ? 0 : n;
    }
    var colStart = num(2), rowStart = num(3), colEnd = num(6), rowEnd = num(7);
    var o0 = num(4), o1 = num(5), o2 = num(8), o3 = num(9);
    if (colStart == null || rowStart == null || colEnd == null || rowEnd == null) return null;
    if (o0 == null || o1 == null || o2 == null || o3 == null) return null;
    return {
        kind: kind,
        col_start: colStart,
        row_start: rowStart,
        col_end: colEnd,
        row_end: rowEnd,
        offsets: [o0, o1, o2, o3],
        format: cell.format,
        text: cell.text,
        picture: kind === 'Picture' ? num(11) : null
    };
}

function pictureFromValue(v) {
    var fields = asList(v);
    if (!fields) return null;
    var i;
    for (i = 0; i < fields.length; i++) {
        var inner = asList(fields[i]);
        if (!inner) continue;
        var atoms = [];
        var allAtoms = true;
        var k;
        for (k = 0; k < inner.length; k++) {
            var a = asAtom(inner[k]);
            if (a == null) { allAtoms = false; break; }
            atoms.push(a);
        }
        if (allAtoms && atoms.length && atoms[0].indexOf('#base64:') === 0) {
            var joined = atoms[0].slice(8);
            for (k = 1; k < atoms.length; k++) joined += atoms[k];
            return joined.replace(/\s+/g, '');
        }
        var nested = pictureFromValue(fields[i]);
        if (nested) return nested;
    }
    return null;
}

function findPictureTable(root, start) {
    var i = start;
    while (i + 1 < root.length) {
        var n = asNum(root[i]);
        if (n > 0 && n <= 1000 && i + n < root.length) {
            var entries = root.slice(i + 1, i + 1 + n);
            var k;
            var allList = true;
            var anyPic = false;
            for (k = 0; k < entries.length; k++) {
                if (!asList(entries[k])) { allList = false; break; }
                if (pictureFromValue(entries[k])) anyPic = true;
            }
            if (allList && anyPic) {
                var pics = [];
                for (k = 0; k < entries.length; k++) pics.push(pictureFromValue(entries[k]) || '');
                return pics;
            }
        }
        i += 1;
    }
    return null;
}

function mergesFromValue(v) {
    var fields = asList(v);
    if (!fields || !fields.length) return null;
    var n = asNum(fields[0]);
    if (n == null || n <= 0 || fields.length !== n + 1) return null;
    var merges = [];
    var i;
    for (i = 1; i < fields.length; i++) {
        var rect = asList(fields[i]);
        if (!rect || rect.length !== 5) return null;
        var l = asNum(rect[0]), t = asNum(rect[1]), r = asNum(rect[2]), b = asNum(rect[3]), flag = asNum(rect[4]);
        if (l == null || t == null || r == null || b == null || flag == null) return null;
        if (flag !== 0 || l < 0 || t < 0 || r < l || b < t) continue;
        merges.push({ left: l, top: t, right: r, bottom: b });
    }
    return merges;
}

function findFormatAndFontTables(root, start) {
    var i = start;
    while (i + 1 < root.length) {
        var n = asNum(root[i]);
        if (n > 0 && n <= 10000 && i + n + 1 < root.length) {
            var entriesOk = true;
            var k;
            for (k = 0; k < n; k++) {
                var lst = asList(root[i + 1 + k]);
                if (!lst || asNum(lst[0]) == null) { entriesOk = false; break; }
            }
            if (entriesOk) {
                var j = i + n + 1;
                var m = asNum(root[j]);
                if (m > 0 && m <= 1000 && j + m < root.length) {
                    var fontsOk = true;
                    for (k = 0; k < m; k++) {
                        var fl = asList(root[j + 1 + k]);
                        var tag = fl && asNum(fl[0]);
                        if (tag !== 6 && tag !== 7) { fontsOk = false; break; }
                    }
                    if (fontsOk) {
                        var formats = [];
                        var fonts = [];
                        for (k = 0; k < n; k++) formats.push(formatFromValue(asList(root[i + 1 + k]) || []));
                        for (k = 0; k < m; k++) fonts.push(fontFromValue(asList(root[j + 1 + k]) || []));
                        return { formats: formats, fonts: fonts, end: j + 1 + m };
                    }
                }
            }
        }
        i += 1;
    }
    return null;
}

function namedItemsFromValue(v) {
    var fields = asList(v);
    if (!fields || !fields.length) return null;
    var n = asNum(fields[0]);
    if (n == null || n < 1 || n > 10000 || fields.length !== 1 + 2 * n) return null;
    var items = [];
    var k;
    for (k = 0; k < n; k++) {
        var name = asStr(fields[1 + 2 * k]);
        var spec = asList(fields[2 + 2 * k]);
        if (!name || !spec || !spec.length) return null;
        var kind = asNum(spec[0]);
        if (kind == null) return null;
        if (kind === 2) {
            items.push({ kind: 'drawing', name: name, drawingID: asNum(spec[1]) || 0 });
            continue;
        }
        var area = asList(spec[1]) || spec;
        var typeNum = asNum(area[0]);
        var beginColumn = asNum(area[1]);
        var beginRow = asNum(area[2]);
        var endColumn = asNum(area[3]);
        var endRow = asNum(area[4]);
        var columnsID = groupId(asAtom(area[5]) || asStr(area[5]));
        if (beginColumn == null) beginColumn = -1;
        if (endColumn == null) endColumn = -1;
        if (beginRow == null) beginRow = 0;
        if (endRow == null) endRow = beginRow;
        var type = 'Rows';
        if (typeNum === 3) type = 'Rectangle';
        else if (typeNum === 2 || (beginRow < 0 && endRow < 0 && beginColumn >= 0)) type = 'Columns';
        else if (typeNum === 1 || (beginColumn < 0 && endColumn < 0)) type = 'Rows';
        else type = 'Rectangle';
        items.push({
            kind: 'cells',
            name: name,
            type: type,
            beginRow: beginRow < 0 ? 0 : beginRow,
            endRow: endRow < 0 ? beginRow : endRow,
            beginColumn: beginColumn,
            endColumn: endColumn,
            columnsID: columnsID
        });
    }
    return items;
}

function parseTail(root, rowsEnd, doc) {
    var i = rowsEnd;
    var group = columnGroupFromValue(root[i]);
    if (group) {
        doc.default_group = group;
        i += 1;
        if (asNum(root[i]) != null) i += 1;
        var extra = asNum(root[i]);
        if (extra != null && extra >= 0 && extra <= 1000) {
            var groups = [];
            var ok = true;
            var k;
            for (k = 0; k < extra; k++) {
                var g = columnGroupFromValue(root[i + 1 + k]);
                if (!g) { ok = false; break; }
                groups.push(g);
            }
            if (ok) {
                doc.extra_groups = groups;
                i += 1 + extra;
                var npairs = asNum(root[i]);
                if (npairs != null && npairs >= 0 && npairs <= 1000000) {
                    var need = 2 * npairs;
                    var pairs = [];
                    var p;
                    for (p = 0; p < need; p++) {
                        var num = asNum(root[i + 1 + p]);
                        if (num == null) break;
                        pairs.push(num);
                    }
                    if (pairs.length === need) {
                        doc.row_groups = [];
                        for (p = 0; p < pairs.length; p += 2) {
                            if (pairs[p] >= 0 && pairs[p + 1] >= 0)
                                doc.row_groups.push({ row: pairs[p], group: pairs[p + 1] });
                        }
                        i += 1 + need;
                    }
                }
            }
        }
    }
    if (asNum(root[i]) != null) {
        var dn = asNum(root[i + 1]);
        if (dn != null && dn >= 1 && dn <= 10000) {
            var drawings = [];
            var d;
            var dok = true;
            for (d = 0; d < dn; d++) {
                var dr = drawingFromValue(root[i + 2 + d]);
                if (!dr) { dok = false; break; }
                drawings.push(dr);
            }
            if (dok && drawings.length === dn) {
                doc.drawings = drawings;
                i += 2 + dn;
            }
        }
    }
    var vi;
    for (vi = i; vi < root.length; vi++) {
        var merges = mergesFromValue(root[vi]);
        if (merges) { doc.merges = merges; break; }
    }
    for (vi = i; vi < root.length; vi++) {
        var named = namedItemsFromValue(root[vi]);
        if (named && named.length) { doc.namedItems = named; break; }
    }
    var tables = findFormatAndFontTables(root, i);
    if (tables) {
        doc.formats = tables.formats;
        doc.fonts = tables.fonts;
        var colors = findColorTable(root, tables.end);
        if (colors) {
            doc.colors = colors.colors;
            var hasPic = false;
            var di;
            for (di = 0; di < doc.drawings.length; di++) {
                if (doc.drawings[di].kind === 'Picture') hasPic = true;
            }
            if (hasPic) {
                var pics = findPictureTable(root, colors.end);
                if (pics) doc.pictures = pics;
            }
        }
    }
}

function parseDocument(text) {
    if (isV77(text)) {
        return err('файл сохранён в формате 1С 7.7 (бинарный MOXCEL) — не поддерживается');
    }
    var body = stripHeader(text);
    if (!body) return err('файл не является табличным документом MXL (нет сигнатуры MOXCEL)');
    var top;
    try {
        top = parseBody(body);
    } catch (e) {
        return err(e.message || e);
    }
    var root = top && top[0] && asList(top[0]);
    if (!root) return err('MXL8: не найден корневой объект документа');
    if (root.length < ROWS_START_INDEX + 1) return err('MXL8: корневой объект слишком короткий');
    var parsed = null;
    try { parsed = parseRows(root, ROWS_START_INDEX); } catch (e1) { parsed = null; }
    if (!parsed || !parsed.rows.length) {
        var start;
        for (start = 3; start < 40 && start < root.length; start++) {
            try {
                var cand = parseRows(root, start);
                if (cand.rows.length) { parsed = cand; break; }
            } catch (e2) { /* try next */ }
        }
    }
    if (!parsed) return err('MXL8: не удалось найти блок строк документа');
    var doc = {
        rows: parsed.rows,
        formats: [],
        fonts: [],
        default_group: { columns: [] },
        extra_groups: [],
        row_groups: [],
        merges: [],
        colors: [],
        lines: findLineTable(root),
        drawings: [],
        pictures: [],
        namedItems: []
    };
    parseTail(root, parsed.end, doc);
    return { doc: doc };
}

function groupForRow(doc, row) {
    var i;
    for (i = 0; i < doc.row_groups.length; i++) {
        if (doc.row_groups[i].row === row) {
            var g = doc.extra_groups[doc.row_groups[i].group];
            if (g) return { group: g, id: groupId(g.id) };
        }
    }
    return { group: doc.default_group, id: groupId(doc.default_group && doc.default_group.id) };
}

function looksLikeParameter(text) {
    var t = String(text || '').replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '');
    if (!t || t.indexOf('\n') >= 0 || t.indexOf(' ') >= 0 || t.length < 2) return false;
    if (!/[A-ZА-ЯЁ]/.test(t)) return false;
    return /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/.test(t);
}

function colorHex(doc, idx) {
    if (idx == null) return '';
    var c = doc.colors[idx];
    return (c && c.rgb) || '';
}

function lineStyle(kind) {
    if (kind === 0) return 'None';
    if (kind === 2) return 'Dotted';
    if (kind === 3) return 'Double';
    if (kind === 4 || kind === 5 || kind === 6) return 'Dash';
    return 'Solid';
}

function hAlign(v) {
    if (v === 6) return 'Center';
    if (v === 2) return 'Right';
    if (v === 4) return 'Justify';
    return 'Left';
}

function vAlign(v) {
    if (v === 24) return 'Center';
    if (v === 8) return 'Bottom';
    return 'Top';
}

function placement(v) {
    if (v === 1) return 'Cut';
    if (v === 2) return 'Block';
    if (v === 3) return 'Wrap';
    return 'Auto';
}

function toXmlHeight(h) {
    if (h == null) return '';
    if (h < 0) return String(h);
    if (h === 0) return String(-DEFAULT_HEIGHT_U);
    return String(Math.round(h * HEIGHT_MXL_TO_XML));
}

function convertFormat(raw, doc) {
    var fmt = {};
    if (!raw) return fmt;
    if (raw.font != null) fmt.font = String(raw.font);
    if (raw.width != null && raw.width > 0) fmt.width = String(raw.width);
    if (raw.height != null) fmt.height = toXmlHeight(raw.height);
    if (raw.h_align != null) fmt.horizontalAlignment = hAlign(raw.h_align);
    if (raw.v_align != null) fmt.verticalAlignment = vAlign(raw.v_align);
    if (raw.text_control != null) fmt.textPlacement = placement(raw.text_control);
    if (raw.fillType) fmt.fillType = raw.fillType;
    if (raw.orientation != null) fmt.textOrientation = String(raw.orientation / 10);
    if (raw.border_left != null) fmt.leftBorder = String(raw.border_left);
    if (raw.border_top != null) fmt.topBorder = String(raw.border_top);
    if (raw.border_right != null) fmt.rightBorder = String(raw.border_right);
    if (raw.border_bottom != null) fmt.bottomBorder = String(raw.border_bottom);
    var fg = colorHex(doc, raw.text_color);
    if (fg) fmt.textColor = fg;
    var bg = colorHex(doc, raw.bg_color);
    var pat = colorHex(doc, raw.pattern_color);
    if (raw.pattern === 0 && pat) fmt.backColor = pat;
    else if (bg) fmt.backColor = bg;
    else if (pat && raw.pattern != null && raw.pattern !== 255) fmt.backColor = pat;
    return fmt;
}

function convertLines(doc) {
    var out = [];
    var i;
    for (i = 0; i < doc.lines.length; i++) {
        var ln = doc.lines[i];
        out.push({
            width: Math.max(1, ln.thickness || 1),
            gap: false,
            style: lineStyle(ln.kind)
        });
    }
    return out;
}

function convertColumnSet(id, group, formats, extraCols) {
    var byIndex = {};
    var i;
    var maxIdx = 0;
    for (i = 0; i < (group.columns || []).length; i++) {
        var col = group.columns[i];
        byIndex[col.col] = col.format;
        if (col.col + 1 > maxIdx) maxIdx = col.col + 1;
    }
    if (extraCols > maxIdx) maxIdx = extraCols;
    if (maxIdx < 1) maxIdx = 1;
    var widths = [];
    for (i = 0; i < maxIdx; i++) {
        var fi = byIndex[i];
        var fmt = fi ? formats[fi - 1] : null;
        var w = fmt && fmt.width != null ? Number(fmt.width) : DEFAULT_WIDTH_U;
        if (!isFinite(w) || w <= 0) w = DEFAULT_WIDTH_U;
        widths.push(w * 7 / 8);
    }
    return { id: id, size: maxIdx, widths: widths, formatIndex: byIndex };
}

function mimeOfBase64(data) {
    if (!data) return 'image/png';
    if (data.indexOf('/9j') === 0) return 'image/jpeg';
    if (data.indexOf('Qk') === 0) return 'image/bmp';
    if (data.indexOf('R0lG') === 0) return 'image/gif';
    return 'image/png';
}

function toModel(doc) {
    var formats = [];
    var i;
    for (i = 0; i < doc.formats.length; i++) formats.push(convertFormat(doc.formats[i], doc));

    var maxRow = -1;
    var maxColByGroup = {};
    for (i = 0; i < doc.rows.length; i++) {
        if (doc.rows[i].index > maxRow) maxRow = doc.rows[i].index;
        var gid = groupForRow(doc, doc.rows[i].index).id;
        if (maxColByGroup[gid] == null) maxColByGroup[gid] = 0;
        var c;
        for (c = 0; c < doc.rows[i].cells.length; c++) {
            var col = doc.rows[i].cells[c].col;
            if (col + 1 > maxColByGroup[gid]) maxColByGroup[gid] = col + 1;
        }
    }
    var height = maxRow + 1;
    if (height < 1) height = 1;

    var columnSets = [];
    var columnSetById = {};
    var defId = groupId(doc.default_group && doc.default_group.id);
    var defSet = convertColumnSet(defId, doc.default_group, formats, maxColByGroup[defId] || 0);
    columnSets.push(defSet);
    columnSetById[defId] = defSet;
    if (defId) columnSetById[''] = defSet;
    for (i = 0; i < doc.extra_groups.length; i++) {
        var id = groupId(doc.extra_groups[i].id);
        var set = convertColumnSet(id, doc.extra_groups[i], formats, maxColByGroup[id] || 0);
        columnSets.push(set);
        columnSetById[id] = set;
    }

    var rowByIndex = {};
    for (i = 0; i < doc.rows.length; i++) {
        var src = doc.rows[i];
        var g = groupForRow(doc, src.index);
        var cells = [];
        var k;
        for (k = 0; k < src.cells.length; k++) {
            var cell = src.cells[k];
            var fmt = cell.format ? formats[cell.format - 1] : null;
            var fillType = (fmt && fmt.fillType) || '';
            var text = cell.text || '';
            var parameter = '';
            if (fillType === 'Parameter') {
                parameter = String(text).replace(/^\s+|\s+$/g, '');
                text = '';
            } else if (!fillType && looksLikeParameter(text)) {
                parameter = text;
                fillType = 'Parameter';
                text = '';
            }
            cells.push({
                col: cell.col,
                formatIndex: cell.format,
                text: text,
                parameter: parameter,
                detailParameter: '',
                fillType: fillType
            });
        }
        rowByIndex[src.index] = {
            columnsID: g.id,
            formatIndex: src.format,
            empty: !cells.length,
            cells: cells
        };
    }
    var rows = [];
    for (i = 0; i < height; i++) {
        rows.push(rowByIndex[i] || { columnsID: groupForRow(doc, i).id, formatIndex: 0, empty: true, cells: [] });
    }

    var merges = [];
    for (i = 0; i < doc.merges.length; i++) {
        var m = doc.merges[i];
        var mid = groupForRow(doc, m.top).id;
        merges.push({
            r: m.top,
            c: m.left,
            h: m.bottom - m.top,
            w: m.right - m.left,
            columnsID: mid
        });
    }

    var drawings = [];
    for (i = 0; i < doc.drawings.length; i++) {
        var d = doc.drawings[i];
        drawings.push({
            drawingType: d.kind,
            id: i,
            formatIndex: d.format,
            beginRow: d.row_start,
            beginRowOffset: d.offsets[1] || 0,
            endRow: d.row_end,
            endRowOffset: d.offsets[3] || 0,
            beginColumn: d.col_start,
            beginColumnOffset: d.offsets[0] || 0,
            endColumn: d.col_end,
            endColumnOffset: d.offsets[2] || 0,
            pictureIndex: d.picture || 0,
            zOrder: i
        });
    }

    var pictures = [];
    for (i = 0; i < doc.pictures.length; i++) {
        var data = doc.pictures[i] || '';
        pictures.push({ index: i, data: data, ref: '', mime: mimeOfBase64(data) });
    }

    return {
        height: height,
        rows: rows,
        columnSets: columnSets,
        columnSetById: columnSetById,
        formats: formats,
        fonts: doc.fonts.length ? doc.fonts : [{ faceName: 'Arial', height: 8, bold: false, italic: false, underline: false, strikeout: false }],
        lines: convertLines(doc),
        pictures: pictures,
        merges: merges,
        unmerges: [],
        namedItems: doc.namedItems || [],
        drawings: drawings,
        templateMode: !!(doc.namedItems && doc.namedItems.length),
        _mxl: true
    };
}

function parse(text) {
    if (!text || typeof text !== 'string') return err('Пустой MXL');
    var parsed = parseDocument(text);
    if (parsed.error) return parsed;
    return { model: toModel(parsed.doc), doc: parsed.doc };
}

root.MxlPreview = {
    detect: detect,
    parse: parse,
    _test: {
        parseBody: parseBody,
        stripHeader: stripHeader,
        isV77: isV77,
        cellFromValue: cellFromValue,
        formatFromValue: formatFromValue,
        fontFromValue: fontFromValue,
        colorFromValue: colorFromValue,
        toXmlHeight: toXmlHeight,
        convertFormat: convertFormat,
        parseDocument: parseDocument,
        namedItemsFromValue: namedItemsFromValue,
        localizedText: localizedText,
        looksLikeParameter: looksLikeParameter,
        groupId: groupId
    }
};

})(window);
