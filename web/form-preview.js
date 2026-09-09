/* Visual preview of 1C managed forms (Designer Ext/Form.xml).
 *
 * Layout and widget mockups follow CDT 41 form editor
 * (https://github.com/lekot/VScodePluginFor1CDev, MIT).
 * This module is read-only: it does not write XML back. */
(function (root) {
'use strict';

var CONTAINER_TAGS = {
    UsualGroup: 1, Pages: 1, Page: 1, Table: 1, AutoCommandBar: 1,
    CommandBar: 1, Form: 1, Group: 1, CollapsibleGroup: 1, ButtonGroup: 1, Popup: 1,
    ColumnGroup: 1
};
var SKIP_TAGS = {
    ChildItems: 1, Events: 1, Attributes: 1, Commands: 1, Parameters: 1,
    CommandSet: 1, ExtendedTooltip: 1, ContextMenu: 1
};
var EXTRA_CHILD_TAGS = ['AutoCommandBar', 'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition'];
var CHAR_PX = 8;
var RARE_TAGS = {
    TrackBarField: 1, ProgressBarField: 1, TextDocumentField: 1,
    SpreadSheetDocumentField: 1, HTMLDocumentField: 1, ChartField: 1,
    GanttChartField: 1, PlannerField: 1, GraphicalSchemaField: 1,
    FormattedDocumentField: 1, PictureField: 1, CalendarField: 1,
    PeriodField: 1, GeographicsField: 1
};
var FORM_TAGS = {
    InputField: 1, CheckBoxField: 1, RadioButtonField: 1, RadioButton: 1,
    LabelField: 1, LabelDecoration: 1, PictureDecoration: 1, Button: 1,
    Hyperlink: 1, Table: 1, UsualGroup: 1, Pages: 1, Page: 1,
    AutoCommandBar: 1, CommandBar: 1, SearchStringAddition: 1, ValueList: 1,
    ListBox: 1, ListField: 1, ButtonGroup: 1, PictureField: 1, ColumnGroup: 1,
    ViewStatusAddition: 1, SearchControlAddition: 1, Popup: 1
};

var activePageIdByPagesKey = Object.create(null);

/* Shared XML helpers live in xml-util.js; aliased locally for brevity. */
var XU = root.XmlUtil;
var localName = XU.localName;
var namedChildren = XU.namedChildren;
var firstChild = XU.firstChild;
var textOf = XU.textOf;

function detect(xml) {
    if (!xml || typeof xml !== 'string') return false;
    if (xml.indexOf('xcf/logform') >= 0) return true;
    if (!/<Form[\s>]/i.test(xml) && !/<form[\s>]/i.test(xml)) return false;
    if (xml.indexOf('<ChildItems') < 0 && xml.indexOf('<AutoCommandBar') < 0) return false;
    for (var tag in FORM_TAGS) {
        if (xml.indexOf('<' + tag) >= 0) return true;
    }
    return false;
}

function localizedFrom(el) {
    return XU.localizedFrom(el, textOf);
}

function scalarOf(el) {
    if (!el) return '';
    if (el.children && el.children.length) {
        for (var i = 0; i < el.children.length; i++) {
            if (localName(el.children[i]) === 'item') return localizedFrom(el);
        }
        var parts = [];
        for (var j = 0; j < el.children.length; j++) {
            var t = textOf(el.children[j]);
            if (t) parts.push(t);
        }
        if (parts.length === 1) return parts[0];
        if (parts.length) return parts.join(', ');
    }
    return textOf(el);
}

function refOf(el) {
    if (!el) return '';
    for (var i = 0; i < el.children.length; i++) {
        var n = localName(el.children[i]);
        if (n === 'Ref' || n === 'ref') return textOf(el.children[i]);
    }
    return '';
}

function parseProperties(el) {
    var props = {};
    if (!el) return props;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        var tag = localName(c);
        if (tag === 'CommandSet') {
            props.ExcludedCommands = parseExcludedCommands(c);
            continue;
        }
        if (!tag || SKIP_TAGS[tag] || tag === 'ChildItems') continue;
        if (EXTRA_CHILD_TAGS.indexOf(tag) >= 0) continue;
        if (tag === 'Title') props.Title = localizedFrom(c);
        else if (tag === 'InputHint') props.InputHint = localizedFrom(c);
        else if (tag === 'ChoiceList') props.ChoiceListItems = parseChoiceList(c);
        else if (tag === 'Picture' || tag === 'HeaderPicture' || tag === 'ValuesPicture' || tag === 'RowsPicture')
            props[tag] = refOf(c) || scalarOf(c);
        else props[tag] = scalarOf(c);
    }
    return props;
}

function parseChildItems(section) {
    var out = [];
    if (!section) return out;
    for (var i = 0; i < section.children.length; i++) {
        var el = section.children[i];
        var tag = localName(el);
        if (!tag || SKIP_TAGS[tag]) continue;
        out.push(parseElement(el));
    }
    return out;
}

function parseElement(el) {
    var tag = localName(el);
    var childSection = null;
    var extras = {};
    var events = [];
    for (var i = 0; i < el.children.length; i++) {
        var n = localName(el.children[i]);
        if (n === 'ChildItems') childSection = el.children[i];
        else if (EXTRA_CHILD_TAGS.indexOf(n) >= 0) extras[n] = parseElement(el.children[i]);
        else if (n === 'Events') {
            var evRoot = el.children[i];
            for (var e = 0; e < evRoot.children.length; e++) {
                if (localName(evRoot.children[e]) === 'Event')
                    events.push(evRoot.children[e].getAttribute('name') || '');
            }
        }
    }
    var item = {
        tag: tag,
        name: el.getAttribute('name') || '',
        id: el.getAttribute('id') || '',
        properties: parseProperties(el),
        childItems: parseChildItems(childSection),
        events: events
    };
    if (extras.AutoCommandBar) item.autoCommandBar = extras.AutoCommandBar;
    if (extras.SearchStringAddition) item.searchStringAddition = extras.SearchStringAddition;
    if (extras.ViewStatusAddition) item.viewStatusAddition = extras.ViewStatusAddition;
    if (extras.SearchControlAddition) item.searchControlAddition = extras.SearchControlAddition;
    return item;
}


function parseExcludedCommands(el) {
    var out = [];
    if (!el) return out;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        if (localName(c) !== 'ExcludedCommand') continue;
        var name = textOf(c);
        if (name) out.push(name);
    }
    return out;
}

function parseChoiceList(el) {
    var out = [];
    if (!el) return out;
    for (var i = 0; i < el.children.length; i++) {
        var itemEl = el.children[i];
        if (localName(itemEl) !== 'Item' && localName(itemEl) !== 'item') continue;
        var pres = '';
        for (var j = 0; j < itemEl.children.length; j++) {
            var ch = itemEl.children[j];
            var cn = localName(ch);
            if (cn === 'Presentation') {
                var direct = localizedFrom(ch);
                if (direct) pres = direct;
            } else if (cn === 'Value') {
                var vp = firstChild(ch, 'Presentation');
                if (vp) {
                    var nested = localizedFrom(vp);
                    if (nested) pres = nested;
                }
            }
        }
        if (pres) out.push(pres);
    }
    return out;
}

function typeLengthOf(el) {
    var typeEl = firstChild(el, 'Type');
    if (!typeEl) return 0;
    var found = null;
    function walk(node) {
        if (!node || found != null) return;
        if (localName(node) === 'Length') {
            var n = parseInt(textOf(node), 10);
            if (!isNaN(n)) found = n;
            return;
        }
        for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
    }
    walk(typeEl);
    if (found === 0) return -1;
    if (found > 0) return found;
    return 0;
}

function parseNamedList(section, itemTag) {
    var out = [];
    if (!section) return out;
    var items = namedChildren(section, itemTag);
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var columns = [];
        var colRoot = firstChild(el, 'Columns');
        if (colRoot) {
            var cols = namedChildren(colRoot, 'Column');
            for (var c = 0; c < cols.length; c++) {
                columns.push({
                    name: cols[c].getAttribute('name') || '',
                    id: cols[c].getAttribute('id') || '',
                    properties: parseProperties(cols[c]),
                    stringLen: typeLengthOf(cols[c])
                });
            }
        }
        out.push({
            name: el.getAttribute('name') || itemTag,
            id: el.getAttribute('id') || '',
            properties: parseProperties(el),
            columns: columns,
            stringLen: typeLengthOf(el)
        });
    }
    return out;
}

function findFormRoot(doc) {
    if (!doc || !doc.documentElement) return null;
    var root = doc.documentElement;
    if (localName(root) === 'Form') return root;
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
        if (localName(all[i]) === 'Form') return all[i];
    }
    return null;
}

function parse(xml, objectMetaXml) {
    if (!xml || typeof xml !== 'string') return { error: 'Пустой XML' };
    var doc;
    try {
        doc = new DOMParser().parseFromString(xml, 'application/xml');
    } catch (e) {
        return { error: 'Не удалось разобрать XML' };
    }
    var parseErr = doc.querySelector('parsererror');
    if (parseErr) return { error: textOf(parseErr) || 'Ошибка разбора XML' };
    var form = findFormRoot(doc);
    if (!form) return { error: 'В файле нет корневого элемента Form' };
    var auto = firstChild(form, 'AutoCommandBar');
    return {
        model: {
            childItemsRoot: parseChildItems(firstChild(form, 'ChildItems')),
            autoCommandBar: auto ? parseElement(auto) : null,
            attributes: parseNamedList(firstChild(form, 'Attributes'), 'Attribute'),
            commands: parseNamedList(firstChild(form, 'Commands'), 'Command'),
            excludedCommands: parseExcludedCommands(firstChild(form, 'CommandSet')),
            version: form.getAttribute('version') || '',
            objectMeta: parseObjectMeta(objectMetaXml)
        }
    };
}

function displayItems(model) {
    if (!model) return [];
    var items = model.childItemsRoot || [];
    var bar = formCommandBar(model);
    if (bar && !isEmptyCommandBar(bar))
        return [bar].concat(items);
    return items;
}

function isEmptyCommandBar(bar) {
    if (!bar) return true;
    if (bar.childItems && bar.childItems.length) return false;
    return isFalse(prop(bar, ['Autofill']));
}

function groupHasFields(item) {
    if (!item) return false;
    var tag = item.tag || '';
    if (tag === 'InputField' || tag === 'CheckBoxField' || tag === 'Table'
        || tag === 'RadioButtonField' || tag === 'ValueList') return true;
    var kids = item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        if (groupHasFields(kids[i])) return true;
    }
    return false;
}

function normKey(k) { return String(k || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, ''); }

function prop(item, aliases) {
    var properties = item && item.properties;
    if (!properties) return '';
    var map = {};
    for (var k in properties) {
        if (!Object.prototype.hasOwnProperty.call(properties, k)) continue;
        map[normKey(k)] = properties[k];
    }
    for (var i = 0; i < aliases.length; i++) {
        var v = map[normKey(aliases[i])];
        if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
}

function isFalse(v) {
    var s = String(v || '').toLowerCase().replace(/[\s_-]+/g, '');
    return s === 'false' || s === '0' || s === 'нет' || s === 'no';
}

var PATH_CAPTIONS = {
    Number: 'Номер', Date: 'Дата', Ref: 'Ссылка', Description: 'Наименование', Code: 'Код',
    LineNumber: 'N'
};
var STD_COMMANDS = {
    Help: '?', Write: 'Записать', Post: 'Провести', Close: 'Закрыть',
    WriteAndClose: 'Записать и закрыть', PostAndClose: 'Провести и закрыть',
    SetDeletionMark: 'Пометить на удаление', Delete: 'Удалить', Reread: 'Перечитать',
    ShowInList: 'Показать в списке', CustomizeForm: 'Изменить форму',
    Add: 'Добавить', Copy: 'Скопировать', Change: 'Изменить', Find: 'Найти',
    MoveUp: 'Переместить вверх', MoveDown: 'Переместить вниз', SelectAll: 'Выделить все'
};
var PIC_ICON = {
    Write: 'save', WriteAndClose: 'save', Post: 'file-check', PostAndClose: 'file-check',
    Print: 'printer', Help: 'help', Find: 'search', Search: 'search',
    Create: 'plus', Add: 'plus', CreateListItem: 'plus', Delete: 'x', Copy: 'copy',
    Change: 'pencil', Undo: 'arrow-back-up', Redo: 'arrow-forward-up',
    MoveUp: 'arrow-up', MoveDown: 'arrow-down', Calendar: 'calendar',
    Choose: 'dots', DropList: 'chevron-down', Clear: 'x', Picture: 'photo',
    Folder: 'folder', Information: 'info-circle', Warning: 'alert-triangle',
    QueryWizard: 'help', Report: 'table', Spreadsheet: 'table', InputField: 'forms',
    Check: 'checkbox', Filter: 'filter', Barcode: 'barcode', Scale: 'scale',
    Calculate: 'calculator', CustomizeForm: 'adjustments', Generate: 'sparkles',
    Fill: 'sparkles', OutputList: 'layout-list', Sort: 'arrows-sort', EndEdit: 'square',
    Refresh: 'refresh'
};

function objectMetaCandidates(formPath) {
    var p = String(formPath || '').replace(/[/]+/g, '\\').replace(/\\+$/, '');
    var parts = p.split('\\').filter(Boolean);
    if (parts.length < 5) return [];
    if (!/^form\.xml$/i.test(parts[parts.length - 1])) return [];
    if (!/^ext$/i.test(parts[parts.length - 2])) return [];
    if (!/^forms$/i.test(parts[parts.length - 4])) return [];
    var objectName = parts[parts.length - 5];
    var parent = parts.slice(0, parts.length - 5).join('\\');
    var objectDir = parent ? parent + '\\' + objectName : objectName;
    return [
        (parent ? parent + '\\' : '') + objectName + '.xml',
        objectDir + '\\' + objectName + '.xml'
    ];
}

function metaProps(el) {
    return firstChild(el, 'Properties') || el;
}

function ingestStandardAttributes(el, prefix, captions) {
    if (!el) return;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        if (localName(c) !== 'StandardAttribute') continue;
        var n = c.getAttribute('name') || '';
        if (!n) continue;
        var key = prefix ? prefix + '.' + n : n;
        var syn = localizedFrom(firstChild(c, 'Synonym'));
        if (!syn && PATH_CAPTIONS[n]) syn = PATH_CAPTIONS[n];
        if (syn) captions[key] = syn;
    }
}

