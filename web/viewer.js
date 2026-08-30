/* BSLView / BSLEdit viewer.
 *
 * The page is static and always served from the same URL so that Chromium can
 * reuse its HTTP and V8 code caches between openings. File content never goes
 * into the markup; the host pushes it over postMessage after the page reports
 * that it is ready. That keeps reopening a file down to a model swap instead of
 * a full navigation. */
(function () {
'use strict';

var LOCAL_HOST = 'bslview.invalid';
var CDN_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
var isLocal = (location.hostname === LOCAL_HOST
            || location.hostname === 'localhost'
            || location.hostname === '127.0.0.1');
var VS_BASE = isLocal ? 'vs' : CDN_BASE;
var MARKED_URL = isLocal ? 'marked.min.js' : 'https://cdn.jsdelivr.net/npm/marked@15.0.6/marked.min.js';
var TURNDOWN_URL = isLocal ? 'turndown.min.js' : 'https://cdn.jsdelivr.net/npm/turndown@7.2.1/dist/turndown.js';

/* Beyond this, Monaco's minimap, folding and bracket colourisation cost more
 * than they are worth and make scrolling stutter. */
var BIG_FILE_LINES = 20000;
var BIG_FILE_CHARS = 2 * 1024 * 1024;

var host = (window.chrome && window.chrome.webview) ? window.chrome.webview : null;
var pending = null;      // load request that arrived before Monaco finished loading
var monacoReady = false;
var editor = null;
var model = null;
var state = {
    language: 'bsl',
    isDark: false,
    fontSize: 14,
    readOnly: true,
    isEditing: false,
    previewMode: false,
    sortByName: false,
    dirty: false
};
var allItems = [];
var baselineContent = '';
var suppressDirty = false;
var pendingLeaveEdit = false;

// ---------------------------------------------------------------- host I/O

function send(msg) { if (host) host.postMessage(msg); }

function onHostMessage(ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    switch (d.cmd) {
        case 'load':
            /* Paint the page chrome before Monaco finishes so a dark WebView2
             * surface is not left empty while the bundle parses. */
            document.documentElement.className = (d.theme === 'dark') ? 'theme-dark' : 'theme-light';
            if (monacoReady) applyLoad(d); else pending = d;
            break;
        case 'find':    doFind(d); break;
        case 'copy':    if (editor) editor.trigger('host', 'editor.action.clipboardCopyAction', null); break;
        case 'selectAll':
            if (editor && model) {
                var last = model.getLineCount();
                editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: model.getLineMaxColumn(last) });
                editor.focus();
            }
            break;
        case 'park':    parkEditor(); break;
        case 'saved':   onSaveResult(d.ok); break;
        case 'reverted': onReverted(d); break;
        case 'pdfDone': clearPrintContent(); break;
    }
}

if (host) host.addEventListener('message', onHostMessage);
else window.addEventListener('message', onHostMessage);

// ------------------------------------------------------------ Monaco setup

