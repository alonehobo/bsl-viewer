/* The one preview-provider registry shared by every host: the Total Commander
 * viewer, the MCP agent page and the VS Code webview.
 *
 * A provider claims a file and then owns how it is drawn: the outline lists the
 * document's own structure and the preview replaces the source view entirely.
 *
 * First match wins, so order matters — a managed form is also valid XML.
 *
 * `parser` and `viewer` are separate on purpose: an .mxl binary is decoded by
 * MxlPreview but drawn by TemplatePreview, because both produce the same
 * spreadsheet model. Adding a format means adding an entry here, and nothing
 * else in any of the three hosts.
 *
 * Fields the browser hosts do not need are still declared here rather than in
 * each host, so the three stay in step; a host simply ignores what it has no
 * use for. */
(function (root) {
'use strict';

var PROVIDERS = [
    {
        id: 'form',
        parser: 'FormPreview',
        viewer: 'FormPreview',
        label: 'Форма 1С',
        /* A managed form is XML, so in a host that knows the source language
         * this provider must not claim, say, a Markdown file that happens to
         * mention <Form>. Hosts that do not track a language skip the check. */
        requiresLanguage: 'xml',
        /* FormPreview.parse takes the owning object's metadata as its second
         * argument; the other parsers take content only. */
        usesObjectMeta: true,
        /* A form mockup stands in for the real 1C application window, so it
         * always renders as light chrome and hides the theme toggle. */
        lightChrome: true,
        /* Its outline is a collapsible element tree, not a flat list. */
        tree: true,
        outlineTitle: 'Элементы формы',
        sourceTitle: 'Показать форму',
        rootCls: 'fp-root',
        emptyCls: 'fp-empty',
        emptyMsg: 'Это не форма 1С (нет корневого Form / logform).'
    },
    {
        id: 'mxl',
        parser: 'MxlPreview',
        viewer: 'TemplatePreview',
        label: 'MXL',
        outlineTitle: 'Области макета',
        sourceTitle: 'Показать макет',
        rootCls: 'tp-root',
        emptyCls: 'tp-empty',
        emptyMsg: 'Это не макет табличного документа 1С.',
        /* Area ids in a spreadsheet outline are synthesised, so selection also
         * matches on the area name and falls back to a text scan. */
        selectMatchesByName: true,
        selectHighlightsPreview: true
    },
    {
        id: 'template',
        parser: 'TemplatePreview',
        viewer: 'TemplatePreview',
        label: 'Макет 1С',
        outlineTitle: 'Области макета',
        sourceTitle: 'Показать макет',
        rootCls: 'tp-root',
        emptyCls: 'tp-empty',
        emptyMsg: 'Это не макет табличного документа 1С.',
        selectMatchesByName: true,
        selectHighlightsPreview: true
    }
];

/* Usable only once both the module that parses for it and the module that
 * draws it are on the page. */
function ready(entry) {
    return !!(entry && root[entry.parser] && root[entry.viewer]);
}

function byId(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
        if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return null;
}

/* `context.language` is optional: pass it in a host that knows the source
 * language, omit it in a host that only ever opens .xml and .mxl files. */
function detect(content, context) {
    var language = context && context.language;
    for (var i = 0; i < PROVIDERS.length; i++) {
        var entry = PROVIDERS[i];
        if (!ready(entry)) continue;
        if (entry.requiresLanguage && language !== undefined && language !== entry.requiresLanguage) continue;
        if (root[entry.parser].detect(content)) return entry;
    }
    return null;
}

function parse(entry, content, context) {
    var parser = root[entry.parser];
    return entry.usesObjectMeta
        ? parser.parse(content, (context && context.objectMeta) || '')
        : parser.parse(content);
}

/* The module that renders, highlights and outlines for a provider. */
function view(entry) {
    return entry ? root[entry.viewer] : null;
}

root.PreviewProviders = {
    list: PROVIDERS,
    ready: ready,
    byId: byId,
    detect: detect,
    parse: parse,
    view: view,
    /* Every host reports an unrecognised file the same way. */
    unsupportedMessage: 'Файл не распознан как форма 1С, Template.xml или MXL.'
};
})(typeof globalThis !== 'undefined' ? globalThis : window);