function ingestAttribute(el, prefix, captions, stringLen) {
    var p = metaProps(el);
    var n = textOf(firstChild(p, 'Name')) || el.getAttribute('name') || '';
    if (!n) return;
    var key = prefix ? prefix + '.' + n : n;
    var syn = localizedFrom(firstChild(p, 'Synonym'));
    if (syn) captions[key] = syn;
    var len = typeLengthOf(p);
    if (len < 0) stringLen[key] = 0;
    else if (len > 0) stringLen[key] = len;
}

function ingestChildObjects(el, prefix, captions, stringLen) {
    if (!el) return;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        var tag = localName(c);
        if (tag === 'Attribute') ingestAttribute(c, prefix, captions, stringLen);
        else if (tag === 'TabularSection') {
            var tp = metaProps(c);
            var tn = textOf(firstChild(tp, 'Name'));
            if (!tn) continue;
            var tkey = prefix ? prefix + '.' + tn : tn;
            var tsyn = localizedFrom(firstChild(tp, 'Synonym'));
            if (tsyn) captions[tkey] = tsyn;
            ingestStandardAttributes(firstChild(tp, 'StandardAttributes'), tkey, captions);
            ingestChildObjects(firstChild(c, 'ChildObjects'), tkey, captions, stringLen);
        }
    }
}

function parseObjectMeta(xml) {
    if (!xml || typeof xml !== 'string' || xml.indexOf('MetaDataObject') < 0) return null;
    var doc;
    try { doc = new DOMParser().parseFromString(xml, 'application/xml'); }
    catch (e) { return null; }
    if (doc.querySelector && doc.querySelector('parsererror')) return null;
    var root = doc.documentElement;
    if (!root || localName(root) !== 'MetaDataObject') return null;
    var obj = root.children && root.children[0];
    if (!obj) return null;
    var props = firstChild(obj, 'Properties');
    var captions = {};
    var stringLen = {};
    var name = '';
    var synonym = '';
    if (props) {
        name = textOf(firstChild(props, 'Name'));
        synonym = localizedFrom(firstChild(props, 'Synonym'));
        var dl = parseInt(textOf(firstChild(props, 'DescriptionLength')), 10);
        if (dl > 0) {
            stringLen.Description = dl;
            stringLen['Наименование'] = dl;
        }
        ingestStandardAttributes(firstChild(props, 'StandardAttributes'), '', captions);
    }
    ingestChildObjects(firstChild(obj, 'ChildObjects'), '', captions, stringLen);
    return { name: name, synonym: synonym, captions: captions, stringLen: stringLen };
}

function buildCaptionIndex(model) {
    var captions = {};
    var stringLen = {};
    var mainNames = {};
    var attrs = (model && model.attributes) || [];
    for (var i = 0; i < attrs.length; i++) {
        var a = attrs[i];
        if (!a || !a.name) continue;
        if (isTrue(prop(a, ['MainAttribute']))) mainNames[a.name] = true;
        var t = rawTitle(a);
        if (t) captions[a.name] = t;
        if (a.stringLen < 0) stringLen[a.name] = 0;
        else if (a.stringLen > 0) stringLen[a.name] = a.stringLen;
        var cols = a.columns || [];
        for (var c = 0; c < cols.length; c++) {
            var col = cols[c];
            if (!col || !col.name) continue;
            var ct = rawTitle(col);
            if (ct) captions[a.name + '.' + col.name] = ct;
            if (col.stringLen < 0) stringLen[a.name + '.' + col.name] = 0;
            else if (col.stringLen > 0) stringLen[a.name + '.' + col.name] = col.stringLen;
        }
    }
    var om = model && model.objectMeta;
    if (om) {
        var oc = om.captions || {};
        for (var k in oc) {
            if (Object.prototype.hasOwnProperty.call(oc, k) && !captions[k]) captions[k] = oc[k];
        }
        var ol = om.stringLen || {};
        for (var k2 in ol) {
            if (Object.prototype.hasOwnProperty.call(ol, k2) && stringLen[k2] == null)
                stringLen[k2] = ol[k2];
        }
    }
    return { captions: captions, mainNames: mainNames, stringLen: stringLen };
}

function captionForPath(path, index) {
    if (!path || !index || !index.captions) return '';
    var caps = index.captions;
    if (caps[path]) return caps[path];
    var parts = String(path).split('.');
    if (parts.length >= 2 && index.mainNames && index.mainNames[parts[0]]) {
        var rest = parts.slice(1).join('.');
        if (caps[rest]) return caps[rest];
    }
    if (parts.length === 1 && caps[parts[0]]) return caps[parts[0]];
    return '';
}

function lookupStringLen(lens, key) {
    if (!key || !lens || !Object.prototype.hasOwnProperty.call(lens, key)) return null;
    return lens[key] | 0;
}

function metaStringLen(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index || !index.stringLen) return 0;
    var path = prop(item, ['DataPath']);
    var lens = index.stringLen;
    var v = lookupStringLen(lens, path);
    if (v != null) return v;
    var parts = String(path || '').split('.');
    if (parts.length >= 2 && index.mainNames && index.mainNames[parts[0]]) {
        v = lookupStringLen(lens, parts.slice(1).join('.'));
        if (v != null) return v;
    }
    v = lookupStringLen(lens, lastSeg(path));
    if (v != null) return v;
    return 0;
}

function isUnlimitedString(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index || !index.stringLen) return false;
    var path = prop(item, ['DataPath']);
    var lens = index.stringLen;
    if (lookupStringLen(lens, path) === 0) return true;
    var parts = String(path || '').split('.');
    if (parts.length >= 2 && index.mainNames && index.mainNames[parts[0]]
        && lookupStringLen(lens, parts.slice(1).join('.')) === 0) return true;
    return lookupStringLen(lens, lastSeg(path)) === 0;
}

function isMultilineField(item, ctx) {
    if (!item) return false;
    if (isTrue(prop(item, ['MultiLine']))) return true;
    if (isFalse(prop(item, ['MultiLine']))) return false;
    if (isTrue(prop(item, ['ListChoiceMode'])) || isTrue(prop(item, ['DropListButton'])))
        return false;
    var h = parseInt(prop(item, ['Height', 'Высота']), 10);
    if (h > 1) return true;
    if (titleLocation(item) !== 'none') return false;
    if (isUnlimitedString(item, ctx)) return true;
    var path = lastSeg(prop(item, ['DataPath']));
    if (/^(Комментарий|Comment)$/i.test(path)) return true;
    return false;
}

function lastSeg(s) {
    if (!s) return '';
    var parts = String(s).split('.');
    return parts[parts.length - 1];
}

function humanizeIdent(s) {
    if (!s) return '';
    var t = String(s).replace(/[_]+/g, ' ');
    t = t.replace(/([а-яёa-z])([А-ЯЁA-Z])/g, '$1 $2');
    t = t.replace(/([А-ЯЁA-Z]+)([А-ЯЁA-Z][а-яёa-z])/g, '$1 $2');
    return t.replace(/\s+/g, ' ').trim();
}

function isTrue(v) {
    var s = String(v || '').toLowerCase().replace(/[\s_-]+/g, '');
    return s === 'true' || s === '1' || s === 'yes' || s === 'да';
}

function representationOf(item) {
    var v = String(prop(item, ['Representation', 'Отображение']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v || v === 'auto' || v === 'авто') return 'auto';
    if (v.indexOf('pictureandtext') >= 0 || v.indexOf('textpicture') >= 0
        || v.indexOf('картинкаитекст') >= 0 || v.indexOf('тексткартинка') >= 0) return 'pictureandtext';
    if (v === 'picture' || v.indexOf('картинк') >= 0) return 'picture';
    if (v === 'text' || v.indexOf('текст') >= 0) return 'text';
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    return 'auto';
}

function groupRep(item) {
    return representationOf(item);
}

function pagesRep(item) {
    var raw = prop(item, ['PagesRepresentation', 'ПредставлениеСтраниц']);
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    if (v.indexOf('bottom') >= 0 || v.indexOf('низ') >= 0 || v.indexOf('внизу') >= 0) return 'bottom';
    return 'top';
}

function inAdditionalBar(item) {
    var v = String(prop(item, ['LocationInCommandBar', 'ПоложениеВКоманднойПанели']) || '').toLowerCase();
    if (v.indexOf('additional') >= 0 || v.indexOf('дополн') >= 0) return true;
    var short = cmdShort(item);
    if (/CustomizeForm|ShowMultipleSelection|OutputList|ListSettings|LoadDynamicListSettings|SaveDynamicListSettings|DynamicListStandardSettings/i.test(short))
        return true;
    var name = String((item && item.name) || '');
    if (/ИзменитьФорму|ПоказатьМножественное|НастройкиДинамическогоСписка/i.test(name))
        return true;
    return false;
}

function isDeadCommand(item) {
    if (!item || (item.tag !== 'Button' && item.tag !== 'Hyperlink')) return false;
    var cmd = String(prop(item, ['CommandName', 'Command']) || '').trim();
    return cmd === '0';
}

function hasMainBarChildren(item) {
    var kids = item && item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
        if (isDeadCommand(it) || inAdditionalBar(it)) continue;
        if (it.tag === 'Popup' && !popupHasCommands(it)) continue;
        if (it.tag === 'ButtonGroup') {
            if (hasMainBarChildren(it)) return true;
            continue;
        }
        return true;
    }
    return false;
}

function popupHasCommands(item) {
    var kids = item && item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
        if (it.tag === 'Button' || it.tag === 'Hyperlink') {
            if (isDeadCommand(it) || inAdditionalBar(it)) continue;
            return true;
        }
        if (it.tag === 'ButtonGroup' || it.tag === 'Popup') {
            if (popupHasCommands(it)) return true;
        }
    }
    return false;
}

function popupMenuEntries(item) {
    var out = [];
    function walk(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
            if (it.tag === 'ButtonGroup') { walk(it.childItems); continue; }
            if (it.tag === 'Button' || it.tag === 'Hyperlink' || it.tag === 'Popup') {
                if (isDeadCommand(it) || inAdditionalBar(it)) continue;
                out.push(it);
            }
        }
    }
    walk(item && item.childItems);
    return out;
}

function closeAllPopups(root) {
    if (!root) return;
    var open = root.querySelectorAll('.fp-popup-open');
    for (var i = 0; i < open.length; i++) open[i].classList.remove('fp-popup-open');
}

function positionFixedPopup(anchor, panel, minW) {
    if (!anchor || !panel || !anchor.getBoundingClientRect) return;
    var r = anchor.getBoundingClientRect();
    var vw = (window.innerWidth || 800);
    var vh = (window.innerHeight || 600);
    panel.style.position = 'fixed';
    var min = minW || 280;
    var left = Math.round(r.left);
    var pw = panel.offsetWidth || min;
    var ph = panel.offsetHeight || 160;
    if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
    if (left < 8) left = 8;
    var top = Math.round(r.bottom);
    if (top + ph > vh - 8 && r.top > Math.min(ph, vh / 2))
        top = Math.max(8, Math.round(r.top - ph));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.minWidth = Math.max(min, Math.round(r.width)) + 'px';
}