function defineBsl(monaco) {
    monaco.languages.register({ id: 'bsl', extensions: ['.bsl', '.os'], aliases: ['1C', 'BSL'] });

    monaco.languages.setMonarchTokensProvider('bsl', {
        ignoreCase: true,
        keywords: [
            'КонецПроцедуры', 'EndProcedure', 'КонецФункции', 'EndFunction',
            'Прервать', 'Break', 'Продолжить', 'Continue', 'Возврат', 'Return',
            'Если', 'If', 'Иначе', 'Else', 'ИначеЕсли', 'ElsIf', 'Тогда', 'Then',
            'КонецЕсли', 'EndIf', 'Попытка', 'Try', 'Исключение', 'Except',
            'КонецПопытки', 'EndTry', 'ВызватьИсключение', 'Raise',
            'Пока', 'While', 'Для', 'For', 'Каждого', 'Each', 'Из', 'In', 'По', 'To',
            'Цикл', 'Do', 'КонецЦикла', 'EndDo',
            'НЕ', 'NOT', 'И', 'AND', 'ИЛИ', 'OR',
            'Новый', 'New', 'Процедура', 'Procedure', 'Функция', 'Function',
            'Перем', 'Var', 'Экспорт', 'Export', 'Знач', 'Val',
            'Неопределено', 'Undefined', 'Истина', 'True', 'Ложь', 'False', 'Null',
            'Выполнить', 'Execute', 'Асинх', 'Async', 'Ждать', 'Await',
            'ДобавитьОбработчик', 'AddHandler', 'УдалитьОбработчик', 'RemoveHandler',
            'Перейти', 'Goto'
        ],
        operators: ['=', '<=', '>=', '<>', '<', '>', '+', '-', '*', '/', '%'],
        symbols: /[=><!~?:&+\-*\/\^%]+/,
        tokenizer: {
            root: [
                [/\/\/.*$/, 'comment'],
                [/^\s*#[^\n]*/, 'preproc'],
                [/&[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'compile'],
                [/~[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'gotomark'],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*\s*(?=\()/, {
                    cases: { '@keywords': 'keyword', '@default': 'funcname' }
                }],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, {
                    cases: { '@keywords': 'keyword', '@default': 'identifier' }
                }],
                [/[()\[\]]/, 'delimiter.bracket'],
                [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/\d+/, 'number'],
                [/[;,.]/, 'delimiter'],
                [/"/, { token: 'string.quote', next: '@string' }],
                [/'[^']*'/, 'date']
            ],
            string: [
                [/""/, 'string.escape'],
                [/"/, { token: 'string.quote', next: '@pop' }],
                [/\|/, 'string'],
                [/[^"|]+/, 'string']
            ]
        }
    });

    monaco.languages.setLanguageConfiguration('bsl', {
        comments: { lineComment: '//' },
        brackets: [['(', ')'], ['[', ']']],
        autoClosingPairs: [
            { open: '(', close: ')' },
            { open: '[', close: ']' },
            { open: '"', close: '"' }
        ],
        surroundingPairs: [
            { open: '(', close: ')' },
            { open: '"', close: '"' }
        ],
        indentationRules: {
            increaseIndentPattern: /^\s*(Процедура|Procedure|Функция|Function|Если|If|Иначе|Else|ИначеЕсли|ElsIf|Пока|While|Для|For|Попытка|Try|Исключение|Except)\b/i,
            decreaseIndentPattern: /^\s*(КонецПроцедуры|EndProcedure|КонецФункции|EndFunction|КонецЕсли|EndIf|КонецЦикла|EndDo|КонецПопытки|EndTry|Иначе|Else|ИначеЕсли|ElsIf|Исключение|Except)\b/i
        }
    });

    monaco.editor.defineTheme('bsl-light', {
        base: 'vs',
        inherit: false,
        rules: [
            { token: '', foreground: '0000ff' },
            { token: 'comment', foreground: '008000' },
            { token: 'keyword', foreground: 'ff0000' },
            { token: 'identifier', foreground: '0000ff' },
            { token: 'funcname', foreground: '0000ff' },
            { token: 'operator', foreground: 'ff0000' },
            { token: 'delimiter', foreground: 'ff0000' },
            { token: 'delimiter.bracket', foreground: 'ff0000' },
            { token: 'string', foreground: '000000' },
            { token: 'string.quote', foreground: '000000' },
            { token: 'string.escape', foreground: '000000' },
            { token: 'string.key', foreground: '0000ff' },
            { token: 'number', foreground: '000000' },
            { token: 'number.float', foreground: '000000' },
            { token: 'date', foreground: '000000' },
            { token: 'preproc', foreground: '963200' },
            { token: 'compile', foreground: '963200' },
            { token: 'gotomark', foreground: '3a3a3a' },
            { token: 'tag', foreground: 'ff0000' },
            { token: 'metatag', foreground: '963200' },
            { token: 'attribute.name', foreground: '0000ff' },
            { token: 'attribute.value', foreground: '000000' }
        ],
        colors: {
            'editor.background': '#FFFFFF',
            'editor.foreground': '#0000ff',
            'editor.selectionBackground': '#ffe877',
            'editor.selectionHighlightBackground': '#fef6d0',
            'editor.inactiveSelectionBackground': '#fef6d0',
            'editorLineNumber.foreground': '#2b91af',
            'editorLineNumber.activeForeground': '#0000ff'
        }
    });

    monaco.editor.defineTheme('bsl-dark', {
        base: 'vs-dark',
        /* inherit:false so a switch from bsl-light (also inherit:false) fully
         * replaces token CSS. Merging onto vs-dark left the previous light
         * colours in place, so only the HTML outline panel appeared to change. */
        inherit: false,
        rules: [
            { token: '', foreground: 'd4d4d4' },
            { token: 'comment', foreground: '6A9955' },
            { token: 'keyword', foreground: '499caa' },
            { token: 'identifier', foreground: 'd4d4d4' },
            { token: 'funcname', foreground: 'd4d4d4' },
            { token: 'operator', foreground: 'd4d4d4' },
            { token: 'delimiter', foreground: 'd4d4d4' },
            { token: 'delimiter.bracket', foreground: 'd4d4d4' },
            { token: 'string', foreground: 'c3602c' },
            { token: 'string.quote', foreground: 'c3602c' },
            { token: 'string.escape', foreground: 'c3602c' },
            { token: 'string.key', foreground: '9cdcfe' },
            { token: 'number', foreground: 'b5cea8' },
            { token: 'number.float', foreground: 'b5cea8' },
            { token: 'date', foreground: 'b5cea8' },
            { token: 'preproc', foreground: 'ce9178' },
            { token: 'compile', foreground: 'ce9178' },
            { token: 'gotomark', foreground: 'ff9000' },
            { token: 'tag', foreground: '569cd6' },
            { token: 'metatag', foreground: 'c586c0' },
            { token: 'attribute.name', foreground: '9cdcfe' },
            { token: 'attribute.value', foreground: 'c3602c' }
        ],
        colors: {
            'editor.background': '#1E1E1E',
            'editor.foreground': '#D4D4D4',
            'editor.lineHighlightBackground': '#2A2A2A',
            'editor.selectionBackground': '#264F78',
            'editor.inactiveSelectionBackground': '#3A3D41',
            'editorLineNumber.foreground': '#858585',
            'editorLineNumber.activeForeground': '#C6C6C6',
            'editorCursor.foreground': '#AEAFAD',
            'editorWidget.background': '#252526',
            'editorWidget.foreground': '#CCCCCC',
            'minimap.background': '#1E1E1E'
        }
    });

    monaco.languages.registerDocumentSymbolProvider('bsl', {
        provideDocumentSymbols: function (m) {
            var syms = [], lines = m.getLinesContent();
            var re = /^\s*(Процедура|Procedure|Функция|Function)\s+([a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*)/i;
            for (var i = 0; i < lines.length; i++) {
                var mm = lines[i].match(re);
                if (!mm) continue;
                var k = mm[1].toLowerCase();
                var isF = (k === 'функция' || k === 'function');
                var range = { startLineNumber: i + 1, startColumn: 1, endLineNumber: i + 1, endColumn: lines[i].length + 1 };
                syms.push({
                    name: mm[2], detail: mm[1],
                    kind: isF ? monaco.languages.SymbolKind.Function : monaco.languages.SymbolKind.Method,
                    range: range, selectionRange: range
                });
            }
            return syms;
        }
    });

    defineJsonXml(monaco);
}

/* JSON/XML: register monarch tokenisers up front. Monaco's jsonMode loads
 * asynchronously (and may later replace JSON tokens); XML is lazy-loaded
 * from basic-languages. Without our own providers the first paint is
 * plaintext, and bsl-light/bsl-dark (inherit:false) had no colours for
 * tag / attribute / string.key anyway. */
function defineJsonXml(monaco) {
    monaco.languages.setMonarchTokensProvider('json', {
        tokenPostfix: '.json',
        defaultToken: '',
        tokenizer: {
            root: [
                { include: '@whitespace' },
                [/[{}]/, 'delimiter.bracket'],
                [/[\[\]]/, 'delimiter.array'],
                [/[,:]/, 'delimiter'],
                [/"([^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, { token: 'string.quote', next: '@string' }],
                [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
                [/true|false|null/, 'keyword']
            ],
            string: [
                [/[^\\"']+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, { token: 'string.quote', next: '@pop' }]
            ],
            whitespace: [
                [/[ \t\r\n]+/, ''],
                [/\/\*/, { token: 'comment', next: '@comment' }],
                [/\/\/.*$/, 'comment']
            ],
            comment: [
                [/[^*]+/, 'comment'],
                [/\*\//, { token: 'comment', next: '@pop' }],
                [/./, 'comment']
            ]
        }
    });
    monaco.languages.setLanguageConfiguration('json', {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [['{', '}'], ['[', ']']],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '"', close: '"' }
        ]
    });

    monaco.languages.setMonarchTokensProvider('xml', {
        defaultToken: '',
        tokenPostfix: '.xml',
        ignoreCase: true,
        qualifiedName: /(?:[\w.\-]+:)?[\w.\-]+/,
        tokenizer: {
            root: [
                [/[^<&]+/, ''],
                { include: '@whitespace' },
                [/(<\?)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'metatag', next: '@tag' }]],
                [/<!\[CDATA\[/, { token: 'delimiter.cdata', next: '@cdata' }],
                [/(<\!)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'metatag', next: '@tag' }]],
                [/(<\/)(@qualifiedName)(\s*)(>)/, [
                    { token: 'delimiter' }, { token: 'tag' }, '', { token: 'delimiter' }
                ]],
                [/(<)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'tag', next: '@tag' }]],
                [/&\w+;/, 'string.escape']
            ],
            cdata: [
                [/[^\]]+/, ''],
                [/\]\]>/, { token: 'delimiter.cdata', next: '@pop' }],
                [/\]/, '']
            ],
            tag: [
                [/[ \t\r\n]+/, ''],
                [/(@qualifiedName)(\s*=\s*)("[^"]*"|'[^']*')/, [
                    'attribute.name', '', 'attribute.value'
                ]],
                [/@qualifiedName/, 'attribute.name'],
                [/\?>/, { token: 'delimiter', next: '@pop' }],
                [/(\/)(>)/, [{ token: 'tag' }, { token: 'delimiter', next: '@pop' }]],
                [/>/, { token: 'delimiter', next: '@pop' }]
            ],
            whitespace: [
                [/[ \t\r\n]+/, ''],
                [/<!--/, { token: 'comment', next: '@comment' }]
            ],
            comment: [
                [/-->/, { token: 'comment', next: '@pop' }],
                [/[^-]+/, 'comment.content'],
                [/./, 'comment.content']
            ]
        }
    });
    monaco.languages.setLanguageConfiguration('xml', {
        comments: { blockComment: ['<!--', '-->'] },
        brackets: [['<', '>']],
        autoClosingPairs: [
            { open: '<', close: '>' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ]
    });
}

// ------------------------------------------------------------------ editor

function editorOptions(big) {
    return {
        theme: state.isDark ? 'bsl-dark' : 'bsl-light',
        readOnly: !state.isEditing,
        fontSize: state.fontSize,
        fontFamily: "Consolas, 'Courier New', monospace",
        fontLigatures: false,
        /* Extra translate3d layers on .lines-content fight WebView2's compositor. */
        disableLayerHinting: true,
        minimap: { enabled: !big },
        folding: !big,
        bracketPairColorization: { enabled: !big },
        occurrencesHighlight: big ? 'off' : 'singleFile',
        renderLineHighlight: big ? 'none' : 'line',
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        automaticLayout: true,
        wordWrap: (state.language === 'markdown' || state.language === 'html') ? 'on' : 'off',
        renderWhitespace: 'none',
        links: false,
        contextmenu: true,
        quickSuggestions: false,
        parameterHints: { enabled: false },
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: 'off',
        tabCompletion: 'off',
        wordBasedSuggestions: 'off',
        find: { addExtraSpaceOnTop: false },
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false }
    };
}

function applyLoad(req) {
    var content = req.content || '';
    state.language = req.language || 'bsl';
    state.isDark = (req.theme === 'dark');
    state.fontSize = req.fontSize || 14;
    state.readOnly = (req.readOnly !== false);
    state.isEditing = !state.readOnly;
    state.previewMode = false;
    state.dirty = false;
    baselineContent = content;
    pendingLeaveEdit = false;
    hideSavePrompt();

    var big = content.length > BIG_FILE_CHARS;
    var old = model;
    model = monaco.editor.createModel(content, state.language);
    if (!big && model.getLineCount() > BIG_FILE_LINES) big = true;

    ensureEditor(big);
    editor.setModel(model);
    if (old) old.dispose();

    model.onDidChangeContent(function () {
        if (!suppressDirty) state.dirty = true;
        updateStatusBar();
        if (!applyingFromPreview && !suppressDirty) schedulePreviewRefresh();
    });

    // A reused instance may still be showing the previous file's UI state.
    document.getElementById('outline-filter').value = '';
    editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });

    applyTheme();
    updateStatusBar();
    finishFirstPaint();
    setPreviewMode(state.language === 'markdown' || state.language === 'html');

    /* Outline scanning walks every line, so let the editor paint first. */
    allItems = [];
    renderOutline();
    setTimeout(function () {
        if (state.language === 'bsl') { parseOutline(); renderOutline(); }
    }, 0);
}

/* Create the editor once, preferably while the parked warm instance is still
 * off-screen. The first on-screen open then only swaps the model — the path
 * that already worked when the user closed and reopened the viewer. */
