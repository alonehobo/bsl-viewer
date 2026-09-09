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
    dirty: false,
    minimap: readStoredBool('bsl.minimap', true),
    bigFile: false,
    previewId: '',
    formSelectedId: '',
    objectMeta: '',
    outlineCollapsed: {}
};
var allItems = [];
var baselineContent = '';
var suppressDirty = false;
var pendingLeaveEdit = false;

function readStoredBool(key, fallback) {
    try {
        var v = localStorage.getItem(key);
        if (v === '0') return false;
        if (v === '1') return true;
    } catch (e) { /* private mode / file:// */ }
    return fallback;
}

function writeStoredBool(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* ignore */ }
}

function isBslModule(lang) { return (lang || state.language) === 'bsl'; }
function isBslFamily(lang) { return isBslModule(lang) || (lang || state.language) === 'bsl_query'; }

/* Preview providers. When one of these claims a file the viewer shows a
 * rendered document instead of source: the outline lists the document's own
 * structure and the preview pane replaces the editor entirely, rather than
 * splitting the window with the markdown/HTML iframe.
 *
 * First match wins, so order matters — a managed form is also valid XML.
 *
 * `parser` and `viewer` are separate on purpose: an .mxl binary is decoded by
 * MxlPreview but drawn by TemplatePreview, because both produce the same
 * spreadsheet model. Adding a format means adding an entry here, not another
 * branch in every function below. */
var PREVIEW_PROVIDERS = [
    {
        id: 'form',
        parser: 'FormPreview',
        viewer: 'FormPreview',
        /* A form mockup stands in for the real 1C application window, so it
         * always renders as light chrome and hides the theme toggle. */
        lightChrome: true,
        /* Its outline is a collapsible element tree, not a flat list. */
        tree: true,
        outlineTitle: 'Элементы формы',
        sourceTitle: 'Показать форму',
        rootCls: 'fp-root',
        emptyCls: 'fp-empty',
        emptyMsg: 'Это не форма 1С (нет корневого Form / logform).',
        detect: function (content) {
            return state.language === 'xml' && FormPreview.detect(content);
        },
        parse: function (content) { return FormPreview.parse(content, state.objectMeta); }
    },
    {
        id: 'mxl',
        parser: 'MxlPreview',
        viewer: 'TemplatePreview',
        outlineTitle: 'Области макета',
        sourceTitle: 'Показать макет',
        rootCls: 'tp-root',
        emptyCls: 'tp-empty',
        emptyMsg: 'Это не макет табличного документа 1С.',
        /* Area ids in a spreadsheet outline are synthesised, so selection also
         * matches on the area name and falls back to a text scan. */
        selectMatchesByName: true,
        selectHighlightsPreview: true,
        detect: function (content) { return MxlPreview.detect(content); },
        parse: function (content) { return MxlPreview.parse(content); }
    },
    {
        id: 'template',
        parser: 'TemplatePreview',
        viewer: 'TemplatePreview',
        outlineTitle: 'Области макета',
        sourceTitle: 'Показать макет',
        rootCls: 'tp-root',
        emptyCls: 'tp-empty',
        emptyMsg: 'Это не макет табличного документа 1С.',
        selectMatchesByName: true,
        selectHighlightsPreview: true,
        detect: function (content) { return TemplatePreview.detect(content); },
        parse: function (content) { return TemplatePreview.parse(content); }
    }
];

/* Usable only once both the module that parses for it and the module that
 * draws it are on the page. */
function providerReady(p) {
    return !!(p && window[p.parser] && window[p.viewer]);
}

function detectProvider(content) {
    for (var i = 0; i < PREVIEW_PROVIDERS.length; i++) {
        var p = PREVIEW_PROVIDERS[i];
        if (providerReady(p) && p.detect(content)) return p;
    }
    return null;
}

function providerById(id) {
    for (var i = 0; i < PREVIEW_PROVIDERS.length; i++) {
        if (PREVIEW_PROVIDERS[i].id === id) return PREVIEW_PROVIDERS[i];
    }
    return null;
}

/* The provider claiming the file currently loaded, or null for plain source. */
function currentProvider() {
    var p = providerById(state.previewId);
    return providerReady(p) ? p : null;
}

/* The module that renders, highlights and outlines for the active provider. */
function previewView() {
    var p = currentProvider();
    return p ? window[p.viewer] : null;
}

function isFormView() { var p = currentProvider(); return !!(p && p.id === 'form'); }

/* True whenever a provider owns the view, i.e. the editor is replaced rather
 * than split with the preview iframe. */
function isDocPreview() { return !!currentProvider(); }

/* True when the outline is a collapsible tree rather than a flat list. */
function docTree() { var p = currentProvider(); return !!(p && p.tree); }

/* Only a real 1C form mockup must always render as light UI chrome (it stands
 * in for the actual application window). A table-document (template) preview
 * is just a document view, so it follows the user's chosen theme like any
 * other file — it must not silently flip when previewMode toggles. */
function formPreviewOpen() {
    var p = currentProvider();
    return !!(p && p.lightChrome && state.previewMode);
}
function uiIsDark() { return formPreviewOpen() ? false : !!state.isDark; }
function canPreviewLang() {
    return state.language === 'markdown' || state.language === 'html' || isDocPreview();
}
function formPreviewEl() { return document.getElementById('form-preview'); }