function bindPopupToggle(wrap, btn, ctx, item) {
    if (!wrap || !btn) return;
    btn.disabled = false;
    var menu = wrap.querySelector('.fp-popup-menu');
    btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var was = wrap.classList.contains('fp-popup-open');
        closeAllPopups(ctx && ctx.root);
        if (item) {
            selectIn(ctx.root, itemKey(item), ctx);
            if (ctx.onSelect) ctx.onSelect(item);
        }
        if (was) return;
        wrap.classList.add('fp-popup-open');
        positionFixedPopup(btn, menu, 180);
    });
}

function bindGroupPopupToggle(wrap, btn, ctx, item) {
    if (!wrap || !btn) return;
    var group = wrap.querySelector('.fp-popup-group');
    var body = wrap.querySelector('.fp-popup-group-body');
    btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var was = !!(group && group.classList.contains('fp-popup-open'));
        closeAllPopups(ctx && ctx.root);
        if (item) {
            selectIn(ctx.root, itemKey(item), ctx);
            if (ctx.onSelect) ctx.onSelect(item);
        }
        if (was || !group) return;
        group.classList.add('fp-popup-open');
        wrap.classList.add('fp-popup-open');
        positionFixedPopup(btn, body, 320);
    });
}

function makePopupMenu(item, ctx) {
    var menu = el('div', 'fp-popup-menu');
    var entries = popupMenuEntries(item);
    if (!entries.length) {
        menu.appendChild(el('div', 'fp-popup-empty', 'Нет команд'));
        return menu;
    }
    for (var i = 0; i < entries.length; i++) {
        (function (it) {
            var row = el('button', 'fp-popup-entry');
            row.type = 'button';
            row.dataset.id = itemKey(it);
            var cap = displayLabel(it, ctx, it.tag) || titleOf(it, ctx) || it.name || '—';
            if (it.tag === 'Popup') cap = cap.replace(/\s*▾\s*$/, '') + ' ▸';
            row.textContent = cap;
            row.title = cap;
            row.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                closeAllPopups(ctx && ctx.root);
                selectIn(ctx.root, itemKey(it), ctx);
                if (ctx.onSelect) ctx.onSelect(it);
            });
            menu.appendChild(row);
        })(entries[i]);
    }
    return menu;
}

function collectAdditionalBarItems(item, acc) {
    var kids = item && item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
        if (it.tag === 'ButtonGroup') {
            collectAdditionalBarItems(it, acc);
            continue;
        }
        if (isDeadCommand(it)) continue;
        if (inAdditionalBar(it)) acc.push(it);
    }
}

function pinCommandBarTail(bar) {
    if (!bar) return;
    var old = bar.querySelector('.fp-bar-spacer');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var search = bar.querySelector('.fp-search-item');
    var more = bar.querySelector('.fp-more-item');
    var help = bar.querySelector('.fp-help-item');
    if (search) bar.appendChild(search);
    if (more) bar.appendChild(more);
    if (help) bar.appendChild(help);
    var first = search || more || help;
    if (first) bar.insertBefore(el('div', 'fp-bar-spacer'), first);
}

function hasPicture(item) {
    return !!pictureRef(item);
}

function pictureRef(item) {
    if (!item) return '';
    var raw = prop(item, ['Picture', 'HeaderPicture', 'ValuesPicture']);
    return String(raw || '').trim();
}

function cmdShort(item) {
    return lastSeg(prop(item, ['CommandName', 'Command']));
}

function commandMeta(item, ctx, key) {
    var short = cmdShort(item);
    if (!short || !ctx || !ctx.commands) return '';
    var c = ctx.commands[short];
    if (!c) return '';
    if (key === 'picture') return pictureRef(c) || prop(c, ['Picture']);
    if (key === 'title') return rawTitle(c);
    if (key === 'rep') return representationOf(c);
    return '';
}

function picKey(ref) {
    var s = lastSeg(ref);
    return s.replace(/^StdPicture\./i, '').replace(/^CommonPicture\./i, '');
}

function iconIdFromRef(ref) {
    var key = picKey(ref);
    if (!key) return '';
    if (PIC_ICON[key]) return PIC_ICON[key];
    var low = key.toLowerCase();
    if (/write|save|запис/i.test(low)) return 'save';
    if (/post|провест/i.test(low)) return 'file-check';
    if (/print|печат/i.test(low)) return 'printer';
    if (/help|справк/i.test(low)) return 'help';
    if (/find|search|поиск/i.test(low)) return 'search';
    if (/add|plus|созда/i.test(low)) return 'plus';
    if (/delete|удал/i.test(low)) return 'x';
    if (/copy|копир/i.test(low)) return 'copy';
    if (/moveup|стрелкавверх|вверх/i.test(low)) return 'arrow-up';
    if (/movedown|стрелкавниз|вниз/i.test(low)) return 'arrow-down';
    if (/moveleft|влево|стрелкавлево/i.test(low)) return 'arrow-left';
    if (/moveright|вправо|стрелкавправо/i.test(low)) return 'arrow-right';
    if (/calendar|дата/i.test(low)) return 'calendar';
    if (/warning|внимание/i.test(low)) return 'alert-triangle';
    if (/info|information/i.test(low)) return 'info-circle';
    if (/report|отчет|spreadsheet|табличн/i.test(low)) return 'table';
    if (/barcode|штрих/i.test(low)) return 'barcode';
    if (/fill|заполн|шаблон|generate/i.test(low)) return 'sparkles';
    if (/flag|флаг/i.test(low)) return 'flag';
    if (/выполняютс/i.test(low)) return 'player-play';
    if (/выполненн/i.test(low)) return 'checkbox';
    if (/undo/i.test(low)) return 'arrow-back-up';
    if (/redo/i.test(low)) return 'arrow-forward-up';
    if (/refresh|обнов/i.test(low)) return 'refresh';
    if (/раздел/i.test(low)) return 'copy';
    if (/folder|папк/i.test(low)) return 'folder';
    if (/filter|отбор/i.test(low)) return 'filter';
    if (/scale|вес/i.test(low)) return 'scale';
    if (/nabor|набор|series|серии/i.test(low)) return 'box';
    return 'box';
}

function iconIdFor(item, ctx) {
    var ref = pictureRef(item) || commandMeta(item, ctx, 'picture');
    if (ref) {
        var fromRef = iconIdFromRef(ref);
        if (fromRef) return fromRef;
    }
    var short = cmdShort(item);
    if (short && PIC_ICON[short]) return PIC_ICON[short];
    if (isHelpItem(item)) return 'help';
    var title = rawTitle(item) || (ctx && short && ctx.commandTitles && ctx.commandTitles[short]) || '';
    var name = String((item && item.name) || '');
    if (/штрих/i.test(name) || /штрих/i.test(title)) return 'barcode';
    if (/серии/i.test(name) || /серии/i.test(title)) return 'box';
    if (/тсд|вес/i.test(name)) return 'scale';
    if (/набор/i.test(name)) return 'box';
    if (/раздел/i.test(name) || /раздел/i.test(short)) return 'copy';
    if (/обнов/i.test(name) || short === 'Refresh') return 'refresh';
    return 'box';
}

function svgIcon(name, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', cls || 'fp-btn-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + (name || 'box'));
    svg.appendChild(use);
    return svg;
}

function iconBtn(name) {
    var span = el('span', 'fp-input-btn');
    span.appendChild(svgIcon(name, 'fp-btn-icon'));
    return span;
}

function isHelpItem(item) {
    var short = cmdShort(item);
    return short === 'Help' || /справк/i.test(rawTitle(item) || '') || /Help/i.test(String((item && item.name) || ''));
}

function charSize(raw) {
    var n = parseInt(raw, 10);
    if (!n || n < 0) return 0;
    return n * CHAR_PX;
}

function fieldKind(item) {
    var path = lastSeg(prop(item, ['DataPath']));
    if (isTrue(prop(item, ['MultiLine']))) return 'text';
    if (/DateTime|ДатаВремя/i.test(path)) return 'date';
    if (/Date$/i.test(path) || /Дата/i.test(path) || /Начало|Окончание|Начат/i.test(path)) return 'date';
    if (isTrue(prop(item, ['ListChoiceMode'])) || isTrue(prop(item, ['DropListButton']))) return 'list';
    if (/Number$|LineNumber$|Количество|Сумма|Цена|НДС|Скидк|Вес|Курс|Длительн|Норматив|Буфер/i.test(path))
        return 'number';
    var choice = prop(item, ['ChoiceButton']);
    if (isTrue(choice)) return 'ref';
    if (isFalse(choice)) return 'text';
    if (/Комментарий|Наименование|Description|Артикул|Номер$|Name$|Текст|Представление|Причина/i.test(path))
        return 'text';
    return 'ref';
}

function formatPlaceholder(item) {
    var fmt = prop(item, ['Format']);
    if (/ЧН=0,00|NZ=0\.00/i.test(fmt)) return '0,00';
    if (isTrue(prop(item, ['ReadOnly'])) && fieldKind(item) === 'number') return '0';
    return '';
}

function isHyperlinkItem(item) {
    return isTrue(prop(item, ['Hyperlink', 'Hiperlink']));
}

function compactTag(tag) {
    return tag === 'CheckBoxField' || tag === 'Button' || tag === 'Hyperlink'
        || tag === 'Popup' || tag === 'LabelDecoration' || tag === 'PictureDecoration'
        || tag === 'PictureField' || tag === 'LabelField' || tag === 'RadioButton'
        || tag === 'RadioButtonField';
}

function defaultFieldChars(item, ctx) {
    var n = metaStringLen(item, ctx);
    if (n > 0) return Math.max(4, Math.min(n, 40));
    var kind = fieldKind(item);
    if (kind === 'date') return 10;
    if (kind === 'number') return 12;
    if (kind === 'list') return 16;
    return 20;
}

function wantsHStretch(item, tag, parentMeta, ctx) {
    var hs = prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']);
    if (isFalse(hs)) return false;
    if (isTrue(hs)) return true;
    if (compactTag(tag)) return false;
    if (tag === 'Table') return true;
    if (tag === 'Pages') return pagesRep(item) !== 'none';
    if (tag === 'InputField' && titleLocation(item) === 'top') return true;
    if (tag === 'InputField' && isMultilineField(item, ctx)) return true;
    if (tag === 'InputField' && isFalse(prop(item, ['AutoMaxWidth']))
        && !prop(item, ['MaxWidth', 'МаксимальнаяШирина'])
        && !prop(item, ['Width', 'Ширина'])) return true;
    var cw = parentMeta && parentMeta.childItemsWidth;
    if (cw === 'equal' || cw === 'leftwidest' || cw === 'rightwidest') return true;
    return false;
}

function fieldHeight(item) {
    var h = parseInt(prop(item, ['Height', 'Высота']), 10);
    return h > 0 ? h : 0;
}

function wantsVStretch(item, tag, ctx) {
    var vs = prop(item, ['VerticalStretch']);
    if (isFalse(vs)) return false;
    if (tag === 'Table') return true;
    if (tag === 'Pages' && pagesRep(item) !== 'none') return true;
    if (tag === 'InputField') {
        if (fieldHeight(item) > 0) return false;
        if (isTrue(vs)) return true;
        return isMultilineField(item, ctx);
    }
    if (isTrue(vs)) return true;
    return false;
}