function ensureEditor(big) {
    document.getElementById('main').style.display = 'flex';
    if (!editor) {
        editor = monaco.editor.create(document.getElementById('editor'), editorOptions(!!big));
        wireEditorCommands();
        wireEditorScrollFix();
        wireStatusBar();
        wirePreviewScroll();
    } else {
        editor.updateOptions(editorOptions(!!big));
    }
}

function monacoCssReady() {
    try {
        for (var i = 0; i < document.styleSheets.length; i++) {
            var href = document.styleSheets[i].href || '';
            if (href.indexOf('editor.main.css') < 0) continue;
            var rules = document.styleSheets[i].cssRules || document.styleSheets[i].rules;
            return !!(rules && rules.length);
        }
    } catch (e) { /* opaque sheet */ }
    return false;
}

function viewLinesPositioned() {
    var line = document.querySelector('.monaco-editor .view-line');
    return !!(line && getComputedStyle(line).position === 'absolute');
}

function finishFirstPaint() {
    if (!editor) return;
    editor.layout();
    clampLinesContent();
    var tries = 0;
    /* Use setTimeout, not rAF: when the host briefly hides the WebView,
     * requestAnimationFrame is paused and we never reach "painted". */
    function tick() {
        if (!editor) return;
        editor.layout();
        clampLinesContent();
        tries++;
        var ready = monacoCssReady() && viewLinesPositioned();
        if (ready || tries > 30) {
            document.getElementById('loading').style.display = 'none';
            editor.layout();
            clampLinesContent();
            send({ cmd: 'painted' });
            setTimeout(function () { send({ cmd: 'painted' }); }, 50);
            setTimeout(function () { send({ cmd: 'painted' }); }, 250);
            return;
        }
        setTimeout(tick, 50);
    }
    setTimeout(tick, 0);
}

function prewarmEditor() {
    if (editor) return;
    ensureEditor(false);
    /* Keep the loading overlay up until a real file arrives and paints. */
}

/* The host keeps this page alive between files. Drop the document so a parked
 * instance does not hold a whole file in memory, but keep Monaco itself warm. */
function parkEditor() {
    if (!editor) return;
    var old = model;
    model = monaco.editor.createModel('', 'plaintext');
    editor.setModel(model);
    if (old) old.dispose();
    allItems = [];
    state.dirty = false;
    baselineContent = '';
    pendingLeaveEdit = false;
    hideSavePrompt();
    if (state.previewMode) setPreviewMode(false);
    renderOutline();
    updateStatusBar();
    document.getElementById('loading').style.display = 'flex';
}

function wireEditorCommands() {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, toggleEdit);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
}

/* Monaco's _applyLayout sets .lines-content to 16777216×16777216. That square
 * layer breaks WebView2 compositing. Replace it with the real scroll size.
 * Do NOT clamp height to ~16k — that clipped view-lines after ~860 rows
 * (860 × 19px ≈ 16340). Width can stay modest; height must cover scrollHeight. */
var MAX_LINES_CONTENT_WIDTH = 100000;
var MAX_LINES_CONTENT_HEIGHT = 1000000;   // same ceiling Monaco uses for margins
function clampLinesContent() {
    if (!editor) return;
    var root = editor.getDomNode();
    if (!root) return;
    var lc = root.querySelector('.lines-content');
    if (!lc) return;
    var layout = editor.getLayoutInfo();
    var h = Math.max(editor.getScrollHeight(), layout.height) + layout.height + 64;
    var w = Math.max(editor.getScrollWidth(), layout.width) + layout.width + 64;
    if (h > MAX_LINES_CONTENT_HEIGHT) h = MAX_LINES_CONTENT_HEIGHT;
    if (w > MAX_LINES_CONTENT_WIDTH) w = MAX_LINES_CONTENT_WIDTH;
    if (lc.style.height !== h + 'px') lc.style.height = h + 'px';
    if (lc.style.width !== w + 'px') lc.style.width = w + 'px';
}

function wireEditorScrollFix() {
    clampLinesContent();
    editor.onDidLayoutChange(clampLinesContent);
    editor.onDidScrollChange(clampLinesContent);
}

// -------------------------------------------------------------- status bar

function updateStatusBar() {
    var posEl = document.getElementById('sb-pos');
    var selEl = document.getElementById('sb-sel');
    var linesEl = document.getElementById('sb-lines');
    if (!posEl || !selEl || !linesEl) return;

    var m = (editor && editor.getModel()) || model;
    if (!m) {
        posEl.textContent = 'Стр 1, Кол 1';
        selEl.textContent = '';
        linesEl.textContent = 'Строк: 0';
        return;
    }

    var pos = editor ? editor.getPosition() : null;
    posEl.textContent = 'Стр ' + (pos ? pos.lineNumber : 1) + ', Кол ' + (pos ? pos.column : 1);

    var n = 0;
    if (editor) {
        var sels = editor.getSelections();
        if (sels) {
            for (var i = 0; i < sels.length; i++) {
                if (!sels[i].isEmpty()) n += m.getValueLengthInRange(sels[i]);
            }
        }
    }
    selEl.textContent = n > 0 ? ('Выделено: ' + n) : '';
    linesEl.textContent = 'Строк: ' + m.getLineCount();
}

function wireStatusBar() {
    editor.onDidChangeCursorPosition(updateStatusBar);
    editor.onDidChangeCursorSelection(function () {
        updateStatusBar();
        syncHighlightFromEditor();
    });
    updateStatusBar();
}

// ----------------------------------------------------------------- outline

function parseOutline() {
    var lines = model.getLinesContent();
    var procRe = /^\s*(Процедура|Procedure|Функция|Function)\s+([a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*)/i;
    var regionRe = /^\s*#\s*(Область|Region)\s+(.*)/i;
    var endRegionRe = /^\s*#\s*(КонецОбласти|EndRegion)/i;
    allItems = [];
    for (var i = 0; i < lines.length; i++) {
        var rm = lines[i].match(regionRe);
        if (rm) { allItems.push({ type: 'region', name: rm[2].trim(), line: i + 1 }); continue; }
        if (endRegionRe.test(lines[i])) continue;
        var m = lines[i].match(procRe);
        if (m) {
            var k = m[1].toLowerCase();
            var isF = (k === 'функция' || k === 'function');
            allItems.push({ type: isF ? 'func' : 'proc', name: m[2], line: i + 1 });
        }
    }
}

function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderOutline() {
    var items = allItems;
    if (state.sortByName) {
        items = items.filter(function (x) { return x.type !== 'region'; })
                     .sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    }
    var cnt = 0;
    for (var i = 0; i < allItems.length; i++) if (allItems[i].type !== 'region') cnt++;

    document.getElementById('outline-count').textContent = 'Структура (' + cnt + ')';
    var sortBtn = document.getElementById('sort-btn');
    sortBtn.textContent = state.sortByName ? '@\u2193' : '#\u2193';
    sortBtn.title = state.sortByName ? 'По имени \u2192 По порядку' : 'По порядку \u2192 По имени';

    var h = [];
    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (it.type === 'region') {
            h.push('<div class="region-group">', esc(it.name), '</div>');
        } else {
            h.push('<div class="proc-item" data-line="', it.line, '" data-name="', esc(it.name.toLowerCase()), '">',
                   '<span class="icon ', (it.type === 'func' ? 'icon-func">F' : 'icon-proc">P'), '</span>',
                   '<span class="name">', esc(it.name), '</span>',
                   '<span class="line-num">', it.line, '</span></div>');
        }
    }
    document.getElementById('outline-list').innerHTML = h.join('');
    applyFilter();
}

function applyFilter() {
    var v = document.getElementById('outline-filter').value.toLowerCase();
    document.getElementById('filter-clear').style.display = v ? 'block' : 'none';
    var ps = document.querySelectorAll('.proc-item');
    for (var k = 0; k < ps.length; k++) {
        ps[k].style.display = (!v || ps[k].getAttribute('data-name').indexOf(v) >= 0) ? '' : 'none';
    }
}

// ----------------------------------------------------------------- chrome

function applyTheme() {
    var name = state.isDark ? 'bsl-dark' : 'bsl-light';
    document.documentElement.className = state.isDark ? 'theme-dark' : 'theme-light';
    /* Bounce through the built-in theme so Monaco rebuilds its token
     * stylesheet from a known base before our colours replace it. Skip the
     * bounce on the very first paint: create() already used `name`, and an
     * extra vs-dark flash reads as a black screen. */
    if (editor && editor.__bslThemeApplied) {
        monaco.editor.setTheme(state.isDark ? 'vs-dark' : 'vs');
    }
    monaco.editor.setTheme(name);
    if (editor) {
        editor.__bslThemeApplied = true;
        editor.render(true);
    }
    applyChrome();
    applyPreviewTheme();
    applyPreviewEditable();
    send({ cmd: 'theme', dark: !!state.isDark });
}

