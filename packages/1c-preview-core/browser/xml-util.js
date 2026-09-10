/* DOM helpers shared by the XML-backed previews (form-preview, template-preview).
 *
 * 1C dumps use namespace prefixes inconsistently between Designer and EDT, so
 * every lookup goes through localName() rather than tagName. Load this before
 * the preview modules. */
(function (root) {
'use strict';

/* Tag name without its namespace prefix. */
function localName(el) {
    if (!el) return '';
    var n = el.localName || el.tagName || '';
    var i = n.indexOf(':');
    return i >= 0 ? n.slice(i + 1) : n;
}

/* Direct children named `tag`, prefix-insensitive. */
function namedChildren(parent, tag) {
    var out = [];
    if (!parent) return out;
    var kids = parent.children || [];
    for (var i = 0; i < kids.length; i++) {
        if (localName(kids[i]) === tag) out.push(kids[i]);
    }
    return out;
}

function firstChild(parent, tag) {
    var list = namedChildren(parent, tag);
    return list.length ? list[0] : null;
}

/* Collapsed text: for captions, names and other single-line values. */
function textOf(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
}

/* Text with line breaks kept: template cells may hold multi-line content. */
function rawText(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

/* v8:LocalStringType — <item><lang/><content/></item> repeated per language.
 * Picks the UI language, then Russian, then whatever came first. `read` selects
 * the text extractor: collapsed for captions, raw for template cells. */
function localizedFrom(el, read) {
    if (!el) return '';
    read = read || textOf;
    var items = [];
    function walk(node) {
        if (!node || !node.children) return;
        for (var i = 0; i < node.children.length; i++) {
            var c = node.children[i];
            if (localName(c) === 'item') {
                var lang = '', content = '';
                for (var j = 0; j < c.children.length; j++) {
                    var p = c.children[j];
                    var pn = localName(p);
                    if (pn === 'lang') lang = textOf(p);
                    else if (pn === 'content') content = read(p);
                }
                if (content) items.push({ lang: lang, content: content });
            } else {
                walk(c);
            }
        }
    }
    walk(el);
    if (!items.length) return read(el);
    var want = '';
    try { want = String((navigator && navigator.language) || '').toLowerCase(); } catch (e) { want = ''; }
    var base = want.split('-')[0];
    for (var i = 0; i < items.length; i++) {
        var lg = String(items[i].lang || '').toLowerCase();
        if (lg === want || lg === 'ru' || (base && lg.split('-')[0] === base)) return items[i].content;
    }
    return items[0].content;
}

root.XmlUtil = {
    localName: localName,
    namedChildren: namedChildren,
    firstChild: firstChild,
    textOf: textOf,
    rawText: rawText,
    localizedFrom: localizedFrom
};

})(window);