function applyItemMetrics(div, item, tag, parentMeta, ctx) {
    if (!div || !item) return;
    var hs = prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']);
    var w = charSize(prop(item, ['Width', 'Ширина']));
    var mw = charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']));
    var ha = String(prop(item, ['HorizontalAlign', 'ГоризонтальноеВыравнивание']) || '').toLowerCase();
    var stretch = wantsHStretch(item, tag, parentMeta, ctx);
    var vstretch = wantsVStretch(item, tag, ctx);
    var parentH = parentMeta && parentMeta.orientation === 'horizontal';
    if (compactTag(tag) || !stretch) {
        div.style.flex = '0 0 auto';
        div.classList.add('fp-no-hstretch');
    } else {
        div.classList.add('fp-hstretch');
        div.style.flex = parentH ? '1 1 auto' : '0 0 auto';
    }
    if (vstretch) {
        div.style.flex = '1 1 auto';
        div.style.minHeight = '0';
        div.classList.add('fp-vstretch');
    }
    if (tag === 'Pages' && pagesRep(item) === 'none') {
        div.classList.add('fp-pages-none');
        div.style.width = 'auto';
        div.style.flex = '0 0 auto';
        div.style.alignSelf = 'flex-start';
    } else if (tag === 'Table' || tag === 'Pages') {
        div.style.width = '100%';
        div.style.alignSelf = 'stretch';
        if (tag === 'Pages') div.classList.add('fp-pages-tabs');
    }
    var inputWrap = div.querySelector('.fp-input-wrap');
    if (inputWrap) {
        if (w) {
            inputWrap.style.width = w + 'px';
            inputWrap.style.flex = '0 0 auto';
            inputWrap.style.minWidth = w + 'px';
        } else if (stretch || isTrue(hs)) {
            inputWrap.style.flex = '1 1 auto';
        } else if (mw) {
            inputWrap.style.width = mw + 'px';
            inputWrap.style.flex = '0 0 auto';
            inputWrap.style.maxWidth = mw + 'px';
        } else {
            var dw = defaultFieldChars(item, ctx) * CHAR_PX;
            inputWrap.style.width = dw + 'px';
            inputWrap.style.flex = '0 0 auto';
            inputWrap.style.minWidth = dw + 'px';
        }
        if (mw) inputWrap.style.maxWidth = mw + 'px';
        var hint = prop(item, ['InputHint']);
        var inpEl = inputWrap.querySelector('.fp-input');
        if (hint && inpEl && !inpEl.value) inpEl.placeholder = hint;
    } else if (w && (tag === 'LabelField' || tag === 'LabelDecoration')) {
        var lab = div.querySelector('.fp-label');
        if (lab) lab.style.minWidth = w + 'px';
    }
    if (ha.indexOf('right') >= 0 || ha.indexOf('прав') >= 0) {
        div.style.marginLeft = 'auto';
        div.classList.add('fp-align-right');
    }
    var bc = prop(item, ['BackColor']);
    if (bc) {
        var bcl = bc.toLowerCase();
        if (/итог/i.test(bc)) div.classList.add('fp-totals-bg');
        if (/tooltip|подсказ/i.test(bcl)) div.classList.add('fp-tooltip-bg');
        else if (/выделен/i.test(bc)) div.classList.add('fp-highlight-bg');
    }
    var tc = prop(item, ['TextColor']);
    if (tc) {
        var tcl = tc.toLowerCase();
        if (/firebrick|красный|red|проблема/i.test(tcl)) div.classList.add('fp-text-danger');
        else if (/заголовокотчета|группавариантов|specialtext/i.test(tcl)) div.classList.add('fp-text-accent');
        else if (/гиперссылка/i.test(tcl)) div.classList.add('fp-text-link');
        else if (/серый|gray|grey/i.test(tcl)) div.classList.add('fp-text-muted');
    }
}

function syntheticBtn(name, title, picture, rep, extra) {
    var properties = {
        Title: title || '',
        Picture: picture || '',
        Representation: rep || (picture ? 'Picture' : 'Text')
    };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] != null)
                properties[k] = extra[k];
        }
    }
    return {
        tag: 'Button',
        name: name,
        id: '',
        properties: properties,
        childItems: []
    };
}

function mainAttribute(model) {
    var attrs = (model && model.attributes) || [];
    var i;
    for (i = 0; i < attrs.length; i++) {
        if (isTrue(prop(attrs[i], ['MainAttribute']))) return attrs[i];
    }
    for (i = 0; i < attrs.length; i++) {
        var nm = String(attrs[i].name || '');
        if (nm === 'Объект' || nm === 'Object') return attrs[i];
    }
    return null;
}

function formObjectKind(model) {
    var attr = mainAttribute(model);
    var t = String(prop(attr, ['Type']) || '');
    if (/CatalogObject|СправочникОбъект/i.test(t)) return 'catalog';
    if (/DocumentObject|ДокументОбъект/i.test(t)) return 'document';
    return '';
}

function commandExcluded(model, name) {
    var list = (model && model.excludedCommands) || [];
    var want = String(name || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
        if (String(list[i]).toLowerCase() === want) return true;
    }
    return false;
}

function stdCommandKey(item) {
    var short = String(cmdShort(item) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var name = String((item && item.name) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var title = String(rawTitle(item) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var blob = short + ' ' + name + ' ' + title;
    if (/writeandclose|записатьизакрыть/.test(blob)) return 'writeandclose';
    if (/postandclose|провестиизакрыть/.test(blob)) return 'postandclose';
    if (/(^| )(write|записать|записатьдокумент)( |$)/.test(' ' + blob + ' ')
        || /(^|форма)записать$/.test(name)) return 'write';
    if (/(^| )(post|провести|провестидокумент)( |$)/.test(' ' + blob + ' ')
        || /(^|форма)провести$/.test(name)) return 'post';
    return short;
}

function collectStdCommandKeys(items, acc) {
    var out = acc || {};
    if (!items) return out;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        var key = stdCommandKey(it);
        if (key) out[key] = true;
        if (it.childItems && it.childItems.length) collectStdCommandKeys(it.childItems, out);
    }
    return out;
}

function formStdCommandButtons(model) {
    var bar = model && model.autoCommandBar;
    if (bar && isFalse(prop(bar, ['Autofill']))) return [];
    var kind = formObjectKind(model);
    var out = [];
    if (kind === 'catalog') {
        if (!commandExcluded(model, 'WriteAndClose'))
            out.push(syntheticBtn('_stdWriteAndClose', 'Записать и закрыть', '', 'Text', {
                DefaultButton: 'true',
                CommandName: 'Form.StandardCommand.WriteAndClose'
            }));
        if (!commandExcluded(model, 'Write'))
            out.push(syntheticBtn('_stdWrite', 'Записать', '', 'Text', {
                CommandName: 'Form.StandardCommand.Write'
            }));
    } else if (kind === 'document') {
        if (!commandExcluded(model, 'PostAndClose'))
            out.push(syntheticBtn('_stdPostAndClose', 'Провести и закрыть', '', 'Text', {
                DefaultButton: 'true',
                CommandName: 'Form.StandardCommand.PostAndClose'
            }));
        if (!commandExcluded(model, 'Write'))
            out.push(syntheticBtn('_stdWrite', 'Записать', 'StdPicture.Write', 'Picture', {
                CommandName: 'Form.StandardCommand.Write'
            }));
        if (!commandExcluded(model, 'Post'))
            out.push(syntheticBtn('_stdPost', 'Провести', 'StdPicture.Post', 'Picture', {
                CommandName: 'Form.StandardCommand.Post'
            }));
    }
    return out;
}

function formCommandBar(model) {
    var bar = model && model.autoCommandBar;
    var std = formStdCommandButtons(model);
    if (!std.length) return bar;
    var kids = (bar && bar.childItems) || [];
    var have = collectStdCommandKeys(kids);
    var extra = [];
    for (var i = 0; i < std.length; i++) {
        var key = stdCommandKey(std[i]);
        if (key && have[key]) continue;
        extra.push(std[i]);
    }
    if (!extra.length) return bar;
    var merged = extra.concat(kids);
    if (!bar) {
        return {
            tag: 'AutoCommandBar',
            name: 'ФормаКоманднаяПанель',
            id: '-1',
            properties: {},
            childItems: merged
        };
    }
    var copy = {};
    for (var k in bar) {
        if (Object.prototype.hasOwnProperty.call(bar, k)) copy[k] = bar[k];
    }
    copy.childItems = merged;
    return copy;
}

function tableExcludes(table, names) {
    var list = table && table.properties && table.properties.ExcludedCommands;
    if (!list || !list.length) return false;
    var want = {};
    for (var i = 0; i < names.length; i++) want[String(names[i]).toLowerCase()] = true;
    for (var j = 0; j < list.length; j++) {
        if (want[String(list[j]).toLowerCase()]) return true;
    }
    return false;
}

function tableStdCommands(table) {
    var bar = table && table.autoCommandBar;
    if (bar && isFalse(prop(bar, ['Autofill']))) return [];
    var out = [];
    if (!table || !isFalse(prop(table, ['ChangeRowSet']))) {
        if (!tableExcludes(table, ['Create', 'Add']))
            out.push(syntheticBtn('_stdAdd', 'Добавить', '', 'Text'));
    }
    if (!table || !isFalse(prop(table, ['ChangeRowOrder']))) {
        var trep = String(prop(table, ['Representation']) || '').toLowerCase().replace(/[\s_-]+/g, '');
        if (trep !== 'list') {
            out.push(syntheticBtn('_stdUp', 'Переместить вверх', 'StdPicture.MoveUp', 'Picture'));
            out.push(syntheticBtn('_stdDown', 'Переместить вниз', 'StdPicture.MoveDown', 'Picture'));
        }
    }
    return out;
}

function isAdditionTag(tag) {
    return tag === 'AutoCommandBar' || tag === 'SearchStringAddition'
        || tag === 'ViewStatusAddition' || tag === 'SearchControlAddition';
}

function additionHidden(item, locProp) {
    var v = String(prop(item, [locProp]) || '').toLowerCase().replace(/[\s_-]+/g, '');
    return v === 'none' || v.indexOf('нет') >= 0;
}

function isInCellGroup(it) {
    var g = String(prop(it, ['Group']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    return g.indexOf('incell') >= 0 || g.indexOf('вячейк') >= 0;
}

function isHeaderGroup(it) {
    return it && it.tag === 'ColumnGroup' && !isInCellGroup(it) && isTrue(prop(it, ['ShowInHeader']));
}

function headerKids(group) {
    var out = [];
    function walk(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || SKIP_TAGS[it.tag] || isAdditionTag(it.tag)) continue;
            if (it.tag === 'ColumnGroup') {
                if (isInCellGroup(it) || isHeaderGroup(it)) out.push(it);
                else walk(it.childItems);
                continue;
            }
            out.push(it);
        }
    }
    walk(group && group.childItems);
    return out;
}

function inCellCaption(group, ctx) {
    if (isTrue(prop(group, ['ShowInHeader']))) {
        var gt = rawTitle(group);
        if (gt) return gt;
    }
    var parts = [];
    var hasGlyph = false;
    var kids = group.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['ShowInHeader']))) continue;
        var pic = pictureRef(it) || prop(it, ['HeaderPicture']);
        if (it.tag === 'PictureField' || (pic && (titleLocation(it) === 'none' || !rawTitle(it)))) {
            hasGlyph = true;
            continue;
        }
        if (titleLocation(it) === 'none') continue;
        var cap = columnCaption(it, ctx);
        if (cap) parts.push(cap);
    }
    if (parts.length) return parts.join(hasGlyph ? ' ' : ', ');
    return rawTitle(group) || '';
}

function tableColumns(item) {
    var out = [];
    function walk(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || SKIP_TAGS[it.tag] || isAdditionTag(it.tag)) continue;
            if (it.tag === 'ColumnGroup') {
                if (isInCellGroup(it) || isHeaderGroup(it)) out.push(it);
                else walk(it.childItems);
                continue;
            }
            out.push(it);
        }
    }
    walk(item && item.childItems);
    return out;
}

function radioOptions(item) {
    var list = item && item.properties && item.properties.ChoiceListItems;
    if (list && list.length) return list.slice();
    return ['Да', 'Нет', 'Авто'];
}

function columnCaption(col, ctx) {
    if (col && col.tag === 'ColumnGroup') {
        if (isInCellGroup(col)) return inCellCaption(col, ctx);
        return rawTitle(col) || titleOf(col, ctx) || col.name || '';
    }
    var loc = titleLocation(col);
    if (loc === 'none' || isFalse(prop(col, ['ShowInHeader']))) {
        if (col.tag === 'PictureField' || pictureRef(col) || prop(col, ['HeaderPicture'])) return '';
        if (loc === 'none') return '';
    }
    var t = titleOf(col, ctx);
    if (t) return t;
    var path = lastSeg(prop(col, ['DataPath']));
    if (path === 'LineNumber') return 'N';
    if (PATH_CAPTIONS[path]) return PATH_CAPTIONS[path];
    if (path) return path;
    return col.name || '';
}

function rawTitle(item) {
    return prop(item, ['Title', 'Заголовок']);
}

function titleOf(item, ctx) {
    if (!item) return '';
    var t = rawTitle(item);
    if (t) return t;
    var tag = item.tag || '';
    if (tag === 'LabelDecoration' || tag === 'PictureDecoration') return '';
    var cmd = prop(item, ['CommandName', 'Command']);
    if (cmd) {
        var short = lastSeg(cmd);
        if (ctx && ctx.commandTitles && ctx.commandTitles[short]) return ctx.commandTitles[short];
        if (STD_COMMANDS[short]) return STD_COMMANDS[short];
    }
    var path = prop(item, ['DataPath']);
    var cap = captionForPath(path, ctx && ctx.captionIndex);
    if (cap) return cap;
    var seg = lastSeg(path);
    if (PATH_CAPTIONS[seg]) return PATH_CAPTIONS[seg];
    if (seg) return humanizeIdent(seg);
    if (item.name) return humanizeIdent(item.name);
    return '';
}