function applyChrome() {
    var dk = state.isDark;
    var outlinePanel = document.getElementById('outline-panel');
    var outlineToggle = document.getElementById('outline-toggle');
    var isBsl = (state.language === 'bsl');

    outlinePanel.className = dk ? 'dark' : 'light';
    outlineToggle.className = dk ? 'dark' : 'light';
    outlineToggle.style.display = isBsl ? '' : 'none';
    outlinePanel.style.display = isBsl ? 'flex' : 'none';

    var ot = document.getElementById('outline-top');
    ot.classList.remove('dark', 'light');
    ot.classList.add(dk ? 'dark' : 'light');

    var btns = document.querySelectorAll('.tb-btn');
    for (var i = 0; i < btns.length; i++) {
        if (!btns[i].classList.contains('active') && !btns[i].classList.contains('save-ok') && !btns[i].classList.contains('save-err')) {
            btns[i].classList.remove('dark', 'light');
            btns[i].classList.add(dk ? 'dark' : 'light');
        }
    }

    document.getElementById('btn-theme').innerHTML = dk ? '\u263E Темная' : '\u2600 Светлая';

    var btnEdit = document.getElementById('btn-edit');
    var btnSave = document.getElementById('btn-save');
    btnEdit.innerHTML = state.isEditing ? '&#9998; Редактирование' : '&#9998; Просмотр';
    btnEdit.classList.toggle('active', state.isEditing);
    btnSave.style.display = state.isEditing ? '' : 'none';

    var canPreview = (state.language === 'markdown' || state.language === 'html');
    document.getElementById('btn-preview').style.display = canPreview ? '' : 'none';
}

function flushPreviewEdits() {
    if (previewInputTimer) {
        clearTimeout(previewInputTimer);
        previewInputTimer = null;
        writeSourceFromPreview();
    }
}

function setEditing(on) {
    state.isEditing = !!on;
    editor.updateOptions({ readOnly: !state.isEditing });
    applyChrome();
    applyPreviewEditable();
    if (state.isEditing && state.previewMode) focusPreview();
    else editor.focus();
}

function hideSavePrompt() {
    var el = document.getElementById('save-prompt');
    if (el) el.hidden = true;
}

function showSavePrompt() {
    var el = document.getElementById('save-prompt');
    if (!el) return;
    el.hidden = false;
    var yes = document.getElementById('save-prompt-yes');
    if (yes) yes.focus();
}

function applyRevert(content) {
    if (!model) return;
    var scroll = editor ? editor.getScrollTop() : 0;
    var pos = editor ? editor.getPosition() : null;
    suppressDirty = true;
    applyingFromPreview = true;
    model.setValue(content || '');
    applyingFromPreview = false;
    suppressDirty = false;
    state.dirty = false;
    baselineContent = model.getValue();
    if (editor) {
        editor.setScrollTop(scroll);
        if (pos) editor.setPosition(pos);
    }
    if (state.previewMode) {
        refreshPreviewContent();
        applyPreviewEditable();
        syncPreviewFromEditor();
        if (typeof syncHighlightFromEditor === 'function') syncHighlightFromEditor();
    }
    if (state.language === 'bsl') { parseOutline(); renderOutline(); }
    updateStatusBar();
}

function revertUnsaved() {
    applyRevert(baselineContent);
    setEditing(false);
    if (host) send({ cmd: 'reload' });
}

function savePromptOpen() {
    var el = document.getElementById('save-prompt');
    return !!(el && !el.hidden);
}

function toggleEdit() {
    if (pendingLeaveEdit || savePromptOpen()) return;
    if (state.isEditing) {
        flushPreviewEdits();
        if (state.dirty) {
            showSavePrompt();
            return;
        }
        setEditing(false);
    } else {
        setEditing(true);
    }
}

function onSavePromptYes() {
    hideSavePrompt();
    pendingLeaveEdit = true;
    saveFile();
}

function onSavePromptNo() {
    hideSavePrompt();
    revertUnsaved();
}

function onSavePromptCancel() {
    hideSavePrompt();
    pendingLeaveEdit = false;
    if (editor) editor.focus();
}

function onReverted(d) {
    if (d && d.ok && typeof d.content === 'string') applyRevert(d.content);
    pendingLeaveEdit = false;
}

function onSaveResult(ok) {
    var btnSave = document.getElementById('btn-save');
    btnSave.classList.remove('save-ok', 'save-err');
    btnSave.classList.add(ok ? 'save-ok' : 'save-err');
    btnSave.innerHTML = ok ? '&#10004; Сохранено' : '&#10006; Ошибка';
    if (ok) {
        state.dirty = false;
        if (model) baselineContent = model.getValue();
        if (pendingLeaveEdit) {
            pendingLeaveEdit = false;
            setEditing(false);
        }
    } else {
        pendingLeaveEdit = false;
    }
    setTimeout(function () {
        btnSave.classList.remove('save-ok', 'save-err');
        btnSave.innerHTML = '&#128190; Сохранить';
        applyChrome();
    }, 2000);
}

function saveFile() {
    if (!state.isEditing || !model) return;
    flushPreviewEdits();
    send({ cmd: 'save', content: model.getValue() });
}

// ------------------------------------------------------------------ search

function doFind(req) {
    if (!editor || !model || !req.text) return;
    var sel = editor.getSelection();
    var from = req.first
        ? { lineNumber: 1, column: 1 }
        : (req.backwards ? sel.getStartPosition() : sel.getEndPosition());

    var match = req.backwards
        ? model.findPreviousMatch(req.text, from, false, !!req.matchCase, req.wholeWords ? ' \t\n(),;<>/' : null, false)
        : model.findNextMatch(req.text, from, false, !!req.matchCase, req.wholeWords ? ' \t\n(),;<>/' : null, false);

    if (!match) return;
    editor.setSelection(match.range);
    editor.revealRangeInCenterIfOutsideViewport(match.range);
    editor.focus();
}

// ----------------------------------------------------------------- preview
// Markdown/HTML: editor on the left, rendered page on the right. Scroll is
// mapped via source-line anchors (markdown) or height ratio (html). Typing
// refreshes the right pane without hiding the source.

var markedLoading = null;
var turndownLoading = null;
var previewTimer = null;
var previewSyncLock = 0;     // 1 = driven by editor, 2 = driven by preview
var previewScrollWired = false;
var applyingFromPreview = false;
var previewInputTimer = null;
var highlightSyncLock = 0;   // 1 = driven by editor, 2 = driven by preview
var revealHlTimer = null;

function loadScriptNoAmd(url) {
    return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = url;
        var amd = (typeof define === 'function' && define.amd) ? define.amd : null;
        if (amd) define.amd = null;
        var done = function () {
            if (amd && typeof define === 'function') define.amd = amd;
            resolve();
        };
        s.onload = s.onerror = done;
        document.head.appendChild(s);
    });
}

function loadMarked() {
    if (window.marked) return Promise.resolve();
    if (!markedLoading) markedLoading = loadScriptNoAmd(MARKED_URL);
    return markedLoading;
}

function loadTurndown() {
    if (window.TurndownService) return Promise.resolve();
    if (!turndownLoading) turndownLoading = loadScriptNoAmd(TURNDOWN_URL);
    return turndownLoading;
}

function loadPreviewDeps() {
    if (state.language !== 'markdown') return Promise.resolve();
    return Promise.all([loadMarked(), loadTurndown()]);
}

function countNewlines(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
}

function tokenEndLine(start, raw) {
    if (!raw) return start;
    var n = countNewlines(raw);
    if (!n) return start;
    return (raw.charCodeAt(raw.length - 1) === 10) ? start + n - 1 : start + n;
}

function renderMarkdown(src) {
    try {
        if (window.marked) {
            if (marked.setOptions) marked.setOptions({ gfm: true, breaks: false });
            if (typeof marked.lexer === 'function' && typeof marked.parser === 'function') {
                var tokens = marked.lexer(src);
                var line = 1;
                var html = [];
                for (var i = 0; i < tokens.length; i++) {
                    var t = tokens[i];
                    var start = line;
                    var end = tokenEndLine(start, t.raw);
                    if (t.raw) line += countNewlines(t.raw);
                    if (t.type === 'space' || t.type === 'def') continue;
                    var one = [t];
                    if (tokens.links) one.links = tokens.links;
                    html.push('<div class="md-block" data-line="' + start + '" data-end="' + end + '">'
                        + marked.parser(one) + '</div>');
                }
                return html.join('');
            }
            return marked.parse(src);
        }
    } catch (e) { /* fall through to plain text */ }
    return '<pre>' + esc(src) + '</pre>';
}