var QUERY_WORDS = [
    'ВЫБРАТЬ', 'РАЗРЕШЕННЫЕ', 'РАЗЛИЧНЫЕ', 'ПЕРВЫЕ', 'КАК', 'ПУСТАЯТАБЛИЦА', 'ПОМЕСТИТЬ',
    'ИЗ', 'ВНУТРЕННЕЕ', 'ЛЕВОЕ', 'ВНЕШНЕЕ', 'ПРАВОЕ', 'ПОЛНОЕ', 'СОЕДИНЕНИЕ',
    'ГДЕ', 'СГРУППИРОВАТЬ', 'ПО', 'ИМЕЮЩИЕ', 'ОБЪЕДИНИТЬ', 'ВСЕ', 'УПОРЯДОЧИТЬ',
    'АВТОУПОРЯДОЧИВАНИЕ', 'ИТОГИ', 'ОБЩИЕ', 'ТОЛЬКО', 'ИЕРАРХИЯ', 'ПЕРИОДАМИ', 'ДЛЯ',
    'ИЗМЕНЕНИЯ', 'SELECT', 'ALLOWED', 'DISTINCT', 'TOP', 'AS', 'EMPTYTABLE',
    'INTO', 'FROM', 'INNER', 'LEFT', 'OUTER', 'RIGHT', 'FULL',
    'JOIN', 'ON', 'WHERE', 'GROUP', 'BY', 'HAVING', 'UNION',
    'ALL', 'ORDER', 'AUTOORDER', 'TOTALS', 'OVERALL', 'ONLY', 'HIERARCHY',
    'СГРУППИРОВАНОПО', 'GROUPEDBY', 'БУЛЕВО', 'BOOLEAN', 'ВОЗР', 'ASC',
    'ЗНАЧЕНИЕ', 'VALUE', 'ИНДЕКСИРОВАТЬ', 'INDEX', 'ТИП', 'TYPE', 'ТИПЗНАЧЕНИЯ',
    'VALUETYPE', 'УБЫВ', 'DESC', 'УНИЧТОЖИТЬ', 'DROP',
    'ГРУППИРУЮЩИМ', 'НАБОРАМ', 'GROUPING', 'SETS',
    'ДОБАВИТЬ', 'УНИКАЛЬНО'
];
var QUERY_EXP = [
    'АВТОНОМЕРЗАПИСИ', 'RECORDAUTONUMBER', 'В', 'IN', 'ВЫБОР', 'CASE',
    'ВЫРАЗИТЬ', 'CAST', 'ГОД', 'YEAR', 'ДАТА', 'DATE', 'ДАТАВРЕМЯ',
    'DATETIME', 'ДЕКАДА', 'TENDAYS', 'ДЕНЬ', 'DAY', 'ДЕНЬГОДА',
    'DAYOFYEAR', 'ДЕНЬНЕДЕЛИ', 'WEEKDAY', 'ДОБАВИТЬКДАТЕ', 'DATEADD',
    'ЕСТЬ', 'IS', 'ЕСТЬNULL', 'ISNULL', 'И', 'AND', 'ИЕРАРХИЯ',
    'HIERARCHY', 'ИЛИ', 'OR', 'ИНАЧЕ', 'ELSE', 'ИСТИНА', 'TRUE',
    'КВАРТАЛ', 'QUARTER', 'КОЛИЧЕСТВО', 'COUNT', 'КОНЕЦПЕРИОДА',
    'ENDOFPERIOD', 'КОНЕЦ', 'END', 'ЛОЖЬ', 'FALSE', 'МАКСИМУМ',
    'MAX', 'МЕЖДУ', 'BETWEEN', 'МЕСЯЦ', 'MONTH', 'МИНИМУМ', 'MIN',
    'МИНУТА', 'MINUTE', 'НАЧАЛОПЕРИОДА', 'BEGINOFPERIOD', 'НЕ', 'NOT',
    'НЕДЕЛЯ', 'WEEK', 'НЕОПРЕДЕЛЕНО', 'UNDEFINED', 'ПОДОБНО', 'LIKE',
    'ПОДСТРОКА', 'SUBSTRING', 'ПОЛУГОДИЕ', 'HALFYEAR', 'ПРЕДСТАВЛЕНИЕ',
    'PRESENTATION', 'ПРЕДСТАВЛЕНИЕССЫЛКИ', 'REFPRESENTATION',
    'РАЗНОСТЬДАТ', 'DATEDIFF', 'СЕКУНДА', 'SECOND', 'СПЕЦСИМВОЛ',
    'ESCAPE', 'СРЕДНЕЕ', 'AVG', 'ССЫЛКА', 'REFS', 'СТРОКА', 'STRING',
    'СУММА', 'SUM', 'ТОГДА', 'THEN', 'УБЫВ', 'DESC', 'ЧАС', 'HOUR',
    'ЧИСЛО', 'NUMBER', 'NULL', 'КОГДА', 'WHEN',
    'СОКРЛП', 'TRIMALL', 'СОКРП', 'TRIMAR', 'СОКРЛ', 'TRIMAL',
    'ACOS', 'ASIN', 'ATAN', 'COS', 'EXP', 'LOG', 'LOG10', 'SIN', 'SQRT', 'POW',
    'TAN', 'ОКР', 'ROUND', 'ЦЕЛ', 'INT', 'ДЛИНАСТРОКИ', 'STRINGLENGTH', 'ЛЕВ',
    'LEFT', 'ПРАВ', 'RIGHT', 'СТРНАЙТИ', 'STRFIND', 'ВРЕГ', 'UPPER', 'НРЕГ',
    'LOWER', 'СТРЗАМЕНИТЬ', 'STRREPLACE', 'РАЗМЕРХРАНИМЫХДАННЫХ', 'STOREDDATASIZE',
    'УНИКАЛЬНЫЙИДЕНТИФИКАТОР', 'UUID'
];
var QUERY_THEME_LIGHT = [
    { token: 'query', foreground: '000000' },
    { token: 'query.quote', foreground: '000000' },
    { token: 'query.innerquotes', foreground: 'd38949' },
    { token: 'query.string', foreground: 'df0000' },
    { token: 'query.keyword', foreground: '0000ff' },
    { token: 'query.exp', foreground: 'a50000' },
    { token: 'query.param', foreground: '007b7c' },
    { token: 'query.brackets', foreground: '0000ff' },
    { token: 'query.operator', foreground: '0000ff' },
    { token: 'query.float', foreground: 'ff00ff' },
    { token: 'query.int', foreground: 'ff00ff' },
    { token: 'query.comment', foreground: '008000' }
];
var QUERY_THEME_DARK = [
    { token: 'query', foreground: 'e7db6a' },
    { token: 'query.quote', foreground: 'e7db6a' },
    { token: 'query.innerquotes', foreground: 'd7ba62' },
    { token: 'query.string', foreground: 'ff4242' },
    { token: 'query.keyword', foreground: 'f92472' },
    { token: 'query.exp', foreground: 'a50000' },
    { token: 'query.param', foreground: '007b7c' },
    { token: 'query.brackets', foreground: 'd4d4d4' },
    { token: 'query.operator', foreground: 'd4d4d4' },
    { token: 'query.float', foreground: 'ff00ff' },
    { token: 'query.int', foreground: 'ff00ff' },
    { token: 'query.comment', foreground: '6a9955' }
];
var BSL_SNIPPETS = [
    { label: 'Если', prefix: 'Если', body: 'Если ${1:Условие} Тогда\n\t$0\nКонецЕсли;' },
    { label: 'ЕслиИначе', prefix: 'ЕслиИначе', body: 'Если ${1:Условие} Тогда\n\t$0\nИначе\n\t\nКонецЕсли;' },
    { label: 'Пока', prefix: 'Пока', body: 'Пока ${1:Условие} Цикл\n\t$0\nКонецЦикла;' },
    { label: 'Для', prefix: 'Для', body: 'Для ${1:Счетчик} = ${2:1} По ${3:Ограничение} Цикл\n\t$0\nКонецЦикла;' },
    { label: 'ДляКаждого', prefix: 'ДляКаждого', body: 'Для Каждого ${1:Элемент} Из ${2:Коллекция} Цикл\n\t$0\nКонецЦикла;' },
    { label: 'Процедура', prefix: 'Процедура', body: 'Процедура ${1:ИмяПроцедуры}()\n\t$0\nКонецПроцедуры' },
    { label: 'Функция', prefix: 'Функция', body: 'Функция ${1:ИмяФункции}()\n\t$0\nКонецФункции' },
    { label: 'Попытка', prefix: 'Попытка', body: 'Попытка\n\t$0\nИсключение\n\t\nКонецПопытки;' },
    { label: 'Область', prefix: 'Область', body: '#Область ${1:Имя}\n$0\n#КонецОбласти' },
    { label: 'Возврат', prefix: 'Возврат', body: 'Возврат ${1:Результат};' },
    { label: 'If', prefix: 'If', body: 'If ${1:Condition} Then\n\t$0\nEndIf;' },
    { label: 'While', prefix: 'While', body: 'While ${1:Condition} Do\n\t$0\nEndDo;' },
    { label: 'Procedure', prefix: 'Procedure', body: 'Procedure ${1:Name}()\n\t$0\nEndProcedure' },
    { label: 'Function', prefix: 'Function', body: 'Function ${1:Name}()\n\t$0\nEndFunction' },
    { label: 'Try', prefix: 'Try', body: 'Try\n\t$0\nExcept\n\t\nEndTry;' },
    { label: 'Region', prefix: 'Region', body: '#Region ${1:Name}\n$0\n#EndRegion' }
];
var FOLD_OPEN = {
    'процедура': 'proc', 'procedure': 'proc',
    'функция': 'proc', 'function': 'proc',
    'если': 'if', 'if': 'if',
    '#если': 'ppif', '#if': 'ppif',
    'пока': 'loop', 'while': 'loop', 'для': 'loop', 'for': 'loop',
    'попытка': 'try', 'try': 'try',
    '#область': 'region', '#region': 'region'
};
var FOLD_CLOSE = {
    'конецпроцедуры': 'proc', 'endprocedure': 'proc',
    'конецфункции': 'proc', 'endfunction': 'proc',
    'конецесли': 'if', 'endif': 'if',
    '#конецесли': 'ppif', '#endif': 'ppif',
    'конеццикла': 'loop', 'enddo': 'loop',
    'конецпопытки': 'try', 'endtry': 'try',
    '#конецобласти': 'region', '#endregion': 'region'
};

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
        queryWords: QUERY_WORDS,
        queryExp: QUERY_EXP,
        queryOperators: /[=><+\-*\/%;,]+/,
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
                [/(")(выбрать|select)/, [
                    { token: 'query.quote', next: '@query' },
                    { token: 'query.keyword' }
                ]],
                [/"/, { token: 'string.quote', next: '@string' }],
                [/'[^']*'/, 'date']
            ],
            query: [
                [/\s+/, 'query'],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, {
                    cases: {
                        '@queryWords': 'query.keyword',
                        '@queryExp': 'query.exp',
                        '@default': 'query'
                    }
                }],
                [/&[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'query.param'],
                [/&/, 'query.param'],
                [/("")+/, 'query.innerquotes'],
                [/""[^"]*""/, 'query.string'],
                [/[({})]/, 'query.brackets'],
                [/\/\/.*$/, 'query.comment'],
                [/@queryOperators/, 'query.operator'],
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'query.float'],
                [/\d+/, 'query.int'],
                [/\|/, 'query'],
                [/\./, 'query'],
                [/"/, { token: 'query.quote', next: '@pop' }],
                [/[^"&]/, 'query']
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
        },
        folding: {
            markers: {
                start: new RegExp('^\\s*#\\s*(Область|Region)\\b', 'i'),
                end: new RegExp('^\\s*#\\s*(КонецОбласти|EndRegion)\\b', 'i')
            }
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
        ].concat(QUERY_THEME_LIGHT),
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
        ].concat(QUERY_THEME_DARK),
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

    monaco.languages.registerFoldingRangeProvider('bsl', {
        provideFoldingRanges: function (m) { return foldRangesBsl(m); }
    });
    monaco.languages.registerDefinitionProvider('bsl', {
        provideDefinition: function (m, pos) { return findLocalDefinition(m, pos); }
    });
    monaco.languages.registerCompletionItemProvider('bsl', {
        provideCompletionItems: function (m, pos) { return snippetSuggestions(m, pos); }
    });
    monaco.languages.registerDocumentFormattingEditProvider('bsl', {
        provideDocumentFormattingEdits: function (m) { return formatBsl(m, null); },
        provideDocumentRangeFormattingEdits: function (m, range) { return formatBsl(m, range); }
    });

    defineBslQuery(monaco);
    defineJsonXml(monaco);
}

function defineBslQuery(monaco) {
    monaco.languages.register({ id: 'bsl_query', extensions: ['.sdbl', '.query'], aliases: ['1C Query', 'SDBL'] });
    monaco.languages.setMonarchTokensProvider('bsl_query', {
        ignoreCase: true,
        keywords: QUERY_WORDS,
        expressions: QUERY_EXP,
        operators: /[=><+\-*\/%;,]+/,
        tokenizer: {
            root: [
                [/\/\/.*$/, 'query.comment'],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, {
                    cases: {
                        '@keywords': 'query.keyword',
                        '@expressions': 'query.exp',
                        '@default': 'query'
                    }
                }],
                [/&[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'query.param'],
                [/&/, 'query.param'],
                [/"[^"]*"/, 'query.string'],
                [/[({})]/, 'query.brackets'],
                [/@operators/, 'query.operator'],
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'query.float'],
                [/\d+/, 'query.int'],
                [/[^\s]/, 'query']
            ]
        }
    });
    monaco.languages.setLanguageConfiguration('bsl_query', {
        comments: { lineComment: '//' },
        brackets: [['(', ')'], ['[', ']']],
        autoClosingPairs: [
            { open: '(', close: ')' },
            { open: '[', close: ']' },
            { open: '"', close: '"' }
        ]
    });
    monaco.languages.registerFoldingRangeProvider('bsl_query', {
        provideFoldingRanges: function (m) { return foldRangesQuery(m); }
    });
}

function bslStructureWord(line, inString) {
    if (inString) return '';
    var t = line.replace(/^\s+/, '');
    if (!t || t.indexOf('//') === 0) return '';
    if (t.charAt(0) === '&') return '';
    var hash = false;
    if (t.charAt(0) === '#') {
        hash = true;
        t = t.slice(1).replace(/^\s+/, '');
    }
    var m = t.match(/^([A-Za-z\u0410-\u044F_\u0401\u0451]+)/);
    if (!m) return '';
    var w = m[1].toLowerCase();
    if (w === 'асинх' || w === 'async') {
        var rest = t.slice(m[1].length).replace(/^\s+/, '');
        var m2 = rest.match(/^([A-Za-z\u0410-\u044F_\u0401\u0451]+)/);
        if (m2) w = m2[1].toLowerCase();
    }
    return hash ? ('#' + w) : w;
}

function scanQuoteState(line, inString) {
    var i = 0;
    var queryStart = false;
    if (!inString) {
        var trimmed = line.replace(/^\s+/, '');
        if (trimmed.charAt(0) === '|') {
            /* Continuation of a multiline string is handled by inString from
             * the previous line; a lone pipe at the start of a code line is
             * still a string continuation in 1C. */
        }
    }
    while (i < line.length) {
        var ch = line.charAt(i);
        if (inString) {
            if (ch === '"') {
                if (line.charAt(i + 1) === '"') { i += 2; continue; }
                inString = false;
            }
            i++;
            continue;
        }
        if (ch === '/' && line.charAt(i + 1) === '/') break;
        if (ch === '"') {
            inString = true;
            var rest = line.slice(i + 1).replace(/^\s+/, '');
            if (/^(выбрать|select)\b/i.test(rest)) queryStart = true;
        }
        i++;
    }
    return { inString: inString, queryStart: queryStart };
}

function foldRangesBsl(m) {
    var lines = m.getLinesContent();
    var ranges = [];
    var stack = [];
    var inString = false;
    var queryFoldStart = -1;
    var i, word, kind, j, item;
    for (i = 0; i < lines.length; i++) {
        var prevString = inString;
        var scan = scanQuoteState(lines[i], inString);
        inString = scan.inString;
        if (!prevString && scan.queryStart && scan.inString) queryFoldStart = i;
        if (prevString && !inString && queryFoldStart >= 0) {
            if (i > queryFoldStart) ranges.push({ start: queryFoldStart + 1, end: i + 1, kind: monaco.languages.FoldingRangeKind.Region });
            queryFoldStart = -1;
        }
        word = bslStructureWord(lines[i], prevString);
        if (!word) continue;
        kind = FOLD_OPEN[word];
        if (kind) {
            stack.push({ kind: kind, start: i, proc: kind === 'proc' });
            continue;
        }
        kind = FOLD_CLOSE[word];
        if (!kind) continue;
        for (j = stack.length - 1; j >= 0; j--) {
            if (stack[j].kind === kind) {
                item = stack.splice(j, 1)[0];
                if (i > item.start) ranges.push({ start: item.start + 1, end: i + 1, kind: monaco.languages.FoldingRangeKind.Region });
                break;
            }
        }
    }
    if (queryFoldStart >= 0 && lines.length - 1 > queryFoldStart) {
        ranges.push({ start: queryFoldStart + 1, end: lines.length, kind: monaco.languages.FoldingRangeKind.Region });
    }
    return ranges;
}

function foldRangesQuery(m) {
    var lines = m.getLinesContent();
    var ranges = [];
    var stack = [];
    var i, line, c, top;
    for (i = 0; i < lines.length; i++) {
        line = lines[i];
        for (var k = 0; k < line.length; k++) {
            c = line.charAt(k);
            if (c === '/' && line.charAt(k + 1) === '/') break;
            if (c === '"') {
                k++;
                while (k < line.length && line.charAt(k) !== '"') k++;
                continue;
            }
            if (c === '(') stack.push(i);
            else if (c === ')' && stack.length) {
                top = stack.pop();
                if (i > top) ranges.push({ start: top + 1, end: i + 1 });
            }
        }
    }
    return ranges;
}

function collectProcedureStarts(m) {
    var lines = m.getLinesContent();
    var starts = [];
    var inString = false;
    var i, word, kind;
    for (i = 0; i < lines.length; i++) {
        var prevString = inString;
        inString = scanQuoteState(lines[i], inString).inString;
        word = bslStructureWord(lines[i], prevString);
        if (!word) continue;
        kind = FOLD_OPEN[word];
        if (kind === 'proc' || kind === 'region') starts.push(i);
    }
    return starts;
}

function foldAllProcedures(fold) {
    if (!editor || !model || !isBslModule()) return;
    var starts = collectProcedureStarts(model);
    if (!starts.length) return;
    editor.trigger('bsl', fold ? 'editor.fold' : 'editor.unfold', { selectionLines: starts });
    editor.focus();
}

function findLocalDefinition(m, pos) {
    var word = m.getWordAtPosition(pos);
    if (!word || !word.word) return null;
    var name = word.word;
    var re = new RegExp('^\\s*(?:Асинх\\s+|Async\\s+)?(Процедура|Procedure|Функция|Function)\\s+' +
        name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    var lines = m.getLinesContent();
    for (var i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        return {
            uri: m.uri,
            range: {
                startLineNumber: i + 1, startColumn: 1,
                endLineNumber: i + 1, endColumn: lines[i].length + 1
            }
        };
    }
    return null;
}

function snippetSuggestions(m, pos) {
    if (!state.isEditing) return { suggestions: [] };
    var word = m.getWordUntilPosition(pos);
    var range = {
        startLineNumber: pos.lineNumber,
        endLineNumber: pos.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
    };
    var out = [];
    for (var i = 0; i < BSL_SNIPPETS.length; i++) {
        var sn = BSL_SNIPPETS[i];
        out.push({
            label: sn.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: sn.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: sn.label,
            filterText: sn.prefix,
            range: range
        });
    }
    return { suggestions: out };
}

function formatBsl(m, range) {
    if (!window.BslFormatter) return [];
    var full = m.getFullModelRange();
    var use = range || full;
    var text = m.getValueInRange(use);
    try {
        return window.BslFormatter.format(text, use, { eol: m.getEOL() }) || [];
    } catch (e) {
        return [];
    }
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
        minimap: { enabled: !big && !!state.minimap },
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
        quickSuggestions: !!(state.isEditing && isBslModule()),
        parameterHints: { enabled: false },
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: (state.isEditing && isBslModule()) ? 'smart' : 'off',
        tabCompletion: (state.isEditing && isBslModule()) ? 'on' : 'off',
        snippetSuggestions: (state.isEditing && isBslModule()) ? 'inline' : 'none',
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
    state.objectMeta = req.objectMeta || '';
    var loaded = detectProvider(content);
    state.previewId = loaded ? loaded.id : '';
    state.formSelectedId = '';
    state.outlineCollapsed = {};
    state.dirty = false;
    baselineContent = content;
    pendingLeaveEdit = false;
    hideSavePrompt();

    var big = content.length > BIG_FILE_CHARS;
    var old = model;
    model = monaco.editor.createModel(content, state.language);
    if (!big && model.getLineCount() > BIG_FILE_LINES) big = true;
    state.bigFile = !!big;

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
    setPreviewMode(state.language === 'markdown' || state.language === 'html' || isDocPreview());

    /* Outline scanning walks every line, so let the editor paint first. */
    allItems = [];
    renderOutline();
    setTimeout(refreshOutline, 0);
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
    state.previewId = '';
    renderOutline();
    updateStatusBar();
    document.getElementById('loading').style.display = 'flex';
}

function wireEditorCommands() {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, toggleEdit);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
    editor.addAction({
        id: 'bsl.format',
        label: 'Форматировать документ',
        keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
        run: function () { formatDocument(); }
    });
    editor.addAction({
        id: 'bsl.comment',
        label: 'Комментировать строку',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
        run: function () { toggleLineComment(); }
    });
    editor.addAction({
        id: 'bsl.gotoDefinition',
        label: 'Перейти к определению',
        keybindings: [monaco.KeyCode.F12],
        run: function () {
            if (!isBslModule() || !model) return;
            var loc = findLocalDefinition(model, editor.getPosition());
            if (!loc) return;
            editor.revealRangeInCenter(loc.range);
            editor.setPosition({
                lineNumber: loc.range.startLineNumber,
                column: loc.range.startColumn
            });
            editor.focus();
        }
    });
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

/* Outline of the rendered document (form elements, template areas), as opposed
 * to parseOutline() which scans BSL source for procedures and regions. */
function parseDocOutline() {
    allItems = [];
    var p = currentProvider();
    if (!p || !model) return;
    var src = model.getValue();
    var parsed = p.parse(src);
    if (!parsed || !parsed.model) return;
    allItems = window[p.viewer].outline(parsed.model, src);
}

/* Rebuilds whichever outline the loaded file has; a no-op for everything else. */
function refreshOutline() {
    if (state.language === 'bsl') parseOutline();
    else if (isDocPreview()) parseDocOutline();
    else return;
    renderOutline();
}

function parseOutline() {
    var lines = model.getLinesContent();
    var procRe = /^\s*(?:Асинх\s+|Async\s+)?(Процедура|Procedure|Функция|Function)\s+([a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*)/i;
    var regionRe = /^\s*#\s*(Область|Region)\s+(.*)/i;
    var inProc = false;
    var inString = false;
    allItems = [];
    for (var i = 0; i < lines.length; i++) {
        var prevString = inString;
        inString = scanQuoteState(lines[i], inString).inString;
        var word = bslStructureWord(lines[i], prevString);
        if (!word) continue;
        if (inProc) {
            if (FOLD_CLOSE[word] === 'proc') inProc = false;
            continue;
        }
        if (FOLD_OPEN[word] === 'region') {
            var rm = lines[i].match(regionRe);
            if (rm) allItems.push({ type: 'region', name: rm[2].trim(), line: i + 1 });
            continue;
        }
        if (FOLD_OPEN[word] === 'proc') {
            var m = lines[i].match(procRe);
            if (!m) continue;
            var k = m[1].toLowerCase();
            var isF = (k === 'функция' || k === 'function');
            allItems.push({ type: isF ? 'func' : 'proc', name: m[2], line: i + 1 });
            inProc = true;
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

    document.getElementById('outline-count').textContent = (isDocPreview() ? 'Элементы (' : 'Структура (') + cnt + ')';
    var sortBtn = document.getElementById('sort-btn');
    setIcon('sort-btn', state.sortByName ? 'sort-numbers' : 'sort-letters');
    sortBtn.title = state.sortByName ? 'Сортировка: по имени (нажмите — по порядку)' : 'Сортировка: по порядку (нажмите — по имени)';
    var h = [];
    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (it.type === 'region') {
            h.push('<div class="region-group">', esc(it.name), '</div>');
        } else if (it.type === 'form') {
            var iconCls = 'icon-form-etc';
            var iconName = 'box';
            var iconCh = '';
            if (it.tag === 'TemplateArea') {
                var tic = (window.TemplatePreview && TemplatePreview.outlineIcon)
                    ? TemplatePreview.outlineIcon(it)
                    : { cls: 'icon-form-tbl', ch: 'A' };
                iconCls = tic.cls;
                iconCh = tic.ch;
            } else {
                var fic = (window.FormPreview && FormPreview.iconFor)
                    ? FormPreview.iconFor(it.tag)
                    : { cls: 'icon-form-etc', icon: 'box' };
                iconCls = fic.cls;
                iconName = fic.icon || 'box';
            }
            var pad = 8 + (it.depth || 0) * 12;
            var shown = it.title || it.name;
            var treeOn = docTree() && !state.sortByName;
            h.push('<div class="proc-item form-el" data-line="', it.line, '" data-id="', esc(it.id || ''),
                   '" data-idx="', j, '" data-name="', esc((it.name + ' ' + (it.title || '') + ' ' + (it.tag || '')).toLowerCase()),
                   '" style="padding-left:', pad, 'px">');
            if (treeOn && it.hasChildren) {
                var closed = !!(it.id && state.outlineCollapsed[it.id]);
                h.push('<span class="twisty" data-fold="', esc(it.id || ''), '">', closed ? '\u25B8' : '\u25BE', '</span>');
            } else if (treeOn) {
                h.push('<span class="twisty-ph"></span>');
            }
            if (iconCh) h.push('<span class="icon ', iconCls, '">', iconCh, '</span>');
            else h.push('<svg class="tb-icon outline-icon ', iconCls, '"><use href="#i-', iconName, '"></use></svg>');
            h.push('<span class="name">', esc(shown), '</span>');
            if (it.title && it.name && it.title !== it.name)
                h.push('<span class="name-sub">', esc(it.name), '</span>');
            h.push('<span class="line-num">', it.line, '</span></div>');
        } else {
            h.push('<div class="proc-item" data-line="', it.line, '" data-name="', esc(it.name.toLowerCase()), '">',
                   '<span class="icon ', (it.type === 'func' ? 'icon-func">F' : 'icon-proc">P'), '</span>',
                   '<span class="name">', esc(it.name), '</span>',
                   '<span class="line-num">', it.line, '</span></div>');
        }
    }
    document.getElementById('outline-list').innerHTML = h.join('');
    applyFilter();
    if (isDocPreview() && state.formSelectedId) highlightFormOutline(state.formSelectedId);
}

function applyFilter() {
    var v = document.getElementById('outline-filter').value.toLowerCase();
    document.getElementById('filter-clear').style.display = v ? 'block' : 'none';
    var filtering = !!v;
    var treeView = (docTree() && !state.sortByName && !filtering) ? previewView() : null;
    var foldOn = !!(treeView && treeView.outlineHidden);
    var ps = document.querySelectorAll('#outline-list .proc-item');
    for (var k = 0; k < ps.length; k++) {
        var match = !v || (ps[k].getAttribute('data-name') || '').indexOf(v) >= 0;
        var hidden = false;
        if (foldOn && ps[k].classList.contains('form-el')) {
            var idx = parseInt(ps[k].getAttribute('data-idx'), 10);
            hidden = treeView.outlineHidden(allItems, idx, state.outlineCollapsed);
        }
        ps[k].style.display = (match && !hidden) ? '' : 'none';
    }
}

// ----------------------------------------------------------------- chrome

function applyTheme() {
    var dk = uiIsDark();
    var name = dk ? 'bsl-dark' : 'bsl-light';
    document.documentElement.className = dk ? 'theme-dark' : 'theme-light';
    /* Bounce through the built-in theme so Monaco rebuilds its token
     * stylesheet from a known base before our colours replace it. Skip the
     * bounce on the very first paint: create() already used `name`, and an
     * extra vs-dark flash reads as a black screen. */
    if (editor && editor.__bslThemeApplied) {
        monaco.editor.setTheme(dk ? 'vs-dark' : 'vs');
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

function setIcon(id, name) {
    var use = document.querySelector('#' + id + ' use');
    if (use) use.setAttribute('href', '#i-' + name);
}

function applyChrome() {
    var dk = uiIsDark();
    var outlinePanel = document.getElementById('outline-panel');
    var outlineToggle = document.getElementById('outline-toggle');
    var isBsl = isBslModule();
    var isCode = isBslFamily();
    var formOpen = formPreviewOpen();

    outlinePanel.className = dk ? 'dark' : 'light';
    var pv = currentProvider();
    var tree = docTree();
    outlineToggle.style.display = (isBsl || pv) ? '' : 'none';
    outlinePanel.style.display = (isBsl || pv) ? 'flex' : 'none';
    outlineToggle.title = pv ? pv.outlineTitle : 'Список процедур/функций';
    document.getElementById('outline-fold').style.display = (isBsl || tree) ? '' : 'none';
    document.getElementById('outline-unfold').style.display = (isBsl || tree) ? '' : 'none';
    document.getElementById('outline-fold').title = tree ? 'Свернуть все группы' : 'Свернуть все процедуры и области';
    document.getElementById('outline-unfold').title = tree ? 'Развернуть все группы' : 'Развернуть все процедуры и области';

    var ot = document.getElementById('outline-top');
    ot.classList.remove('dark', 'light');
    ot.classList.add(dk ? 'dark' : 'light');

    setIcon('btn-theme', dk ? 'sun' : 'moon');
    document.getElementById('btn-theme').title = formOpen ? 'У макета формы всегда светлая тема' : 'Переключить тему';
    document.getElementById('btn-theme').style.display = formOpen ? 'none' : '';

    var mapBtn = document.getElementById('btn-minimap');
    mapBtn.classList.toggle('active', !!state.minimap);
    mapBtn.title = state.minimap ? 'Скрыть карту кода' : 'Показать карту кода';

    var btnEdit = document.getElementById('btn-edit');
    var btnSave = document.getElementById('btn-save');
    setIcon('btn-edit', state.isEditing ? 'eye' : 'pencil');
    btnEdit.title = state.isEditing ? 'Режим просмотра (Ctrl+E)' : 'Редактировать (Ctrl+E)';
    btnEdit.classList.toggle('active', state.isEditing);
    btnSave.style.display = state.isEditing ? '' : 'none';
    document.getElementById('btn-format').style.display = (state.isEditing && isBslModule()) ? '' : 'none';
    document.getElementById('btn-comment').style.display = (state.isEditing && isCode) ? '' : 'none';

    setIcon('btn-preview', state.previewMode ? 'code' : 'window');
    var canPreview = canPreviewLang();
    document.getElementById('btn-preview').style.display = canPreview ? '' : 'none';
    document.getElementById('btn-minimap').style.display = (isDocPreview() && state.previewMode) ? 'none' : '';
}

function toggleMinimap() {
    state.minimap = !state.minimap;
    writeStoredBool('bsl.minimap', state.minimap);
    if (editor) editor.updateOptions({ minimap: { enabled: !state.bigFile && !!state.minimap } });
    applyChrome();
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
    var snip = !!(state.isEditing && isBslModule());
    editor.updateOptions({
        readOnly: !state.isEditing,
        quickSuggestions: snip,
        acceptSuggestionOnEnter: snip ? 'smart' : 'off',
        tabCompletion: snip ? 'on' : 'off',
        snippetSuggestions: snip ? 'inline' : 'none'
    });
    if (isDocPreview()) setPreviewMode(!on);
    applyChrome();
    applyPreviewEditable();
    if (state.isEditing && state.previewMode && !isDocPreview()) focusPreview();
    else if (editor) editor.focus();
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
    refreshOutline();
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

function formatDocument() {
    if (!state.isEditing || !isBslModule() || !editor) return;
    var act = editor.getAction('editor.action.formatDocument');
    if (act) act.run();
    editor.focus();
}

function toggleLineComment() {
    if (!state.isEditing || !isBslFamily() || !editor) return;
    editor.trigger('bsl', 'editor.action.commentLine');
    editor.focus();
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
    if (!state.previewMode) return;
    if (isDocPreview()) {
        refreshDocPreview();
        return;
    }
    if (state.language !== 'markdown') return;
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
        if (isDocPreview()) return;
        applyPreviewEditable();
        syncPreviewFromEditor();
        syncHighlightFromEditor();
    }, 120);
}

/* Draws the active provider's document into the preview host. The content can
 * stop being a form or a template while it is edited, so the provider is
 * re-detected on every refresh; the message shown when nothing claims it any
 * more keeps the wording of the provider that was active. */
function refreshDocPreview() {
    var host = formPreviewEl();
    var was = currentProvider();
    if (!host || !model || !was) return;
    var src = model.getValue();
    var p = detectProvider(src);
    state.previewId = p ? p.id : '';
    if (!p) {
        // Editing can turn a previewable document into ordinary XML. Leave
        // preview mode immediately so the user always has a visible editor
        // and a button to switch back after the provider disappears.
        setPreviewMode(false);
        return;
    }
    var parsed = p.parse(src);
    if (parsed.error) {
        showPreviewMessage(host, p, parsed.error);
        return;
    }
    window[p.viewer].render(parsed.model, host, { onSelect: onDocPreviewSelect });
}

function showPreviewMessage(host, provider, text) {
    host.className = provider.rootCls;
    host.innerHTML = '<div class="' + provider.emptyCls + '">' + esc(text) + '</div>';
}

/* Clicking an element in the rendered document jumps the editor to the source
 * line behind it and selects the matching outline row. */
function onDocPreviewSelect(item) {
    var p = currentProvider();
    if (!item || !editor || !p) return;
    if (!allItems.length) {
        parseDocOutline();
        renderOutline();
    }
    var view = window[p.viewer];
    var id = view.itemKey(item);
    var line = 1;
    for (var i = 0; i < allItems.length; i++) {
        if (allItems[i].id === id || (p.selectMatchesByName && allItems[i].name === item.name)) {
            line = allItems[i].line;
            break;
        }
    }
    /* Template parameters have no outline entry of their own, so fall back to
     * finding the parameter name in the source. */
    if (line === 1 && p.selectMatchesByName && item.parameter) {
        var found = model.getValue().split(/\r?\n/);
        for (var k = 0; k < found.length; k++) {
            if (found[k].indexOf('>' + item.name + '<') >= 0 || found[k].indexOf('<parameter>' + item.name + '</parameter>') >= 0) {
                line = k + 1;
                break;
            }
        }
    }
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    highlightFormOutline(id);
    /* The form preview marks its own selection on click; the spreadsheet one
     * has to be told. */
    if (p.selectHighlightsPreview && view.highlight) view.highlight(formPreviewEl(), id);
}

function highlightFormOutline(id) {
    state.formSelectedId = id ? String(id) : '';
    var treeView = docTree() ? previewView() : null;
    if (treeView && treeView.outlineExpandTo && treeView.outlineExpandTo(allItems, id, state.outlineCollapsed)) {
        renderOutline();
        return;
    }
    var rows = document.querySelectorAll('.proc-item.form-el');
    var hit = null;
    for (var r = 0; r < rows.length; r++) {
        var on = rows[r].getAttribute('data-id') === state.formSelectedId;
        rows[r].classList.toggle('selected', on);
        rows[r].style.background = '';
        if (on) hit = rows[r];
    }
    if (hit && hit.scrollIntoView) {
        try { hit.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (e) { hit.scrollIntoView(); }
    }
}

function hideFormPreview() {
    var host = formPreviewEl();
    if (!host) return;
    host.style.display = 'none';
    host.hidden = true;
    host.innerHTML = '';
}

function refreshPreviewContent() {
    if (!state.previewMode || !model) return;
    /* Either a provider already owns the view, or one claims the new content. */
    var p = currentProvider() || detectProvider(model.getValue());
    if (p) {
        var wasId = state.previewId;
        state.previewId = p.id;
        refreshDocPreview();
        parseDocOutline();
        renderOutline();
        /* Editing can turn a form into a template and back, and the outline
         * titles and fold buttons belong to the provider, not to the file. */
        if (state.previewId !== wasId) applyChrome();
        return;
    }
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
    var formEl = formPreviewEl();
    var editorEl = document.getElementById('editor');
    var handle = document.getElementById('preview-handle');
    var btn = document.getElementById('btn-preview');
    var apply = function () {
        state.previewMode = on;
        if (on) {
            btn.classList.add('active');
            if (isDocPreview()) {
                editorEl.style.display = 'none';
                editorEl.style.width = '';
                editorEl.style.flex = '';
                handle.style.display = 'none';
                frame.style.display = 'none';
                frame.removeAttribute('srcdoc');
                formEl.hidden = false;
                formEl.style.display = 'flex';
                formEl.style.flex = '1';
                btn.title = 'Показать исходник';
                refreshDocPreview();
            } else {
                hideFormPreview();
                editorEl.style.display = '';
                handle.style.display = 'block';
                frame.style.display = 'block';
                frame.srcdoc = buildPreviewDoc();
                btn.title = 'Скрыть превью';
            }
            if (editor) editor.layout();
            applyPreviewEditable();
        } else {
            if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
            handle.style.display = 'none';
            frame.style.display = 'none';
            frame.removeAttribute('srcdoc');
            hideFormPreview();
            editorEl.style.display = '';
            editorEl.style.flex = '1';
            editorEl.style.width = '';
            btn.classList.remove('active');
            var shown = currentProvider();
            btn.title = shown ? shown.sourceTitle : 'Исходник и просмотр';
            if (editor) editor.layout();
        }
        applyTheme();
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

function printFrame() { return document.getElementById('print-frame'); }

function printCss() {
    return 'html,body{margin:0;padding:16px 22px;background:#fff;color:#000;'
         + 'font-family:Segoe UI,Arial,sans-serif;font-size:11pt;line-height:1.5}'
         + 'pre{white-space:pre-wrap;word-wrap:break-word;'
         + 'font-family:Consolas,\'Courier New\',monospace;font-size:11pt;margin:0}'
         + '.md-body{font-family:Segoe UI,Arial,sans-serif;font-size:11pt;max-width:100%}'
         + '.md-body pre{background:#f6f8fa;padding:8px;border-radius:4px}'
         + '.md-body code{font-family:Consolas,monospace}'
         + '.md-body h1,.md-body h2,.md-body h3{border-bottom:1px solid #ddd;padding-bottom:4px}'
         + '.md-body table{border-collapse:collapse}'
         + '.md-body td,.md-body th{border:1px solid #999;padding:3px 6px}'
         + 'img{max-width:100%}'
         + '.tp-root{background:#fff;color:#000}'
         + '.tp-scroll{overflow:visible}'
         + '.tp-sheet{display:flex;align-items:flex-start}'
         + '.tp-left{flex:0 0 auto;display:flex;flex-direction:column;background:#ececec}'
         + '.tp-left-body{display:flex}'
         + '.tp-right{flex:0 0 auto}'
         + '.tp-areas{width:92px;flex:0 0 92px;background:#f3f3f3;border-right:1px solid #c8c8c8;font:11px Segoe UI,sans-serif}'
         + '.tp-area-label{border-top:1px solid #e14c4c;padding:2px 4px;overflow:hidden}'
         + '.tp-rowhead{width:32px;flex:0 0 32px;background:#ececec;text-align:center;font:10px Segoe UI,sans-serif}'
         + '.tp-grid{border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif}'
         + '.tp-grid td,.tp-grid th{border:1px solid #ccc;padding:0 2px;vertical-align:top}'
         + '.tp-grid th{background:#ececec;font:10px Segoe UI,sans-serif}'
         + '.tp-param{color:#7a2e00}'
         + '.tp-drawings{position:relative}'
         + '.tp-drawing{position:absolute}';
}

// The PDF export renders through #print-frame, a sandboxed iframe with no
// allow-scripts: the file being viewed is untrusted input, and this is the
// one path (unlike the read-only preview pane) that used to inject it as
// raw HTML into the viewer's own document. `done` fires only once the new
// srcdoc has actually loaded, so the native PrintToPdf call that follows
// never captures stale or blank content.
function preparePrintContent(done) {
    var frame = printFrame();
    var content = model.getValue();
    var body;
    if (state.previewMode && isDocPreview() && formPreviewEl()) {
        body = '<div class="md-body">' + formPreviewEl().innerHTML + '</div>';
    } else if (state.previewMode && state.language === 'markdown') {
        body = '<div class="md-body">' + renderMarkdown(content) + '</div>';
    } else if (state.previewMode && state.language === 'html') {
        body = '<div class="md-body">' + content + '</div>';
    } else {
        body = '<pre>' + esc(content) + '</pre>';
    }
    var onLoad = function () {
        frame.removeEventListener('load', onLoad);
        // An iframe with height:auto keeps its small CSS/layout viewport when
        // it is printed. Expand it to the document's actual height first, so
        // PrintToPdf captures every line and lets the print engine paginate.
        var doc = frame.contentDocument;
        var height = doc && doc.documentElement && doc.body
            ? Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)
            : 0;
        frame.style.height = Math.max(1, height) + 'px';
        if (done) done();
    };
    // Display the frame off-screen while measuring it; a display:none iframe
    // reports a zero layout height even though its document has content.
    frame.classList.add('print-me');
    frame.style.height = '0px';
    frame.addEventListener('load', onLoad);
    frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + printCss()
                 + '</style></head><body>' + body + '</body></html>';
}

function clearPrintContent() {
    var frame = printFrame();
    frame.removeAttribute('srcdoc');
    frame.classList.remove('print-me');
    frame.style.height = '0px';
}

// ------------------------------------------------------- one-time UI wiring

function wireUi() {
    document.getElementById('outline-list').addEventListener('click', function (e) {
        var tw = e.target.closest && e.target.closest('.twisty');
        if (tw && docTree()) {
            e.preventDefault();
            e.stopPropagation();
            var fid = tw.getAttribute('data-fold');
            if (!fid) return;
            if (!state.outlineCollapsed) state.outlineCollapsed = {};
            if (state.outlineCollapsed[fid]) delete state.outlineCollapsed[fid];
            else state.outlineCollapsed[fid] = true;
            renderOutline();
            return;
        }
        var el = e.target.closest('.proc-item');
        if (!el) return;
        var ln = parseInt(el.getAttribute('data-line'), 10);
        editor.revealLineInCenter(ln);
        editor.setPosition({ lineNumber: ln, column: 1 });
        var view = previewView();
        var rowId = el.getAttribute('data-id');
        if (view && view.highlight && rowId) {
            view.highlight(formPreviewEl(), rowId);
            highlightFormOutline(rowId);
        }
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
    document.getElementById('outline-fold').addEventListener('click', function () {
        var collapseView = docTree() ? previewView() : null;
        if (collapseView && collapseView.outlineCollapseAll) {
            if (!state.outlineCollapsed) state.outlineCollapsed = {};
            collapseView.outlineCollapseAll(allItems, state.outlineCollapsed);
            renderOutline();
            return;
        }
        foldAllProcedures(true);
    });
    document.getElementById('outline-unfold').addEventListener('click', function () {
        if (docTree()) {
            state.outlineCollapsed = {};
            renderOutline();
            return;
        }
        foldAllProcedures(false);
    });

    document.getElementById('outline-toggle').addEventListener('click', function () {
        var p = document.getElementById('outline-panel');
        p.style.display = (p.style.display === 'none') ? 'flex' : 'none';
        editor.layout();
    });

    document.getElementById('btn-theme').addEventListener('click', function () {
        if (formPreviewOpen()) return;
        state.isDark = !state.isDark;
        applyTheme();
    });
    document.getElementById('btn-minimap').addEventListener('click', toggleMinimap);
    document.getElementById('btn-edit').addEventListener('click', toggleEdit);
    document.getElementById('btn-save').addEventListener('click', saveFile);
    document.getElementById('btn-format').addEventListener('click', formatDocument);
    document.getElementById('btn-comment').addEventListener('click', toggleLineComment);
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
        preparePrintContent(function () { send({ cmd: 'pdf' }); });
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

/* Preview-provider selection is the one piece of this file that is pure logic,
 * and it decides how every file is displayed — so it is exported for
 * tests/viewer-preview.test.mjs, the way the preview modules export `_test`. */
window.ViewerInternals = {
    providers: PREVIEW_PROVIDERS,
    state: state,
    detectProvider: detectProvider,
    providerById: providerById,
    currentProvider: currentProvider,
    previewView: previewView,
    isDocPreview: isDocPreview,
    isFormView: isFormView,
    docTree: docTree,
    formPreviewOpen: formPreviewOpen,
    canPreviewLang: canPreviewLang,
    uiIsDark: uiIsDark
};

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