function displayLabel(item, ctx, tag) {
    if (titleLocation(item) === 'none') return '';
    if (tag === 'LabelField' && !rawTitle(item) && item.events && item.events.indexOf('URLProcessing') >= 0)
        return '';
    var t = titleOf(item, ctx);
    if (t) return t;
    var rep = representationOf(item);
    if (rep === 'picture') return '';
    if (tag === 'InputField' || tag === 'CheckBoxField')
        return humanizeIdent(item.name || '');
    return '';
}

function groupBehavior(item) {
    var v = String(prop(item, ['Behavior', 'Поведение']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (v === 'popup' || v.indexOf('всплыв') >= 0) return 'popup';
    if (v === 'collapsible' || v.indexOf('свертываем') >= 0 || v.indexOf('сворачиваем') >= 0)
        return 'collapsible';
    return 'usual';
}

function isPopUpGroup(item) {
    return groupBehavior(item) === 'popup';
}

function showGroupTitle(item) {
    if (isPopUpGroup(item)) return !!rawTitle(item);
    var raw = prop(item, ['ShowTitle', 'ПоказыватьЗаголовок']);
    if (raw && isFalse(raw)) return false;
    return !!rawTitle(item);
}

function titleLocation(item) {
    var v = String(prop(item, ['TitleLocation', 'ПоложениеЗаголовка']) || '').toLowerCase().replace(/[ _-]+/g, '');
    if (!v) return 'left';
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    if (v === 'right' || v.indexOf('прав') >= 0) return 'right';
    if (v === 'top' || v.indexOf('верх') >= 0) return 'top';
    if (v === 'bottom' || v.indexOf('низ') >= 0) return 'bottom';
    return 'left';
}

function itemKey(it) {
    if (!it) return '';
    return it.id != null && String(it.id) !== '' ? String(it.id) : String(it.name || '');
}

function safeId(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_'); }

function isContainer(tag) { return !!(tag && CONTAINER_TAGS[tag]); }

function spacingPx(kind) {
    if (!kind) return null;
    if (kind === 'half') return 4;
    if (kind === 'double') return 16;
    return 8;
}

function normOrient(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return null;
    if (v.indexOf('horizontal') >= 0 || v.indexOf('horiz') >= 0 || v === 'row'
        || v.indexOf('leftright') >= 0 || v.indexOf('горизонт') >= 0 || v.indexOf('слеванаправо') >= 0)
        return 'horizontal';
    if (v.indexOf('vertical') >= 0 || v.indexOf('vert') >= 0 || v === 'column'
        || v.indexOf('topbottom') >= 0 || v.indexOf('вертикал') >= 0 || v.indexOf('сверхувниз') >= 0)
        return 'vertical';
    return null;
}

function normSpacing(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return '';
    if (v.indexOf('double') >= 0 || v.indexOf('двойн') >= 0) return 'double';
    if (v.indexOf('half') >= 0 || v.indexOf('половин') >= 0) return 'half';
    return 'single';
}

function normWidth(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return '';
    if (v === 'equal' || v.indexOf('равн') >= 0) return 'equal';
    if ((v.indexOf('left') >= 0 && v.indexOf('wide') >= 0) || v === 'leftwidest') return 'leftwidest';
    if ((v.indexOf('right') >= 0 && v.indexOf('wide') >= 0) || v === 'rightwidest') return 'rightwidest';
    return '';
}

function normThrough(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return '';
    if (v.indexOf('dont') >= 0 || v.indexOf('неиспользов') >= 0 || v === 'no') return 'dontuse';
    if (v.indexOf('use') >= 0 || v === 'yes' || v === 'да') return 'use';
    return '';
}

function alignFlex(raw, kind) {
    var v = String(raw || '').toLowerCase();
    if (!String(raw || '').trim()) return '';
    if (v.indexOf('center') >= 0 || v.indexOf('центр') >= 0) return 'center';
    if (kind === 'h') {
        if (v.indexOf('right') >= 0 || v.indexOf('конец') >= 0 || v.indexOf('прав') >= 0) return 'flex-end';
        if (v.indexOf('left') >= 0 || v.indexOf('начал') >= 0 || v.indexOf('лев') >= 0) return 'flex-start';
    } else {
        if (v.indexOf('bottom') >= 0 || v.indexOf('низ') >= 0) return 'flex-end';
        if (v.indexOf('top') >= 0 || v.indexOf('верх') >= 0) return 'flex-start';
    }
    return '';
}

function defaultContainerOrientation(tag) {
    if (tag === 'UsualGroup' || tag === 'Group' || tag === 'CollapsibleGroup')
        return 'horizontal';
    return 'vertical';
}

function layoutMeta(item) {
    var tag = String((item && item.tag) || '');
    var isPages = tag === 'Pages';
    var isBar = tag === 'AutoCommandBar' || tag === 'CommandBar' || tag === 'ButtonGroup';
    var rawO = isPages ? '' : prop(item, ['Group', 'GroupOrientation', 'Orientation', 'Layout',
        'Группировка', 'Ориентация', 'Расположение']);
    var orientation = isPages ? 'vertical' : isBar ? (normOrient(rawO) || 'horizontal')
        : (normOrient(rawO) || defaultContainerOrientation(tag));
    var alwaysH = String(rawO || '').toLowerCase().indexOf('always') >= 0;
    var rawIndent = prop(item, ['IndentChildren', 'ShouldIndentChildren', 'ChildIndent']).toLowerCase();
    var indent = (rawIndent === 'true' || rawIndent === '1' || rawIndent === 'yes' || rawIndent === 'да') ? true
        : (rawIndent === 'false' || rawIndent === '0' || rawIndent === 'no' || rawIndent === 'нет') ? false
            : false;
    var bare = (tag === 'UsualGroup' || tag === 'Group' || tag === 'CollapsibleGroup' || tag === 'Page' || tag === 'ButtonGroup')
        && representationOf(item) === 'none';
    var hints = ['container', 'container-' + orientation];
    if (indent) hints.push('container-indent');
    if (bare) hints.push('container-bare');
    if (alwaysH || isBar || orientation === 'horizontal') hints.push('nowrap');
    if (tag) hints.push('container-' + tag.toLowerCase());
    if (tag === 'AutoCommandBar') hints.push('container-buttons');
    if (tag === 'Page' || tag === 'Pages') hints.push('container-page');
    if (isPages) hints.push('container-pages-root');
    var hs = '', vs = '', cw = '', th = '', jc = '', ai = '';
    if (!isPages) {
        hs = normSpacing(prop(item, ['HorizontalSpacing', 'ГоризонтальныйИнтервал']));
        vs = normSpacing(prop(item, ['VerticalSpacing', 'ВертикальныйИнтервал']));
        cw = normWidth(prop(item, ['ChildItemsWidth', 'ШиринаДочернихЭлементов']));
        th = normThrough(prop(item, ['ThroughAlign', 'СквозноеВыравнивание']));
        if (cw === 'equal') hints.push('ciwidth-equal');
        else if (cw === 'leftwidest') hints.push('ciwidth-leftwidest');
        else if (cw === 'rightwidest') hints.push('ciwidth-rightwidest');
        if (th === 'use') hints.push('throughalign-use');
        var gh = prop(item, ['GroupHorizontalAlign', 'HorizontalAlign', 'ГоризонтальноеВыравнивание']);
        var gv = prop(item, ['GroupVerticalAlign', 'VerticalAlign', 'ВертикальноеВыравнивание']);
        var h = alignFlex(gh, 'h');
        var v = alignFlex(gv, 'v');
        if (orientation === 'horizontal') { jc = h; ai = v; } else { jc = v; ai = h; }
        if (th === 'use') ai = 'stretch';
    }
    return {
        tag: tag, orientation: orientation, shouldIndentChildren: !!indent,
        containerClassHints: hints, horizontalSpacing: hs, verticalSpacing: vs,
        childItemsWidth: cw, throughAlign: th, flexJustifyContent: jc, flexAlignItems: ai
    };
}

function applyLayout(el, meta) {
    if (!el || !meta) return;
    var r = spacingPx(meta.verticalSpacing);
    var c = spacingPx(meta.horizontalSpacing);
    el.style.rowGap = r != null ? r + 'px' : '';
    el.style.columnGap = c != null ? c + 'px' : '';
    el.style.justifyContent = meta.flexJustifyContent || '';
    el.style.alignItems = meta.flexAlignItems || '';
}

function layoutClass(meta, opts) {
    opts = opts || {};
    var tag = meta && meta.tag ? String(meta.tag) : '';
    var orientation = (meta && meta.orientation) || 'vertical';
    var cls = [];
    if (opts.alias) cls.push(opts.alias);
    else if (!opts.skipChildren) cls.push('fp-children');
    cls.push('fp-children-' + orientation);
    if (meta && meta.shouldIndentChildren) cls.push('fp-children-indented');
    if (tag === 'AutoCommandBar') cls.push('fp-buttons-container');
    var hints = (meta && meta.containerClassHints) || [];
    if (hints.indexOf('nowrap') >= 0) cls.push('fp-children-nowrap');
    for (var i = 0; i < hints.length; i++) {
        cls.push('fp-' + String(hints[i]).replace(/[^a-z0-9_-]/gi, '-'));
    }
    return cls.join(' ');
}

function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
}

function fallbackWidget(label, tag) {
    var w = el('div', 'fp-fallback-widget');
    w.appendChild(el('span', 'fp-fallback-label', label || '—'));
    w.appendChild(el('span', 'fp-fallback-tag', tag || 'Control'));
    return w;
}

function appendInputButtons(field, item) {
    var kind = fieldKind(item);
    var drop = isTrue(prop(item, ['DropListButton'])) || isTrue(prop(item, ['ListChoiceMode'])) || kind === 'list';
    var choiceRaw = prop(item, ['ChoiceButton']);
    var choice = choiceRaw ? isTrue(choiceRaw) : (kind === 'ref');
    var openRaw = prop(item, ['OpenButton']);
    var openBtn = openRaw ? isTrue(openRaw) : (kind === 'ref' && !isFalse(openRaw));
    if (kind === 'date') field.appendChild(iconBtn('calendar'));
    if (drop) field.appendChild(iconBtn('chevron-down'));
    if (choice && kind !== 'number' && kind !== 'date') field.appendChild(iconBtn('dots'));
    if (openBtn && kind === 'ref') field.appendChild(iconBtn('box'));
    var hasClear = isTrue(prop(item, ['ClearButton']));
    if (!hasClear && item.events && item.events.indexOf('Clearing') >= 0) hasClear = true;
    if (hasClear) field.appendChild(iconBtn('x'));
}

function withColon(label, loc) {
    if (!label || (loc !== 'left' && loc !== 'top')) return label;
    if (/[:：]$/.test(label)) return label;
    return label + ':';
}

function makeFieldInput(item, loc, label, ctx) {
    var wrap = el('div', 'fp-control-wrap fp-field-row fp-title-' + loc);
    var shown = withColon(label, loc);
    if (shown && loc !== 'none') wrap.appendChild(el('span', 'fp-field-label', shown));
    var field = el('div', 'fp-input-wrap');
    var multiline = isMultilineField(item, ctx);
    var inp = el(multiline ? 'textarea' : 'input', 'fp-input');
    if (!multiline) inp.type = 'text';
    else {
        var rows = parseInt(prop(item, ['Height', 'Высота']), 10);
        inp.rows = rows > 1 ? rows : 3;
        wrap.classList.add('fp-multiline');
    }
    inp.readOnly = true;
    inp.tabIndex = -1;
    var ph = formatPlaceholder(item);
    if (ph) inp.value = ph;
    if (isTrue(prop(item, ['ReadOnly']))) {
        inp.classList.add('fp-input-readonly');
        field.classList.add('fp-input-readonly-wrap');
    }
    var ha = String(prop(item, ['HorizontalAlign']) || '').toLowerCase();
    if (ha.indexOf('right') >= 0 || ha.indexOf('прав') >= 0) inp.style.textAlign = 'right';
    field.appendChild(inp);
    if (!multiline) appendInputButtons(field, item);
    wrap.appendChild(field);
    return wrap;
}

function resolveButtonRep(item, ctx) {
    var rep = representationOf(item);
    if (rep === 'auto') {
        var crep = commandMeta(item, ctx, 'rep');
        if (crep && crep !== 'auto') rep = crep;
    }
    if (rep !== 'auto') return rep;
    if (item && item.tag === 'Popup') {
        var pPic = pictureRef(item) || commandMeta(item, ctx, 'picture');
        if (pPic && rawTitle(item)) return 'pictureandtext';
        if (pPic) return 'picture';
        return 'text';
    }
    var shortCmd = cmdShort(item);
    var isDefault = isTrue(prop(item, ['DefaultButton']));
    var pic = pictureRef(item) || commandMeta(item, ctx, 'picture');
    var iconStd = { MoveUp: 1, MoveDown: 1, Delete: 1, Copy: 1, Change: 1, Find: 1, Refresh: 1 };
    if (isDefault) return pic ? 'pictureandtext' : 'text';
    if (iconStd[shortCmd] && !rawTitle(item)) return 'picture';
    if (rawTitle(item)) return 'text';
    if (pic) return 'picture';
    if (STD_COMMANDS[shortCmd]) return 'text';
    return 'text';
}

function makeBarButton(item, tag, ctx) {
    var label = displayLabel(item, ctx, tag);
    var btnType = String(prop(item, ['Type']) || '').toLowerCase();
    var isLink = tag === 'Hyperlink' || btnType.indexOf('hyperlink') >= 0;
    var isDefault = isTrue(prop(item, ['DefaultButton']));
    var rep = resolveButtonRep(item, ctx);
    var iconOnly = rep === 'picture' || isHelpItem(item);
    if (isHelpItem(item)) label = '?';
    var cls = isLink ? 'fp-link' : 'fp-button';
    if (isDefault) cls += ' fp-button-default';
    if (iconOnly) cls += ' fp-icon-btn';
    if (tag === 'Popup') cls += ' fp-popup';
    var btn = el(isLink ? 'a' : 'button', cls);
    if (!isLink) {
        btn.disabled = tag !== 'Popup';
        btn.type = 'button';
    }
    var iconName = iconIdFor(item, ctx);
    if (iconOnly) {
        btn.appendChild(svgIcon(iconName));
        btn.title = displayLabel(item, ctx, tag) || item.name || '';
    } else if (rep === 'pictureandtext') {
        btn.appendChild(svgIcon(iconName));
        btn.appendChild(el('span', 'fp-btn-text', label || item.name || ''));
        if (tag === 'Popup') btn.appendChild(el('span', 'fp-caret', '▾'));
        btn.title = label || item.name || '';
    } else {
        btn.textContent = (label || (tag === 'Popup' ? 'Меню' : '…')) + (tag === 'Popup' ? ' ▾' : '');
        btn.title = label || item.name || '';
    }
    if (isHelpItem(item)) btn.classList.add('fp-help-btn');
    return btn;
}

function makeColumnTh(col, ctx) {
    var cap = columnCaption(col, ctx);
    var pic = pictureRef(col) || prop(col, ['HeaderPicture']);
    var th = el('th', col.tag === 'PictureField' ? 'fp-th-icon' : '');
    if (col.tag === 'PictureField' || (pic && !cap)) {
        th.appendChild(svgIcon(iconIdFromRef(pic || 'Picture') || 'photo'));
        th.title = titleOf(col, ctx) || col.name || '';
    } else {
        th.textContent = cap || col.name || '—';
    }
    th.setAttribute('data-id', itemKey(col));
    var cw = charSize(prop(col, ['Width']));
    var capW = Math.max(48, String(cap || col.name || '').length * CHAR_PX);
    th.style.minWidth = (cw || capW) + 'px';
    return th;
}

function createControl(item, tag, ctx) {
    var label = displayLabel(item, ctx, tag);
    var wrap = el('div', 'fp-control-wrap');
    var loc = titleLocation(item);
    if (tag === 'InputField' || tag === 'ValueList') {
        wrap = makeFieldInput(item, loc, label, ctx);
    } else if (tag === 'SearchStringAddition') {
        wrap.className = 'fp-control-wrap fp-search-wrap';
        var field = el('div', 'fp-input-wrap fp-search-field');
        var inp = el('input', 'fp-input');
        inp.type = 'text';
        inp.readOnly = true;
        inp.placeholder = 'Поиск (Ctrl+F)';
        field.appendChild(inp);
        field.appendChild(iconBtn('x'));
        wrap.appendChild(field);
    } else if (tag === 'ViewStatusAddition') {
        wrap.className = 'fp-control-wrap fp-chips';
        ['Поле1: Значение1', 'Поле2: Значение2'].forEach(function (t) {
            var chip = el('span', 'fp-chip', t);
            chip.appendChild(el('span', 'fp-chip-x', '×'));
            wrap.appendChild(chip);
        });
    } else if (tag === 'CheckBoxField') {
        wrap.className = 'fp-control-wrap fp-field-row fp-check-row';
        var cb = el('input', 'fp-check');
        cb.type = 'checkbox';
        cb.disabled = true;
        var lblCb = el('span', 'fp-field-label', label || '—');
        if (loc === 'right' || loc === 'none') { wrap.appendChild(cb); if (loc !== 'none') wrap.appendChild(lblCb); }
        else { wrap.appendChild(lblCb); wrap.appendChild(cb); }
    } else if (tag === 'RadioButton' || tag === 'RadioButtonField') {
        wrap.className = 'fp-control-wrap fp-field-row fp-title-' + loc;
        if (label && loc !== 'none') wrap.appendChild(el('span', 'fp-field-label', withColon(label, loc)));
        var opts = radioOptions(item);
        var colCount = parseInt(prop(item, ['ColumnsCount']), 10) || 0;
        var row = colCount !== 1 && opts.length <= 4;
        var stack = el('div', 'fp-radio-stack' + (row ? ' fp-radio-row' : ''));
        opts.forEach(function (opt, idx) {
            var lab = el('label', 'fp-radio-option');
            var rb = document.createElement('input');
            rb.type = 'radio';
            rb.disabled = true;
            rb.name = (item.id || item.name || 'radio') + '-fp';
            if (idx === 0) rb.checked = true;
            lab.appendChild(rb);
            lab.appendChild(el('span', '', opt));
            stack.appendChild(lab);
        });
        wrap.appendChild(stack);
    } else if (tag === 'ListBox' || tag === 'ListField') {
        wrap.className = 'fp-control-wrap fp-field-row';
        wrap.appendChild(el('span', 'fp-field-label', label || '—'));
        var list = el('div', 'fp-list-mock');
        ['Первый элемент', 'Второй элемент', 'Третий элемент'].forEach(function (opt, idx) {
            list.appendChild(el('div', 'fp-list-row' + (idx === 1 ? ' active' : ''), opt));
        });
        wrap.appendChild(list);
    } else if (tag === 'Button' || tag === 'Hyperlink') {
        wrap.appendChild(makeBarButton(item, tag, ctx));
    } else if (tag === 'Popup') {
        wrap.className = 'fp-control-wrap fp-popup-wrap';
        var pbtn = makeBarButton(item, tag, ctx);
        wrap.appendChild(pbtn);
        wrap.appendChild(makePopupMenu(item, ctx));
        wrap._popupBtn = pbtn;
    } else if (tag === 'LabelField') {
        var asLink = isHyperlinkItem(item) || (item.events && item.events.indexOf('URLProcessing') >= 0);
        var lfCls = 'fp-label' + (asLink ? ' fp-link' : '');
        var lfText = label;
        if (!lfText && (loc === 'none' || asLink)) lfText = '';
        else if (!lfText) lfText = '—';
        if (lfText) wrap.appendChild(el('span', lfCls, lfText));
        else if (asLink) wrap.appendChild(el('span', lfCls, '\u00a0'));
    } else if (tag === 'Table') {
        wrap.className = 'fp-control-wrap fp-table-widget';
        var toolbar = el('div', 'fp-table-toolbar fp-commandbar');
        var barSrc = item.autoCommandBar || { tag: 'AutoCommandBar', childItems: [], properties: {} };
        var barKids = tableStdCommands(item).concat(barSrc.childItems || []);
        renderPreview(barKids, toolbar, ctx, barSrc);
        if (item.searchStringAddition && !additionHidden(item, 'SearchStringLocation')) {
            var sItem = item.searchStringAddition;
            var sdiv = el('div', 'fp-item fp-control fp-bar-item fp-search-item');
            sdiv.dataset.id = itemKey(sItem);
            sdiv.appendChild(createControl(sItem, 'SearchStringAddition', ctx));
            var moreEl = toolbar.querySelector('.fp-more-item');
            if (moreEl) toolbar.insertBefore(sdiv, moreEl);
            else toolbar.appendChild(sdiv);
        }
        if (!toolbar.querySelector('.fp-more-item')) {
            var moreBtn = el('button', 'fp-button fp-popup');
            moreBtn.disabled = true;
            moreBtn.type = 'button';
            moreBtn.textContent = 'Еще ▾';
            var moreWrap = el('div', 'fp-item fp-control fp-bar-item fp-more-item');
            moreWrap.appendChild(moreBtn);
            toolbar.appendChild(moreWrap);
        }
        pinCommandBarTail(toolbar);
        wrap.appendChild(toolbar);
        if (item.viewStatusAddition && !additionHidden(item, 'ViewStatusLocation')) {
            wrap.appendChild(createControl(item.viewStatusAddition, 'ViewStatusAddition', ctx));
        }
        var tableWrap = el('div', 'fp-table-mock');
        var tbl = document.createElement('table');
        var thead = document.createElement('thead');
        var cols = tableColumns(item);
        var leafs = [];
        var hasGroup = false;
        for (var gi = 0; gi < cols.length; gi++) {
            if (isHeaderGroup(cols[gi])) {
                hasGroup = true;
                var gk = headerKids(cols[gi]);
                if (gk.length) for (var gj = 0; gj < gk.length; gj++) leafs.push(gk[gj]);
                else leafs.push(cols[gi]);
            } else leafs.push(cols[gi]);
        }
        var topTr = document.createElement('tr');
        var botTr = hasGroup ? document.createElement('tr') : null;
        for (var i = 0; i < cols.length; i++) {
            if (isHeaderGroup(cols[i])) {
                var gKids = headerKids(cols[i]);
                var gCap = rawTitle(cols[i]) || titleOf(cols[i], ctx) || '';
                var gTh = el('th', 'fp-th-group', gCap);
                gTh.colSpan = Math.max(1, gKids.length);
                gTh.setAttribute('data-id', itemKey(cols[i]));
                topTr.appendChild(gTh);
                if (!gKids.length) {
                    var emptySub = el('th', '');
                    emptySub.setAttribute('data-id', itemKey(cols[i]));
                    botTr.appendChild(emptySub);
                } else {
                    for (var sk = 0; sk < gKids.length; sk++) botTr.appendChild(makeColumnTh(gKids[sk], ctx));
                }
            } else {
                var th = makeColumnTh(cols[i], ctx);
                if (hasGroup) th.rowSpan = 2;
                topTr.appendChild(th);
            }
        }
        if (!cols.length) topTr.appendChild(el('th', '', label || item.name || 'Таблица'));
        thead.appendChild(topTr);
        if (botTr && botTr.children.length) thead.appendChild(botTr);
        tbl.appendChild(thead);
        var tbody = document.createElement('tbody');
        var tr = document.createElement('tr');
        var nCols = Math.max(1, leafs.length);
        for (var ei = 0; ei < nCols; ei++) tr.appendChild(el('td', 'fp-table-empty', ''));
        tbody.appendChild(tr);
        tbl.appendChild(tbody);
        tableWrap.appendChild(tbl);
        wrap.appendChild(tableWrap);
        wrap._tableCols = leafs;
    } else if (tag === 'Page' || tag === 'Pages') {
        var pageBlock = el('div', tag === 'Pages' ? 'fp-group-block' : 'fp-page-block');
        var pageKids = el('div', '');
        pageBlock.appendChild(pageKids);
        wrap.appendChild(pageBlock);
        wrap._childBox = pageKids;
    } else if (tag === 'AutoCommandBar' || tag === 'CommandBar') {
        var bar = el('div', 'fp-commandbar');
        wrap.appendChild(bar);
        wrap._childBox = bar;
    } else if (tag === 'ButtonGroup') {
        var bg = el('div', 'fp-buttongroup');
        wrap.appendChild(bg);
        wrap._childBox = bg;
    } else if (isContainer(tag)) {
        var popup = isPopUpGroup(item);
        var group = el('div', representationOf(item) === 'none' ? 'fp-group-bare' : 'fp-group-block');
        if (popup) group.classList.add('fp-popup-group');
        if (showGroupTitle(item) && label) {
            var ttc = prop(item, ['TitleTextColor', 'ЦветТекстаЗаголовка']);
            var linkTitle = popup || /гиперссылка/i.test(ttc);
            if (popup) {
                var titleBtn = el('button', 'fp-link fp-popup-group-title', label);
                titleBtn.type = 'button';
                group.appendChild(titleBtn);
                wrap._popupTitleBtn = titleBtn;
            } else {
                group.appendChild(el('div', 'fp-group-title' + (linkTitle ? ' fp-link' : ''), label));
            }
        }
        var kids = el('div', popup ? 'fp-popup-group-body' : '');
        group.appendChild(kids);
        wrap.appendChild(group);
        wrap._childBox = kids;
    } else if (tag === 'LabelDecoration') {
        var dcls = 'fp-label fp-label-decoration' + (isHyperlinkItem(item) ? ' fp-link' : '');
        if (label) wrap.appendChild(el('span', dcls, label));
        else {
            var nm = String(item.name || '');
            if (/разделител/i.test(nm)) wrap.appendChild(el('span', 'fp-deco-sep'));
            else {
                var sp = el('span', 'fp-deco-spacer');
                var sw = charSize(prop(item, ['Width']));
                if (sw) sp.style.width = sw + 'px';
                wrap.appendChild(sp);
            }
        }
    } else if (tag === 'PictureDecoration' || tag === 'PictureField') {
        var picWrap = el('span', 'fp-picture-icon');
        picWrap.appendChild(svgIcon(iconIdFromRef(pictureRef(item)) || 'alert-triangle'));
        wrap.appendChild(picWrap);
    } else if (RARE_TAGS[tag]) {
        wrap.appendChild(fallbackWidget(label, tag));
    } else {
        wrap.appendChild(el('span', 'fp-fallback', label + (tag ? ' (' + tag + ')' : '')));
    }
    return wrap;
}

function renderPages(pagesNode, outerEl, meta, ctx) {
    outerEl.textContent = '';
    var pages = (pagesNode.childItems || []).filter(function (it) { return it && it.tag === 'Page'; });
    var pagesKey = itemKey(pagesNode);
    var ids = pages.map(itemKey).filter(Boolean);
    var active = pagesKey ? activePageIdByPagesKey[pagesKey] : null;
    if (active && ids.indexOf(active) < 0) active = null;
    if (!active && ids.length) active = ids[0];
    if (pagesKey && active) activePageIdByPagesKey[pagesKey] = active;
    var activePage = null;
    for (var i = 0; i < pages.length; i++) {
        if (itemKey(pages[i]) === active) { activePage = pages[i]; break; }
    }
    if (pagesRep(pagesNode) === 'none') {
        outerEl.className = layoutClass(meta);
        applyLayout(outerEl, meta);
        if (activePage && activePage.childItems && activePage.childItems.length) {
            var hiddenMeta = layoutMeta(activePage);
            outerEl.className = layoutClass(hiddenMeta);
            applyLayout(outerEl, hiddenMeta);
            renderPreview(activePage.childItems, outerEl, ctx, activePage);
        }
        return;
    }
    outerEl.className = layoutClass(meta, { skipChildren: true, alias: 'fp-pages-outer' })
        + (pagesRep(pagesNode) === 'bottom' ? ' TabsOnBottom' : ' TabsOnTop');
    applyLayout(outerEl, meta);
    var tablist = el('div', 'fp-pages-tablist');
    tablist.setAttribute('role', 'tablist');
    var panelWrap = el('div', 'fp-pages-panel-wrap');
    pages.forEach(function (pageItem, idx) {
        var pid = itemKey(pageItem);
        if (!pid) return;
        var tab = el('button', 'fp-pages-tab', titleOf(pageItem, ctx) || pageItem.name || ('Страница ' + (idx + 1)));
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', pid === active ? 'true' : 'false');
        tab.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            activePageIdByPagesKey[pagesKey] = pid;
            if (ctx && ctx.root && ctx.model) renderPreview(displayItems(ctx.model), ctx.root, ctx, null);
            selectIn(ctx.root, pid, ctx);
            if (ctx && ctx.onSelect) ctx.onSelect(pageItem);
        });
        tablist.appendChild(tab);
    });
    var panel = el('div', 'fp-pages-active-panel');
    panel.setAttribute('role', 'tabpanel');
    var inner = null;
    if (activePage && activePage.childItems && activePage.childItems.length) {
        inner = layoutMeta(activePage);
        panel.className += ' ' + layoutClass(inner);
        applyLayout(panel, inner);
        renderPreview(activePage.childItems, panel, ctx, activePage);
    } else if (!pages.length) {
        panel.className += ' fp-empty';
        panel.textContent = 'Нет страниц';
    }
    panelWrap.appendChild(panel);
    outerEl.appendChild(tablist);
    outerEl.appendChild(panelWrap);
    if (inner && inner.orientation === 'vertical')
        equalizeFieldLabels(panel, true);
}