function previewCss() {
    var dk = state.isDark;
    return 'html{position:relative;margin:0;padding:0;background:'
         + (dk ? '#1e1e1e' : '#ffffff') + '}'
         + 'body{margin:0;padding:16px 22px 48px;background:'
         + (dk ? '#1e1e1e' : '#ffffff') + ';color:' + (dk ? '#d4d4d4' : '#24292e') + ';'
         + 'font-family:Segoe UI,Arial,sans-serif;line-height:1.6}'
         + '.md-block{scroll-margin-top:8px}'
         + '.md-block.md-hl-line{background:' + (dk ? 'rgba(55,148,255,0.12)' : 'rgba(0,120,212,0.10)') + ';border-radius:4px}'
         + '.md-block.md-hl-sel{background:' + (dk ? 'rgba(38,79,120,0.42)' : 'rgba(255,232,119,0.50)') + ';border-radius:4px}'
         + '#md-sync-hl{position:absolute;left:0;right:0;pointer-events:none;z-index:5;box-sizing:border-box;'
         + 'border-left:3px solid ' + (dk ? '#3794ff' : '#0078d4') + ';'
         + 'background:' + (dk ? 'rgba(55,148,255,0.14)' : 'rgba(0,120,212,0.12)') + '}'
         + '#md-sync-hl.md-sync-sel{border-left-color:' + (dk ? '#4fc1ff' : '#c9a227') + ';'
         + 'background:' + (dk ? 'rgba(38,79,120,0.48)' : 'rgba(255,232,119,0.42)') + '}'
         + '::selection{background:' + (dk ? '#264F78' : '#ffe877') + '}'
         + '::highlight(md-sel){background:' + (dk ? 'rgba(38,79,120,0.85)' : 'rgba(255,232,119,0.9)') + '}'
         + '[contenteditable="true"]{outline:none;caret-color:' + (dk ? '#d4d4d4' : '#24292e') + ';min-height:70vh;cursor:text}'
         + '[contenteditable="true"]:focus{box-shadow:none}'
         + 'pre{background:' + (dk ? '#2d2d2d' : '#f6f8fa') + ';padding:12px;border-radius:4px;overflow:auto;max-width:100%}'
         + 'code{font-family:Consolas,monospace;background:' + (dk ? '#2d2d2d' : '#f6f8fa') + ';padding:2px 4px;border-radius:3px}'
         + 'pre code{background:none;padding:0}'
         + 'h1,h2,h3{border-bottom:1px solid ' + (dk ? '#333' : '#eaecef') + ';padding-bottom:6px}'
         + 'h1:first-child,h2:first-child,h3:first-child{margin-top:0}'
         + 'a{color:' + (dk ? '#58a6ff' : '#0366d6') + '}'
         + 'table{border-collapse:collapse;max-width:100%}'
         + 'td,th{border:1px solid ' + (dk ? '#444' : '#ddd') + ';padding:4px 8px;overflow-wrap:anywhere}'
         + 'img{max-width:100%;height:auto}'
         + 'blockquote{border-left:4px solid ' + (dk ? '#444' : '#dfe2e5') + ';margin:0;padding:0 12px;color:' + (dk ? '#9e9e9e' : '#6a737d') + '}'
         + 'hr{border:none;border-top:1px solid ' + (dk ? '#333' : '#eaecef') + '}';
}

function buildPreviewDoc() {
    var content = model.getValue();
    if (state.language === 'html') return content;
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + previewCss()
         + '</style></head><body><div id="md-root">' + renderMarkdown(content) + '</div></body></html>';
}

function previewFrame() { return document.getElementById('preview'); }

function previewWin() {
    var f = previewFrame();
    return (f && f.contentWindow) ? f.contentWindow : null;
}

function applyPreviewTheme() {
    if (!state.previewMode || state.language !== 'markdown') return;
    var doc = previewFrame().contentDocument;
    if (!doc) return;
    var st = doc.querySelector('style');
    if (st) st.textContent = previewCss();
}

function schedulePreviewRefresh() {
    if (!state.previewMode || !model || applyingFromPreview) return;
    if (previewHasFocus()) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
        previewTimer = null;
        if (previewHasFocus()) return;
        refreshPreviewContent();
        applyPreviewEditable();
        syncPreviewFromEditor();
        syncHighlightFromEditor();
    }, 120);
}

function refreshPreviewContent() {
    if (!state.previewMode || !model) return;
    var frame = previewFrame();
    var doc = frame.contentDocument;
    if (state.language === 'markdown' && doc) {
        var root = doc.getElementById('md-root');
        if (root) {
            root.innerHTML = renderMarkdown(model.getValue());
            return;
        }
    }
    frame.srcdoc = buildPreviewDoc();
}

function setPreviewMode(on) {
    var frame = previewFrame();
    var editorEl = document.getElementById('editor');
    var handle = document.getElementById('preview-handle');
    var btn = document.getElementById('btn-preview');
    var apply = function () {
        state.previewMode = on;
        if (on) {
            editorEl.style.display = '';
            handle.style.display = 'block';
            frame.style.display = 'block';
            btn.classList.add('active');
            btn.title = 'Скрыть превью';
            frame.srcdoc = buildPreviewDoc();
            if (editor) editor.layout();
            applyPreviewEditable();
        } else {
            if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
            handle.style.display = 'none';
            frame.style.display = 'none';
            frame.removeAttribute('srcdoc');
            editorEl.style.display = '';
            editorEl.style.flex = '1';
            editorEl.style.width = '';
            btn.classList.remove('active');
            btn.title = 'Исходник и просмотр';
            if (editor) editor.layout();
        }
    };
    if (on && (state.language === 'markdown' || state.language === 'html'))
        loadPreviewDeps().then(apply);
    else apply();
}

function previewAnchors(win) {
    var doc = win.document;
    var els = doc.querySelectorAll('.md-block[data-line]');
    var a = [];
    for (var i = 0; i < els.length; i++) {
        var line = parseInt(els[i].getAttribute('data-line'), 10);
        if (!line) continue;
        a.push({ line: line, top: els[i].getBoundingClientRect().top + win.pageYOffset });
    }
    return a;
}

function editorLineFrac() {
    if (!editor || !model) return 1;
    var top = editor.getScrollTop();
    var lo = 1, hi = model.getLineCount();
    while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (editor.getTopForLineNumber(mid) <= top) lo = mid;
        else hi = mid - 1;
    }
    var a = editor.getTopForLineNumber(lo);
    var b = (lo < model.getLineCount())
        ? editor.getTopForLineNumber(lo + 1)
        : a + editor.getOption(monaco.editor.EditorOption.lineHeight);
    var frac = (b > a) ? (top - a) / (b - a) : 0;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return lo + frac;
}

function setEditorLineFrac(lineFrac) {
    if (!editor || !model) return;
    var last = model.getLineCount();
    var line = Math.floor(lineFrac);
    var frac = lineFrac - line;
    if (line < 1) { editor.setScrollTop(0); return; }
    if (line >= last) {
        var topLast = editor.getTopForLineNumber(last);
        var lh = editor.getOption(monaco.editor.EditorOption.lineHeight);
        editor.setScrollTop(topLast + frac * lh);
        return;
    }
    var a = editor.getTopForLineNumber(line);
    var b = editor.getTopForLineNumber(line + 1);
    editor.setScrollTop(a + frac * (b - a));
}

function mapLineToPreviewY(lineFrac, anchors, previewMax, lastLine) {
    if (!anchors.length) return null;
    if (lineFrac <= anchors[0].line) {
        var first = anchors[0].line;
        return first > 1 ? (lineFrac / first) * anchors[0].top : anchors[0].top;
    }
    for (var i = 0; i < anchors.length - 1; i++) {
        if (lineFrac < anchors[i + 1].line) {
            var span = anchors[i + 1].line - anchors[i].line;
            var t = span ? (lineFrac - anchors[i].line) / span : 0;
            return anchors[i].top + t * (anchors[i + 1].top - anchors[i].top);
        }
    }
    var last = anchors[anchors.length - 1];
    if (lastLine <= last.line) return last.top;
    var tEnd = (lineFrac - last.line) / (lastLine - last.line);
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.top + tEnd * Math.max(0, previewMax - last.top);
}

function mapPreviewYToLine(y, anchors, previewMax, lastLine) {
    if (!anchors.length) return null;
    if (y <= anchors[0].top) {
        var first = anchors[0].line;
        return first > 1 && anchors[0].top > 0 ? (y / anchors[0].top) * first : 1;
    }
    for (var i = 0; i < anchors.length - 1; i++) {
        if (y < anchors[i + 1].top) {
            var spanY = anchors[i + 1].top - anchors[i].top;
            var t = spanY ? (y - anchors[i].top) / spanY : 0;
            return anchors[i].line + t * (anchors[i + 1].line - anchors[i].line);
        }
    }
    var last = anchors[anchors.length - 1];
    var rest = previewMax - last.top;
    if (rest <= 0 || lastLine <= last.line) return last.line;
    var tEnd = (y - last.top) / rest;
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.line + tEnd * (lastLine - last.line);
}

function previewScrollMax(win) {
    var se = win.document.scrollingElement || win.document.documentElement;
    return Math.max(0, se.scrollHeight - win.innerHeight);
}

function syncByRatio(fromEditor) {
    if (!editor) return;
    var win = previewWin();
    if (!win) return;
    var edMax = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height);
    var pvMax = Math.max(1, previewScrollMax(win));
    if (fromEditor) win.scrollTo(0, (editor.getScrollTop() / edMax) * pvMax);
    else editor.setScrollTop((win.pageYOffset / pvMax) * edMax);
}

function syncPreviewFromEditor() {
    if (!state.previewMode || !editor) return;
    var win = previewWin();
    if (!win || !win.document) return;
    previewSyncLock = 1;
    var anchors = previewAnchors(win);
    if (anchors.length) {
        var y = mapLineToPreviewY(editorLineFrac(), anchors, previewScrollMax(win), model.getLineCount());
        if (y != null) win.scrollTo(0, y);
    } else {
        syncByRatio(true);
    }
    requestAnimationFrame(function () { if (previewSyncLock === 1) previewSyncLock = 0; });
}

function syncEditorFromPreview() {
    if (!state.previewMode || !editor) return;
    var win = previewWin();
    if (!win || !win.document) return;
    previewSyncLock = 2;
    var anchors = previewAnchors(win);
    if (anchors.length) {
        var lineFrac = mapPreviewYToLine(win.pageYOffset, anchors, previewScrollMax(win), model.getLineCount());
        if (lineFrac != null) setEditorLineFrac(lineFrac);
    } else {
        syncByRatio(false);
    }
    requestAnimationFrame(function () { if (previewSyncLock === 2) previewSyncLock = 0; });
}

function onPreviewScroll() {
    if (!state.previewMode || previewSyncLock === 1) return;
    syncEditorFromPreview();
}

function mdPreviewOn() {
    return !!(state.previewMode && state.language === 'markdown' && editor && model);
}

function clampLine(n) {
    var last = model.getLineCount();
    n = Math.round(n);
    if (n < 1) return 1;
    if (n > last) return last;
    return n;
}

function posToLineFrac(pos) {
    var maxCol = model.getLineMaxColumn(pos.lineNumber);
    var len = Math.max(1, maxCol - 1);
    var col = pos.column - 1;
    if (col < 0) col = 0;
    if (col > len) col = len;
    return pos.lineNumber + col / len;
}

function editorSelSpan() {
    var sel = editor.getSelection();
    if (!sel) {
        var p = editor.getPosition();
        var ln = p ? p.lineNumber : 1;
        return { startLine: ln, endLine: ln, yStart: ln, yEnd: ln + 1, isSel: false };
    }
    var a = sel.getStartPosition();
    var b = sel.getEndPosition();
    if (sel.isEmpty()) {
        return { startLine: a.lineNumber, endLine: a.lineNumber, yStart: a.lineNumber, yEnd: a.lineNumber + 1, isSel: false };
    }
    var endLine = b.lineNumber;
    if (b.column === 1 && endLine > a.lineNumber) endLine--;
    return {
        startLine: a.lineNumber,
        endLine: endLine,
        yStart: posToLineFrac(a),
        yEnd: posToLineFrac(b),
        isSel: true
    };
}

function mdBlockLineRange(el, nextEl, lastLine) {
    var start = parseInt(el.getAttribute('data-line'), 10) || 1;
    var endAttr = el.getAttribute('data-end');
    var end;
    if (endAttr) end = parseInt(endAttr, 10);
    else if (nextEl) end = (parseInt(nextEl.getAttribute('data-line'), 10) || start) - 1;
    else end = lastLine || start;
    if (!(end >= start)) end = start;
    return { start: start, end: end };
}

function closestMdBlock(node) {
    while (node && node.nodeType !== 1) node = node.parentNode;
    if (!node || !node.closest) return null;
    return node.closest('.md-block');
}

function previewAnchorBoxes(win) {
    var doc = win.document;
    var els = doc.querySelectorAll('.md-block[data-line]');
    var a = [];
    for (var i = 0; i < els.length; i++) {
        var line = parseInt(els[i].getAttribute('data-line'), 10);
        if (!line) continue;
        var r = els[i].getBoundingClientRect();
        a.push({
            line: line,
            top: r.top + win.pageYOffset,
            bottom: r.bottom + win.pageYOffset
        });
    }
    return a;
}

function mapLineToPreviewDocY(lineFrac, boxes, lastLine) {
    if (!boxes.length) return null;
    if (lineFrac <= boxes[0].line) return boxes[0].top;
    for (var i = 0; i < boxes.length - 1; i++) {
        if (lineFrac < boxes[i + 1].line) {
            var span = boxes[i + 1].line - boxes[i].line;
            var t = span ? (lineFrac - boxes[i].line) / span : 0;
            return boxes[i].top + t * (boxes[i + 1].top - boxes[i].top);
        }
    }
    var last = boxes[boxes.length - 1];
    var spanEnd = Math.max(1, lastLine + 1 - last.line);
    var tEnd = (lineFrac - last.line) / spanEnd;
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.top + tEnd * Math.max(0, last.bottom - last.top);
}

function mapPreviewDocYToLine(y, boxes, lastLine) {
    if (!boxes.length) return null;
    if (y <= boxes[0].top) return boxes[0].line;
    for (var i = 0; i < boxes.length - 1; i++) {
        if (y < boxes[i + 1].top) {
            var spanY = boxes[i + 1].top - boxes[i].top;
            var t = spanY ? (y - boxes[i].top) / spanY : 0;
            return boxes[i].line + t * (boxes[i + 1].line - boxes[i].line);
        }
    }
    var last = boxes[boxes.length - 1];
    var spanY = Math.max(1, last.bottom - last.top);
    var tEnd = (y - last.top) / spanY;
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.line + tEnd * Math.max(0, lastLine + 1 - last.line);
}

function ensurePreviewOverlay(doc) {
    var el = doc.getElementById('md-sync-hl');
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'md-sync-hl';
    doc.documentElement.appendChild(el);
    return el;
}

function clearPreviewBlockHl(doc) {
    var els = doc.querySelectorAll('.md-block.md-hl-line,.md-block.md-hl-sel');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('md-hl-line', 'md-hl-sel');
}

function applyPreviewBlockHl(doc, startLine, endLine, isSel) {
    var els = doc.querySelectorAll('.md-block[data-line]');
    var lastLine = model.getLineCount();
    var cls = isSel ? 'md-hl-sel' : 'md-hl-line';
    for (var i = 0; i < els.length; i++) {
        var range = mdBlockLineRange(els[i], els[i + 1], lastLine);
        if (range.start <= endLine && range.end >= startLine) els[i].classList.add(cls);
    }
}