function bindSelect(div, item, ctx) {
    div.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('th[data-id]')) return;
        e.stopPropagation();
        selectIn(ctx.root, itemKey(item), ctx);
        if (ctx.onSelect) ctx.onSelect(item);
    });
}

function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function locateItem(items, id, pageStack) {
    if (!items || !id) return null;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        if (itemKey(it) === id) return { item: it, pages: pageStack || [] };
        if (it.tag === 'Pages') {
            var pages = it.childItems || [];
            for (var p = 0; p < pages.length; p++) {
                if (!pages[p] || pages[p].tag !== 'Page') continue;
                var next = (pageStack || []).concat([{ pagesNode: it, page: pages[p] }]);
                if (itemKey(pages[p]) === id) return { item: pages[p], pages: next };
                var hit = locateItem(pages[p].childItems, id, next);
                if (hit) return hit;
            }
            continue;
        }
        var nested = locateItem(it.childItems, id, pageStack);
        if (nested) return nested;
        if (it.autoCommandBar) {
            nested = locateItem([it.autoCommandBar], id, pageStack);
            if (nested) return nested;
        }
        if (it.searchStringAddition) {
            nested = locateItem([it.searchStringAddition], id, pageStack);
            if (nested) return nested;
        }
        if (it.viewStatusAddition) {
            nested = locateItem([it.viewStatusAddition], id, pageStack);
            if (nested) return nested;
        }
    }
    return null;
}