function stripMdLight(s) {
    return String(s || '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/[*_~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function findTextRangeInRoot(doc, root, needle) {
    if (!root || !needle) return null;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var parts = [], acc = '', node;
    while ((node = walker.nextNode())) {
        parts.push({ node: node, start: acc.length });
        acc += node.nodeValue;
    }
    if (!parts.length) return null;
    var idx = acc.indexOf(needle);
    if (idx < 0) return null;
    var endIdx = idx + needle.length;
    function at(off) {
        for (var i = 0; i < parts.length; i++) {
            var len = parts[i].node.nodeValue.length;
            var next = parts[i].start + len;
            if (off < next || i === parts.length - 1)
                return { node: parts[i].node, offset: Math.max(0, Math.min(len, off - parts[i].start)) };
        }
        var last = parts[parts.length - 1];
        return { node: last.node, offset: last.node.nodeValue.length };
    }
    var a = at(idx);
    var b = at(endIdx);
    var range = doc.createRange();
    try {
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
    } catch (e) { return null; }
    return range;
}

function applyPreviewTextHighlight(win, doc, span) {
    if (!win.CSS || !win.CSS.highlights || typeof win.Highlight !== 'function') return;
    try { win.CSS.highlights.delete('md-sel'); } catch (e) { /* ignore */ }
    if (!span.isSel) return;
    var raw = model.getValueInRange(editor.getSelection());
    var needle = stripMdLight(raw);
    if (needle.length < 2) return;
    var root = doc.getElementById('md-root') || doc.body;
    var range = findTextRangeInRoot(doc, root, needle);
    if (!range && raw.indexOf('\n') >= 0)
        range = findTextRangeInRoot(doc, root, stripMdLight(raw.split('\n')[0]));
    if (!range) return;
    try { win.CSS.highlights.set('md-sel', new win.Highlight(range)); } catch (e) { /* ignore */ }
}

function revealPreviewRange(win, y1, y2) {
    var viewTop = win.pageYOffset;
    var viewH = win.innerHeight;
    var viewBot = viewTop + viewH;
    if (y1 >= viewTop + 8 && y2 <= viewBot - 8) return;
    previewSyncLock = 1;
    var pad = 16;
    if (y2 - y1 >= viewH) win.scrollTo(0, Math.max(0, y1 - pad));
    else if (y1 < viewTop) win.scrollTo(0, Math.max(0, y1 - pad));
    else win.scrollTo(0, Math.max(0, y2 - viewH + pad));
    requestAnimationFrame(function () { if (previewSyncLock === 1) previewSyncLock = 0; });
}

function coveringBox(boxes, line, lastLine) {
    for (var i = 0; i < boxes.length; i++) {
        var end = (i + 1 < boxes.length) ? boxes[i + 1].line : lastLine + 1;
        if (line >= boxes[i].line && line < end) return boxes[i];
    }
    return boxes.length ? boxes[boxes.length - 1] : null;
}

function syncHighlightFromEditor() {
    if (!mdPreviewOn()) return;
    var win = previewWin();
    var doc = win && win.document;
    if (!doc) return;
    var span = editorSelSpan();
    var overlay = ensurePreviewOverlay(doc);
    var boxes = previewAnchorBoxes(win);
    var lastLine = model.getLineCount();
    var y1 = mapLineToPreviewDocY(span.yStart, boxes, lastLine);
    var y2 = mapLineToPreviewDocY(span.yEnd, boxes, lastLine);
    if (!span.isSel) {
        var box = coveringBox(boxes, span.startLine, lastLine);
        if (box) { y1 = box.top; y2 = box.bottom; }
    }
    if (y1 == null || y2 == null) {
        overlay.style.display = 'none';
        clearPreviewBlockHl(doc);
        return;
    }
    if (y2 < y1) { var tmp = y1; y1 = y2; y2 = tmp; }
    var h = y2 - y1;
    if (h < 10) h = 10;
    overlay.style.display = 'block';
    overlay.style.top = y1 + 'px';
    overlay.style.height = h + 'px';
    overlay.className = span.isSel ? 'md-sync-sel' : '';
    overlay.id = 'md-sync-hl';
    clearPreviewBlockHl(doc);
    applyPreviewBlockHl(doc, span.startLine, span.endLine, span.isSel);
    applyPreviewTextHighlight(win, doc, span);
    if (highlightSyncLock === 2) return;
    if (revealHlTimer) clearTimeout(revealHlTimer);
    revealHlTimer = setTimeout(function () {
        revealHlTimer = null;
        if (!mdPreviewOn() || highlightSyncLock === 2) return;
        var w = previewWin();
        if (w) revealPreviewRange(w, y1, y2);
    }, 0);
}

function pickMatchNear(text, fromLine, toLine) {
    if (!text || text.length < 2 || text.length > 800 || !model.findMatches) return null;
    var matches = model.findMatches(text, true, false, false, null, false, 24);
    if (!matches || !matches.length) return null;
    var best = null, bestDist = 1e9;
    for (var i = 0; i < matches.length; i++) {
        var ln = matches[i].range.startLineNumber;
        if (ln >= fromLine && ln <= toLine) return matches[i].range;
        var dist = ln < fromLine ? fromLine - ln : ln - toLine;
        if (dist < bestDist) { bestDist = dist; best = matches[i].range; }
    }
    return (best && bestDist <= 12) ? best : null;
}

function previewSelectionInfo(win) {
    var doc = win.document;
    var sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    var info = {
        collapsed: sel.isCollapsed,
        text: (sel.toString() || '').replace(/\s+/g, ' ').trim(),
        startLine: 0,
        endLine: 0,
        yTop: null,
        yBot: null
    };
    var rects = range.getClientRects();
    if (rects && rects.length) {
        info.yTop = rects[0].top + win.pageYOffset;
        info.yBot = rects[rects.length - 1].bottom + win.pageYOffset;
    } else {
        var br = range.getBoundingClientRect();
        if (br && (br.height || br.width || br.top)) {
            info.yTop = br.top + win.pageYOffset;
            info.yBot = br.bottom + win.pageYOffset;
        }
    }
    var startBlock = closestMdBlock(range.startContainer);
    var endBlock = closestMdBlock(range.endContainer);
    var lastLine = model.getLineCount();
    if (startBlock) {
        var sr = mdBlockLineRange(startBlock, startBlock.nextElementSibling, lastLine);
        info.startLine = sr.start;
    }
    if (endBlock) {
        var er = mdBlockLineRange(endBlock, endBlock.nextElementSibling, lastLine);
        info.endLine = er.end;
    } else if (startBlock) {
        info.endLine = info.startLine;
    }
    return info;
}

function syncEditorFromPreviewSelection() {
    if (!mdPreviewOn() || highlightSyncLock === 1 || applyingFromPreview) return;
    var win = previewWin();
    if (!win || !win.document) return;
    var info = previewSelectionInfo(win);
    if (!info) return;
    if (!info.startLine && info.yTop == null) return;
    var boxes = previewAnchorBoxes(win);
    var lastLine = model.getLineCount();
    var startLine = info.startLine || 1;
    var endLine = info.endLine || startLine;
    if (info.yTop != null && boxes.length) {
        startLine = clampLine(mapPreviewDocYToLine(info.yTop, boxes, lastLine));
        endLine = clampLine(mapPreviewDocYToLine(info.yBot != null ? info.yBot : info.yTop, boxes, lastLine));
    }
    if (endLine < startLine) { var t = startLine; startLine = endLine; endLine = t; }

    highlightSyncLock = 2;
    previewSyncLock = 2;
    var match = (!info.collapsed && info.text) ? pickMatchNear(info.text, startLine, endLine) : null;
    if (match) {
        editor.setSelection(match);
        editor.revealRangeInCenterIfOutsideViewport(match);
    } else if (info.collapsed) {
        editor.setPosition({ lineNumber: startLine, column: 1 });
        editor.revealLineInCenterIfOutsideViewport(startLine);
    } else {
        editor.setSelection({
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: endLine,
            endColumn: model.getLineMaxColumn(endLine)
        });
        editor.revealRangeInCenterIfOutsideViewport({
            startLineNumber: startLine, startColumn: 1,
            endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine)
        });
    }
    syncHighlightFromEditor();
    requestAnimationFrame(function () {
        if (highlightSyncLock === 2) highlightSyncLock = 0;
        if (previewSyncLock === 2) previewSyncLock = 0;
    });
}

function previewHasFocus() {
    var doc = previewFrame() && previewFrame().contentDocument;
    return !!(doc && doc.hasFocus && doc.hasFocus());
}

function previewEditRoot(doc) {
    if (!doc) return null;
    return doc.getElementById('md-root') || doc.body;
}

function applyPreviewEditable() {
    if (!state.previewMode) return;
    var doc = previewFrame() && previewFrame().contentDocument;
    var root = previewEditRoot(doc);
    if (!root) return;
    var on = !!state.isEditing;
    root.contentEditable = on ? 'true' : 'false';
    root.spellcheck = on;
}

function focusPreview() {
    var doc = previewFrame() && previewFrame().contentDocument;
    var root = previewEditRoot(doc);
    if (!root) return;
    root.focus();
    try {
        var sel = doc.getSelection();
        if (sel && sel.rangeCount === 0) {
            var range = doc.createRange();
            range.selectNodeContents(root);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    } catch (e) { /* ignore */ }
}

function htmlTableToMarkdown(table) {
    var trs = table.querySelectorAll('tr');
    if (!trs.length) return '';
    var rows = [];
    for (var i = 0; i < trs.length; i++) {
        var cells = trs[i].querySelectorAll('th,td');
        var cols = [];
        for (var j = 0; j < cells.length; j++)
            cols.push(cells[j].textContent.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
        if (cols.length) rows.push(cols);
    }
    if (!rows.length) return '';
    var n = rows[0].length;
    var lines = ['| ' + rows[0].join(' | ') + ' |'];
    var sep = [];
    for (var k = 0; k < n; k++) sep.push('---');
    lines.push('| ' + sep.join(' | ') + ' |');
    for (var r = 1; r < rows.length; r++) lines.push('| ' + rows[r].join(' | ') + ' |');
    return lines.join('\n');
}

function getTurndown() {
    if (!window.TurndownService) return null;
    if (getTurndown._svc) return getTurndown._svc;
    var td = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**'
    });
    td.addRule('mdBlock', {
        filter: function (node) {
            return node.nodeName === 'DIV' && node.classList && node.classList.contains('md-block');
        },
        replacement: function (content) { return content + '\n\n'; }
    });
    td.addRule('table', {
        filter: 'table',
        replacement: function (content, node) { return '\n\n' + htmlTableToMarkdown(node) + '\n\n'; }
    });
    getTurndown._svc = td;
    return td;
}

function serializeHtmlDoc(doc) {
    var html = doc.documentElement ? doc.documentElement.outerHTML : (doc.body ? doc.body.innerHTML : '');
    if (doc.doctype) html = '<!DOCTYPE ' + doc.doctype.name + '>\n' + html;
    return html;
}

function writeSourceFromPreview() {
    if (!state.isEditing || !state.previewMode || !model) return;
    var doc = previewFrame() && previewFrame().contentDocument;
    var root = previewEditRoot(doc);
    if (!root) return;
    var text;
    if (state.language === 'html') {
        text = serializeHtmlDoc(doc);
    } else {
        var td = getTurndown();
        if (!td) return;
        text = td.turndown(root)
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^(\s*)- {2,}/gm, '$1- ')
            .replace(/^(\s*)(\d+)\. {2,}/gm, '$1$2. ');
        if (text) text = text.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
    }
    if (text === model.getValue()) return;
    applyingFromPreview = true;
    var scroll = editor ? editor.getScrollTop() : 0;
    model.setValue(text);
    if (editor) editor.setScrollTop(scroll);
    applyingFromPreview = false;
    state.dirty = true;
    updateStatusBar();
}

function onPreviewInput() {
    if (!state.isEditing) return;
    if (previewInputTimer) clearTimeout(previewInputTimer);
    previewInputTimer = setTimeout(function () {
        previewInputTimer = null;
        writeSourceFromPreview();
    }, 140);
}

function onPreviewKeydown(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var key = (e.key || '').toLowerCase();
    var doc = previewFrame() && previewFrame().contentDocument;
    if (key === 's') {
        e.preventDefault();
        saveFile();
    } else if (key === 'e') {
        e.preventDefault();
        toggleEdit();
    } else if (state.isEditing && doc && (key === 'b' || key === 'i')) {
        e.preventDefault();
        try { doc.execCommand(key === 'b' ? 'bold' : 'italic'); } catch (err) { /* ignore */ }
        onPreviewInput();
    }
}

function onPreviewClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) e.preventDefault();
    if (!mdPreviewOn()) return;
    syncEditorFromPreviewSelection();
}

function onPreviewSelectionChange() {
    if (!mdPreviewOn() || highlightSyncLock === 1) return;
    if (!previewHasFocus()) return;
    syncEditorFromPreviewSelection();
}

function bindPreviewEditing(win) {
    var doc = win && win.document;
    if (!doc || doc.__bslEditBound) return;
    doc.__bslEditBound = true;
    doc.addEventListener('input', onPreviewInput);
    doc.addEventListener('keydown', onPreviewKeydown);
    doc.addEventListener('click', onPreviewClick);
    doc.addEventListener('selectionchange', onPreviewSelectionChange);
    applyPreviewEditable();
}

function wirePreviewScroll() {
    if (previewScrollWired || !editor) return;
    previewScrollWired = true;
    editor.onDidScrollChange(function () {
        if (!state.previewMode || previewSyncLock === 2) return;
        syncPreviewFromEditor();
    });
}

// --------------------------------------------------------------------- PDF

function preparePrintContent() {
    var root = document.getElementById('print-root');
    var content = model.getValue();
    if (state.previewMode && state.language === 'markdown') {
        root.innerHTML = '<div class="md-body">' + renderMarkdown(content) + '</div>';
    } else if (state.previewMode && state.language === 'html') {
        root.innerHTML = '<div class="md-body">' + content + '</div>';
    } else {
        root.innerHTML = '<pre>' + esc(content) + '</pre>';
    }
}

function clearPrintContent() {
    document.getElementById('print-root').innerHTML = '';
}

// ------------------------------------------------------- one-time UI wiring

function wireUi() {
    document.getElementById('outline-list').addEventListener('click', function (e) {
        var el = e.target.closest('.proc-item');
        if (!el) return;
        var ln = parseInt(el.getAttribute('data-line'), 10);
        editor.revealLineInCenter(ln);
        editor.setPosition({ lineNumber: ln, column: 1 });
        editor.focus();
    });

    document.getElementById('outline-filter').addEventListener('input', applyFilter);
    document.getElementById('filter-clear').addEventListener('click', function () {
        var fi = document.getElementById('outline-filter');
        fi.value = '';
        applyFilter();
        fi.focus();
    });
    document.getElementById('sort-btn').addEventListener('click', function () {
        state.sortByName = !state.sortByName;
        renderOutline();
    });

    document.getElementById('outline-toggle').addEventListener('click', function () {
        var p = document.getElementById('outline-panel');
        p.style.display = (p.style.display === 'none') ? 'flex' : 'none';
        editor.layout();
    });

    document.getElementById('btn-theme').addEventListener('click', function () {
        state.isDark = !state.isDark;
        applyTheme();
    });
    document.getElementById('btn-edit').addEventListener('click', toggleEdit);
    document.getElementById('btn-save').addEventListener('click', saveFile);
    document.getElementById('save-prompt-yes').addEventListener('click', onSavePromptYes);
    document.getElementById('save-prompt-no').addEventListener('click', onSavePromptNo);
    document.getElementById('save-prompt-cancel').addEventListener('click', onSavePromptCancel);
    document.addEventListener('keydown', function (e) {
        if (!savePromptOpen()) return;
        if (e.key === 'Escape') { e.preventDefault(); onSavePromptCancel(); }
        else if (e.key === 'Enter') { e.preventDefault(); onSavePromptYes(); }
    });
    document.getElementById('btn-preview').addEventListener('click', function () { setPreviewMode(!state.previewMode); });
    document.getElementById('btn-pdf').addEventListener('click', function () {
        preparePrintContent();
        send({ cmd: 'pdf' });
    });

    document.getElementById('preview').addEventListener('load', function () {
        if (!state.previewMode) return;
        var win = previewWin();
        if (!win) return;
        win.addEventListener('scroll', onPreviewScroll, { passive: true });
        bindPreviewEditing(win);
        syncPreviewFromEditor();
        syncHighlightFromEditor();
    });

    var handle = document.getElementById('resize-handle');
    var panel = document.getElementById('outline-panel');
    var startX = 0, startW = 0;
    function onResize(e) {
        var w = startW - (e.clientX - startX);
        w = Math.max(200, Math.min(w, window.innerWidth * 0.6));
        panel.style.width = w + 'px';
        editor.layout();
    }
    function stopResize() {
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', stopResize);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
    handle.addEventListener('mousedown', function (e) {
        startX = e.clientX;
        startW = panel.offsetWidth;
        e.preventDefault();
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', stopResize);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    var splitHandle = document.getElementById('preview-handle');
    var editorEl = document.getElementById('editor');
    var splitStartX = 0, splitStartW = 0;
    function onSplitResize(e) {
        var w = splitStartW + (e.clientX - splitStartX);
        var max = document.getElementById('main').clientWidth - 140;
        w = Math.max(160, Math.min(w, max));
        editorEl.style.flex = 'none';
        editorEl.style.width = w + 'px';
        if (editor) editor.layout();
    }
    function stopSplitResize() {
        document.removeEventListener('mousemove', onSplitResize);
        document.removeEventListener('mouseup', stopSplitResize);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
    splitHandle.addEventListener('mousedown', function (e) {
        splitStartX = e.clientX;
        splitStartW = editorEl.offsetWidth;
        e.preventDefault();
        document.addEventListener('mousemove', onSplitResize);
        document.addEventListener('mouseup', stopSplitResize);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
}

// ------------------------------------------------------------------ startup

function fail(text) {
    var el = document.getElementById('loading');
    el.className = 'error';
    el.textContent = text;
}

/* Announce readiness before Monaco is done so the host can start pushing
 * content while the editor bundle is still being parsed. */
send({ cmd: 'ready' });

var loaderScript = document.createElement('script');
loaderScript.src = VS_BASE + '/loader.js';
loaderScript.onerror = function () {
    fail('Не удалось загрузить Monaco Editor из ' + VS_BASE + '. Переустановите плагин или проверьте подключение к сети.');
};
loaderScript.onload = function () {
    require.config({ paths: { vs: VS_BASE } });
    require(['vs/editor/editor.main'], function () {
        defineBsl(monaco);
        wireUi();
        monacoReady = true;
        if (pending) {
            var p = pending; pending = null; applyLoad(p);
        } else {
            /* Build the editor while parked/idle so the first F3 is a model
             * swap, not a cold monaco.editor.create in the Lister window. */
            prewarmEditor();
        }
    });
};
document.head.appendChild(loaderScript);

})();