function activatePagesForId(model, id) {
    var loc = locateItem(displayItems(model), id, []);
    if (!loc || !loc.pages || !loc.pages.length) return false;
    var changed = false;
    for (var i = 0; i < loc.pages.length; i++) {
        var pk = itemKey(loc.pages[i].pagesNode);
        var pid = itemKey(loc.pages[i].page);
        if (pk && pid && activePageIdByPagesKey[pk] !== pid) {
            activePageIdByPagesKey[pk] = pid;
            changed = true;
        }
    }
    return changed;
}

function selectIn(root, id, ctx) {
    if (!root) return null;
    if (ctx) ctx.selectedId = id || '';
    var nodes = root.querySelectorAll('.fp-item.selected, th.selected, .fp-popup-entry.selected');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('selected');
    if (!id) return null;
    var hit = root.querySelector('.fp-item[data-id="' + cssEscape(id) + '"]');
    if (hit) hit.classList.add('selected');
    var th = root.querySelector('th[data-id="' + cssEscape(id) + '"]');
    if (th) th.classList.add('selected');
    var entry = root.querySelector('.fp-popup-entry[data-id="' + cssEscape(id) + '"]');
    if (entry) entry.classList.add('selected');
    return hit || th || entry || null;
}

function renderPreview(items, parentEl, ctx, parentItem) {
    parentEl.innerHTML = '';
    if (!items || !items.length) {
        parentEl.classList.remove('fp-mockup');
        parentEl.textContent = 'Нет элементов';
        return;
    }
    parentEl.classList.add('fp-mockup');
    var inBar = parentItem && (parentItem.tag === 'AutoCommandBar' || parentItem.tag === 'CommandBar' || parentItem.tag === 'ButtonGroup');
    var parentMeta = parentItem ? layoutMeta(parentItem) : null;
    var extraBar = [];
    items.forEach(function (item) {
        if (isFalse(prop(item, ['Visible', 'visible']))) return;
        if (inBar && isDeadCommand(item)) return;
        if (inBar && inAdditionalBar(item)) { extraBar.push(item); return; }
        var tag = item.tag || '';
        if (inBar && tag === 'Popup' && !popupHasCommands(item)) {
            extraBar.push(item);
            return;
        }
        if (tag === 'ButtonGroup' && !hasMainBarChildren(item)) {
            collectAdditionalBarItems(item, extraBar);
            return;
        }
        var id = itemKey(item);
        var container = isContainer(tag) && tag !== 'Popup' && tag !== 'Table';
        var meta = isContainer(tag) && tag !== 'Popup' ? layoutMeta(item) : null;
        var div = el('div', 'fp-item ' + (container || tag === 'Table' ? 'fp-container' : 'fp-control'));
        if (inBar) div.classList.add('fp-bar-item');
        if (isHelpItem(item)) div.classList.add('fp-help-item');
        if (meta) {
            div.classList.add('fp-container-' + meta.orientation);
            if ((meta.containerClassHints || []).indexOf('container-bare') >= 0) div.classList.add('fp-bare');
        }
        div.dataset.id = id;
        div.dataset.tag = tag;
        var control = createControl(item, tag, ctx);
        div.appendChild(control);
        applyItemMetrics(div, item, tag, parentMeta, ctx);
        bindSelect(div, item, ctx);
        if (tag === 'Popup' && control._popupBtn) bindPopupToggle(control, control._popupBtn, ctx, item);
        if (isPopUpGroup(item) && control._popupTitleBtn)
            bindGroupPopupToggle(control, control._popupTitleBtn, ctx, item);
        parentEl.appendChild(div);
        if (tag === 'Table') {
            var cols = control._tableCols || tableColumns(item);
            var ths = control.querySelectorAll('th[data-id]');
            for (var ti = 0; ti < ths.length; ti++) {
                (function (th) {
                    var colId = th.getAttribute('data-id');
                    if (!colId) return;
                    var colItem = null;
                    for (var c = 0; c < cols.length; c++) {
                        if (itemKey(cols[c]) === colId) { colItem = cols[c]; break; }
                    }
                    th.addEventListener('click', function (ev) {
                        ev.stopPropagation();
                        selectIn(ctx.root, colId, ctx);
                        if (ctx.onSelect && colItem) ctx.onSelect(colItem);
                    });
                })(ths[ti]);
            }
        } else if (container && control._childBox && ((item.childItems && item.childItems.length) || tag === 'Pages')) {
            var box = control._childBox;
            if (tag === 'Pages') {
                renderPages(item, box, meta, ctx);
            } else {
                box.className = (box.className ? box.className + ' ' : '') + layoutClass(meta);
                applyLayout(box, meta);
                renderPreview(item.childItems, box, ctx, item);
                if (meta && meta.orientation === 'horizontal') {
                    box.classList.add('fp-children-nowrap');
                    if (meta.throughAlign === 'use') equalizeAcrossColumns(box);
                }
            }
        }
    });
    if (inBar && extraBar.length && parentItem && parentItem.tag !== 'ButtonGroup') {
        var more = el('button', 'fp-button fp-popup');
        more.disabled = true;
        more.type = 'button';
        more.textContent = 'Еще ▾';
        more.title = extraBar.map(function (it) { return titleOf(it, ctx) || it.name; }).filter(Boolean).join(', ');
        var moreWrap = el('div', 'fp-item fp-control fp-bar-item fp-more-item');
        moreWrap.appendChild(more);
        var help = parentEl.querySelector('.fp-help-item');
        if (help) parentEl.insertBefore(moreWrap, help);
        else parentEl.appendChild(moreWrap);
    }
    if (inBar && parentItem && (parentItem.tag === 'AutoCommandBar' || parentItem.tag === 'CommandBar'))
        pinCommandBarTail(parentEl);
    if (parentMeta && parentMeta.orientation === 'vertical')
        equalizeFieldLabels(parentEl, true);
}

function fieldRowSkipped(wrap) {
    if (!wrap || !wrap.classList) return true;
    return wrap.classList.contains('fp-title-top')
        || wrap.classList.contains('fp-title-bottom')
        || wrap.classList.contains('fp-title-none')
        || wrap.classList.contains('fp-check-row');
}

function firstFieldLabel(box) {
    if (!box) return null;
    for (var i = 0; i < box.children.length; i++) {
        var n = box.children[i];
        if (!n.classList || !n.classList.contains('fp-control')) continue;
        var wrap = n.querySelector('.fp-field-row');
        if (fieldRowSkipped(wrap)) continue;
        var lab = wrap && wrap.querySelector('.fp-field-label');
        if (lab) return lab;
    }
    return null;
}

function collectFieldLabels(box, deep) {
    var labels = [];
    if (!box) return labels;
    for (var i = 0; i < box.children.length; i++) {
        var n = box.children[i];
        if (!n.classList) continue;
        if (n.classList.contains('fp-control')) {
            var wrap = n.querySelector('.fp-field-row');
            if (fieldRowSkipped(wrap)) continue;
            var lab = wrap && wrap.querySelector('.fp-field-label');
            if (lab) labels.push(lab);
            continue;
        }
        if (!deep || !n.classList.contains('fp-container')) continue;
        var inner = n.querySelector('.fp-children');
        if (!inner) continue;
        if (inner.classList.contains('fp-children-horizontal')) {
            var first = firstFieldLabel(inner);
            if (first) labels.push(first);
        } else {
            var nested = collectFieldLabels(inner, true);
            for (var c = 0; c < nested.length; c++) labels.push(nested[c]);
        }
    }
    return labels;
}

function applyLabelWidth(labels) {
    if (!labels || labels.length < 2) return;
    var max = 0;
    for (var j = 0; j < labels.length; j++) {
        var w = labels[j].offsetWidth || (String(labels[j].textContent || '').length * CHAR_PX);
        if (w > max) max = w;
    }
    if (max < 40) return;
    if (max > 280) max = 280;
    for (var k = 0; k < labels.length; k++) labels[k].style.minWidth = max + 'px';
}

function equalizeFieldLabels(box, includeFirstOfHorizontal) {
    applyLabelWidth(collectFieldLabels(box, !!includeFirstOfHorizontal));
}

function equalizeAcrossColumns(box) {
    if (!box) return;
    var labels = [];
    for (var i = 0; i < box.children.length; i++) {
        var n = box.children[i];
        if (!n.classList || !n.classList.contains('fp-container')) continue;
        var inner = n.querySelector('.fp-children-vertical');
        if (!inner) continue;
        var col = collectFieldLabels(inner, true);
        for (var c = 0; c < col.length; c++) labels.push(col[c]);
    }
    applyLabelWidth(labels);
}

function iconFor(tag) {
    if (tag === 'Button' || tag === 'Hyperlink') return { cls: 'icon-form-btn', icon: 'click' };
    if (tag === 'InputField' || tag === 'SearchStringAddition' || tag === 'ValueList') return { cls: 'icon-form-in', icon: 'forms' };
    if (tag === 'CheckBoxField') return { cls: 'icon-form-chk', icon: 'checkbox' };
    if (tag === 'Table') return { cls: 'icon-form-tbl', icon: 'table' };
    if (tag === 'Page' || tag === 'Pages') return { cls: 'icon-form-pg', icon: 'layout-navbar' };
    if (isContainer(tag)) return { cls: 'icon-form-grp', icon: 'folder' };
    if (tag === 'Attribute') return { cls: 'icon-form-attr', icon: 'tag' };
    if (tag === 'Command') return { cls: 'icon-form-cmd', icon: 'command' };
    return { cls: 'icon-form-etc', icon: 'box' };
}

function indexSourceLines(xml) {
    var map = {};
    if (!xml) return map;
    var lines = xml.split(/\r?\n/);
    var re = /<([A-Za-z][\w:.]*)\b[^>]*\bname="([^"]+)"/g;
    for (var i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(lines[i]))) {
            var tag = m[1];
            var colon = tag.lastIndexOf(':');
            if (colon >= 0) tag = tag.slice(colon + 1);
            var key = tag + '\0' + m[2];
            if (map[key] == null) map[key] = i + 1;
            if (map['\0' + m[2]] == null) map['\0' + m[2]] = i + 1;
        }
    }
    return map;
}

function lineOf(map, item) {
    if (!item) return 1;
    var byTag = map[item.tag + '\0' + item.name];
    if (byTag) return byTag;
    var byName = map['\0' + item.name];
    return byName || 1;
}

function walkOutline(items, depth, map, out, ctx) {
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || SKIP_TAGS[it.tag]) continue;
        var label = titleOf(it, ctx);
        var name = it.name || it.tag || '';
        out.push({
            type: 'form',
            tag: it.tag || '',
            name: name,
            title: label && label !== name ? label : '',
            line: lineOf(map, it),
            depth: depth,
            id: itemKey(it)
        });
        if (it.childItems && it.childItems.length) walkOutline(it.childItems, depth + 1, map, out, ctx);
        if (it.autoCommandBar) walkOutline([it.autoCommandBar], depth + 1, map, out, ctx);
        if (it.searchStringAddition) walkOutline([it.searchStringAddition], depth + 1, map, out, ctx);
        if (it.viewStatusAddition) walkOutline([it.viewStatusAddition], depth + 1, map, out, ctx);
    }
}

function outline(model, xml) {
    var out = [];
    var map = indexSourceLines(xml || '');
    if (!model) return out;
    var ctx = { captionIndex: buildCaptionIndex(model) };
    if (model.autoCommandBar) walkOutline([model.autoCommandBar], 0, map, out, ctx);
    walkOutline(model.childItemsRoot, 0, map, out, ctx);
    outlineHasChildren(out);
    return out;
}

function outlineHasChildren(items) {
    if (!items) return items;
    for (var i = 0; i < items.length; i++) {
        items[i].hasChildren = false;
        if (items[i].type !== 'form') continue;
        var d = items[i].depth || 0;
        if (i + 1 < items.length && items[i + 1].type === 'form' && (items[i + 1].depth || 0) > d) {
            items[i].hasChildren = true;
        }
    }
    return items;
}

function outlineHidden(items, index, collapsed) {
    if (!items || !collapsed || index < 0) return false;
    var d = items[index].depth || 0;
    for (var i = index - 1; i >= 0 && d > 0; i--) {
        if (items[i].type !== 'form') continue;
        var pd = items[i].depth || 0;
        if (pd < d) {
            if (items[i].id && collapsed[items[i].id]) return true;
            d = pd;
        }
    }
    return false;
}

function outlineExpandTo(items, id, collapsed) {
    if (!items || !id || !collapsed) return false;
    var idx = -1;
    var i;
    for (i = 0; i < items.length; i++) {
        if (items[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return false;
    var d = items[idx].depth || 0;
    var changed = false;
    for (i = idx - 1; i >= 0 && d > 0; i--) {
        if (items[i].type !== 'form') continue;
        var pd = items[i].depth || 0;
        if (pd < d) {
            if (items[i].id && collapsed[items[i].id]) {
                delete collapsed[items[i].id];
                changed = true;
            }
            d = pd;
        }
    }
    return changed;
}

function outlineCollapseAll(items, collapsed) {
    if (!collapsed) return collapsed;
    var k;
    for (k in collapsed) {
        if (Object.prototype.hasOwnProperty.call(collapsed, k)) delete collapsed[k];
    }
    outlineHasChildren(items);
    if (!items) return collapsed;
    for (var i = 0; i < items.length; i++) {
        if (items[i].hasChildren && items[i].id) collapsed[items[i].id] = true;
    }
    return collapsed;
}

function renderMeta(model, host) {
    var bits = [];
    if (model.attributes && model.attributes.length) {
        bits.push('Реквизиты: ' + model.attributes.length);
    }
    if (model.commands && model.commands.length) {
        bits.push('Команды: ' + model.commands.length);
    }
    if (!bits.length) return;
    var bar = el('div', 'fp-meta');
    for (var i = 0; i < bits.length; i++) bar.appendChild(el('div', 'fp-meta-row', bits[i]));
    host.appendChild(bar);
}

function render(model, container, options) {
    options = options || {};
    container.innerHTML = '';
    container.className = 'fp-root fp-taxi fp-light';
    var body = el('div', 'fp-body');
    body.id = 'fp-canvas';
    container.appendChild(body);
    if (!model) {
        body.className = 'fp-body fp-empty';
        body.textContent = 'Нет модели формы';
        return;
    }
    var commandTitles = {};
    var commands = {};
    var cmds = model.commands || [];
    for (var i = 0; i < cmds.length; i++) {
        if (cmds[i].name) commands[cmds[i].name] = cmds[i];
        var cap = rawTitle(cmds[i]);
        if (cap && cmds[i].name) commandTitles[cmds[i].name] = cap;
    }
    var items = displayItems(model);
    var ctx = {
        model: model,
        root: body,
        onSelect: options.onSelect,
        commandTitles: commandTitles,
        commands: commands,
        selectedId: '',
        captionIndex: buildCaptionIndex(model)
    };
    container._fpCtx = ctx;
    if (!container._fpPopupDismiss) {
        var popupRoot = function () { return container.querySelector('#fp-canvas') || container; };
        container._fpPopupDismiss = function (ev) {
            var t = ev.target;
            if (t && t.closest && (t.closest('.fp-popup-wrap') || t.closest('.fp-popup-group'))) return;
            closeAllPopups(popupRoot());
        };
        container._fpPopupKey = function (ev) {
            if (ev.key === 'Escape' || ev.keyCode === 27) closeAllPopups(popupRoot());
        };
        var doc = container.ownerDocument || document;
        doc.addEventListener('click', container._fpPopupDismiss, true);
        doc.addEventListener('keydown', container._fpPopupKey);
    }
    if (!items.length) {
        body.className = 'fp-body fp-empty';
        body.innerHTML = '<p class="fp-empty-title">Превью формы</p><p class="fp-empty-hint">В Form.xml нет элементов ChildItems.</p>';
    } else {
        renderPreview(items, body, ctx, null);
    }
}

function revealPopupAncestors(root, node) {
    var n = node;
    while (n && n !== root) {
        if (n.classList && n.classList.contains('fp-popup-group')) {
            var wrap = n.parentNode;
            while (wrap && wrap !== root && !(wrap.classList && wrap.classList.contains('fp-control-wrap')))
                wrap = wrap.parentNode;
            var btn = n.querySelector('.fp-popup-group-title');
            var body = n.querySelector('.fp-popup-group-body');
            closeAllPopups(root);
            n.classList.add('fp-popup-open');
            if (wrap && wrap.classList) wrap.classList.add('fp-popup-open');
            positionFixedPopup(btn, body, 320);
            break;
        }
        n = n.parentNode;
    }
}

function highlight(container, id) {
    if (!container || !id) return null;
    var ctx = container._fpCtx;
    if (ctx && ctx.model && activatePagesForId(ctx.model, id)) {
        renderPreview(displayItems(ctx.model), ctx.root, ctx, null);
    }
    var canvas = container.querySelector('#fp-canvas') || (ctx && ctx.root) || container;
    var hit = selectIn(canvas, id, ctx);
    if (hit) revealPopupAncestors(canvas, hit);
    if (hit && hit.scrollIntoView) {
        try { hit.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (e) { hit.scrollIntoView(); }
    }
    return hit;
}

root.FormPreview = {
    detect: detect,
    parse: parse,
    render: render,
    outline: outline,
    outlineHasChildren: outlineHasChildren,
    outlineHidden: outlineHidden,
    outlineExpandTo: outlineExpandTo,
    outlineCollapseAll: outlineCollapseAll,
    highlight: highlight,
    itemKey: itemKey,
    iconFor: iconFor,
    _test: {
        layoutMeta: layoutMeta,
        wantsHStretch: wantsHStretch,
        compactTag: compactTag,
        defaultFieldChars: defaultFieldChars,
        titleLocation: titleLocation,
        pagesRep: pagesRep,
        isEmptyCommandBar: isEmptyCommandBar,
        groupHasFields: groupHasFields,
        isFalse: isFalse,
        isTrue: isTrue,
        titleOf: titleOf,
        displayLabel: displayLabel,
        humanizeIdent: humanizeIdent,
        fieldRowSkipped: fieldRowSkipped,
        radioOptions: radioOptions,
        tableColumns: tableColumns,
        columnCaption: columnCaption,
        tableStdCommands: tableStdCommands,
        showGroupTitle: showGroupTitle,
        groupBehavior: groupBehavior,
        isPopUpGroup: isPopUpGroup,
        applyLabelWidth: applyLabelWidth,
        fieldKind: fieldKind,
        isInCellGroup: isInCellGroup,
        additionHidden: additionHidden,
        inAdditionalBar: inAdditionalBar,
        isDeadCommand: isDeadCommand,
        hasMainBarChildren: hasMainBarChildren,
        collectAdditionalBarItems: collectAdditionalBarItems,
        popupHasCommands: popupHasCommands,
        popupMenuEntries: popupMenuEntries,
        parseObjectMeta: parseObjectMeta,
        buildCaptionIndex: buildCaptionIndex,
        captionForPath: captionForPath,
        objectMetaCandidates: objectMetaCandidates,
        resolveButtonRep: resolveButtonRep,
        wantsVStretch: wantsVStretch,
        isMultilineField: isMultilineField,
        isUnlimitedString: isUnlimitedString,
        fieldHeight: fieldHeight,
        formObjectKind: formObjectKind,
        formStdCommandButtons: formStdCommandButtons,
        formCommandBar: formCommandBar,
        displayItems: displayItems,
        stdCommandKey: stdCommandKey,
        iconIdFor: iconIdFor,
        iconIdFromRef: iconIdFromRef,
        iconFor: iconFor,
        outlineHasChildren: outlineHasChildren,
        outlineHidden: outlineHidden,
        outlineExpandTo: outlineExpandTo,
        outlineCollapseAll: outlineCollapseAll
    }
};

})(window);
