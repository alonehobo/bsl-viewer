#ifndef MONACO_TEMPLATE_H
#define MONACO_TEMPLATE_H

// HTML template for Monaco Editor with BSL syntax highlighting
// Placeholders: BSL_CONTENT, %THEME%, %FONTSIZE%
// Split into two parts to avoid MSVC string literal length limit

static const char* MONACO_HTML_PART1 = R"TEMPLATE(<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; font-family:'Segoe UI',sans-serif; }
#main { display:flex; width:100%; height:100%; }
#editor { flex:1; height:100%; min-width:0; }
#outline-panel { width:420px; min-width:200px; max-width:60%; height:100%; border-left:1px solid #ddd; font-size:12px; display:none; flex-shrink:0; overflow:hidden; position:relative; }
#resize-handle { position:absolute; left:0; top:0; width:5px; height:100%; cursor:col-resize; z-index:2; }
#resize-handle:hover { background:rgba(0,120,212,0.3); }
#outline-panel.dark { border-left-color:#333; background:#1e1e1e; color:#d4d4d4; }
#outline-panel.light { background:#f8f8f8; color:#000; }
#outline-top { position:sticky; top:0; z-index:1; }
#outline-top.light { background:#f8f8f8; }
#outline-top.dark { background:#1e1e1e; }
#outline-header { padding:6px 10px; font-weight:bold; font-size:13px; border-bottom:1px solid #ddd; user-select:none; display:flex; align-items:center; gap:6px; }
#outline-panel.dark #outline-header { border-bottom-color:#333; }
#sort-btn { border:none; background:none; cursor:pointer; font-size:13px; padding:2px 6px; opacity:0.6; border-radius:3px; order:-1; }
#sort-btn:hover { opacity:1; background:rgba(0,0,0,0.06); }
#outline-panel.dark #sort-btn { color:#d4d4d4; }
#outline-panel.dark #sort-btn:hover { background:rgba(255,255,255,0.06); }
.filter-wrap { position:relative; margin:6px 10px; }
#outline-filter { width:100%; padding:4px 24px 4px 6px; font-size:12px; border:1px solid #ccc; border-radius:3px; outline:none; box-sizing:border-box; }
#outline-panel.dark #outline-filter { background:#2d2d2d; color:#d4d4d4; border-color:#444; }
#filter-clear { position:absolute; right:4px; top:50%; transform:translateY(-50%); border:none; background:none; cursor:pointer; font-size:14px; color:#999; padding:0 4px; display:none; }
#filter-clear:hover { color:#333; }
#outline-panel.dark #filter-clear:hover { color:#eee; }
#outline-list { overflow-y:auto; flex:1; }
#outline-toggle { position:absolute; right:0; top:0; z-index:10; width:28px; height:28px; border:none; cursor:pointer; font-size:16px; line-height:28px; text-align:center; opacity:0.7; }
#outline-toggle:hover { opacity:1; }
#outline-toggle.dark { background:#1e1e1e; color:#d4d4d4; }
#outline-toggle.light { background:#f8f8f8; color:#333; }
.proc-item { padding:3px 10px 3px 20px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.proc-item:hover { background:rgba(0,0,0,0.06); }
#outline-panel.dark .proc-item:hover { background:rgba(255,255,255,0.06); }
.proc-item .icon { display:inline-block; width:16px; height:16px; line-height:16px; text-align:center; margin-right:4px; font-size:11px; font-weight:bold; border-radius:3px; vertical-align:middle; }
.proc-item .icon-proc { background:#6c5ce7; color:#fff; }
.proc-item .icon-func { background:#00b894; color:#fff; }
.proc-item .name { vertical-align:middle; }
.proc-item .line-num { float:right; color:#999; font-size:11px; margin-left:8px; }
#outline-panel.dark .proc-item .line-num { color:#666; }
.region-group { padding:4px 10px 2px 10px; font-size:11px; color:#888; font-weight:bold; margin-top:4px; border-top:1px solid #eee; }
#outline-panel.dark .region-group { border-top-color:#333; color:#666; }
#loading { display:flex; justify-content:center; align-items:center; height:100%; font-size:16px; color:#888; }
#toolbar { position:absolute; right:34px; top:0; z-index:10; display:flex; gap:0; }
.tb-btn { height:28px; border:none; cursor:pointer; font-size:11px; padding:0 8px; opacity:0.85; white-space:nowrap; }
.tb-btn:hover { opacity:1; }
.tb-btn.dark { background:#1e1e1e; color:#d4d4d4; }
.tb-btn.light { background:#f8f8f8; color:#333; }
.tb-btn.active { color:#fff; background:#0078d4; opacity:1; }
.tb-btn.save-ok { background:#00a854; color:#fff; }
</style>
</head>
<body>
<div id="loading">Загрузка Monaco Editor...</div>
<div id="main" style="display:none">
<div id="editor"></div>
<div id="toolbar">
<button id="btn-theme" class="tb-btn" title="Переключить тему">&#9788;</button>
<button id="btn-edit" class="tb-btn" title="Редактирование (Ctrl+E)">&#9998; Просмотр</button>
<button id="btn-save" class="tb-btn" title="Сохранить (Ctrl+S)" style="display:none">&#128190; Сохранить</button>
</div>
<button id="outline-toggle" title="Список процедур/функций">&#9776;</button>
<div id="outline-panel"><div id="resize-handle"></div><div id="outline-content" style="display:flex;flex-direction:column;height:100%;overflow:hidden"></div></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"></script>
<script>
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } });
require(['vs/editor/editor.main'], function () {
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

    // 1C Configurator light theme (colors from bsl_console)
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
            { token: 'number', foreground: '000000' },
            { token: 'number.float', foreground: '000000' },
            { token: 'date', foreground: '000000' },
            { token: 'preproc', foreground: '963200' },
            { token: 'compile', foreground: '963200' },
            { token: 'gotomark', foreground: '3a3a3a' }
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

    // Dark theme (colors from bsl_console)
    monaco.editor.defineTheme('bsl-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
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
            { token: 'number', foreground: 'b5cea8' },
            { token: 'number.float', foreground: 'b5cea8' },
            { token: 'date', foreground: 'b5cea8' },
            { token: 'preproc', foreground: '963200' },
            { token: 'compile', foreground: '963200' },
            { token: 'gotomark', foreground: 'ff9000' }
        ],
        colors: {
            'editor.background': '#1e1e1e',
            'editor.foreground': '#d4d4d4',
            'editor.selectionBackground': '#062f4a'
        }
    });

)TEMPLATE";

static const char* MONACO_HTML_PART2 = R"TEMPLATE(
    // Create editor
    document.getElementById('loading').style.display = 'none';
    var mainDiv = document.getElementById('main');
    mainDiv.style.display = 'flex';

    var isDark = '%THEME%' === 'bsl-dark';
    var outlinePanel = document.getElementById('outline-panel');
    var outlineToggle = document.getElementById('outline-toggle');
    outlinePanel.className = isDark ? 'dark' : 'light';
    outlineToggle.className = isDark ? 'dark' : 'light';

    var editor = monaco.editor.create(document.getElementById('editor'), {
        value: BSL_CONTENT,
        language: 'bsl',
        readOnly: true,
        theme: '%THEME%',
        minimap: { enabled: true },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: %FONTSIZE%,
        renderWhitespace: 'none',
        folding: true,
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
    });

    // Build outline panel
    var sortByName = false;
    var allItems = [];

    function parseOutline() {
        var lines = editor.getModel().getLinesContent();
        var procRe = /^\s*(Процедура|Procedure|Функция|Function)\s+([a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*)/i;
        var regionRe = /^\s*#\s*(Область|Region)\s+(.*)/i;
        var endRegionRe = /^\s*#\s*(КонецОбласти|EndRegion)/i;
        allItems = [];
        for (var i = 0; i < lines.length; i++) {
            var rm = lines[i].match(regionRe);
            if (rm) { allItems.push({ type: 'region', name: rm[2].trim(), line: i+1 }); continue; }
            if (lines[i].match(endRegionRe)) continue;
            var m = lines[i].match(procRe);
            if (m) {
                var k = m[1].toLowerCase();
                var isF = (k === '\u0444\u0443\u043d\u043a\u0446\u0438\u044f' || k === 'function');
                allItems.push({ type: isF ? 'func' : 'proc', name: m[2], line: i+1 });
            }
        }
    }

    function buildOutline() {
        var items = allItems.slice();
        if (sortByName) {
            items = items.filter(function(x){return x.type!=='region';});
            items.sort(function(a,b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        }

        var cnt = allItems.filter(function(x){return x.type!=='region';}).length;
        var sortIcon = sortByName ? '\u0040\u2193' : '#\u2193';
        var sortTitle = sortByName ? '\u041f\u043e \u0438\u043c\u0435\u043d\u0438 \u2192 \u041f\u043e \u043f\u043e\u0440\u044f\u0434\u043a\u0443' : '\u041f\u043e \u043f\u043e\u0440\u044f\u0434\u043a\u0443 \u2192 \u041f\u043e \u0438\u043c\u0435\u043d\u0438';
        var h = '<div id="outline-top" class="' + (isDark?'dark':'light') + '">';
        h += '<div id="outline-header"><span>\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 (' + cnt + ')</span>';
        h += '<button id="sort-btn" title="' + sortTitle + '">' + sortIcon + '</button></div>';
        h += '<div class="filter-wrap"><input id="outline-filter" type="text" placeholder="\u0424\u0438\u043b\u044c\u0442\u0440..."><button id="filter-clear" title="\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c">&times;</button></div>';
        h += '</div><div id="outline-list" style="overflow-y:auto;flex:1">';

        for (var j = 0; j < items.length; j++) {
            var it = items[j];
            if (it.type === 'region') {
                h += '<div class="region-group">' + esc(it.name) + '</div>';
            } else {
                var ic = it.type==='func' ? '<span class="icon icon-func">F</span>' : '<span class="icon icon-proc">P</span>';
                h += '<div class="proc-item" data-line="'+it.line+'" data-name="'+esc(it.name.toLowerCase())+'">' +
                    ic+'<span class="name">'+esc(it.name)+'</span><span class="line-num">'+it.line+'</span></div>';
            }
        }
        h += '</div>';
        var oc = document.getElementById('outline-content');
        oc.innerHTML = h;

        oc.addEventListener('click', function(e) {
            var el = e.target.closest('.proc-item');
            if (el) {
                var ln = parseInt(el.getAttribute('data-line'));
                editor.revealLineInCenter(ln);
                editor.setPosition({lineNumber:ln, column:1});
                editor.focus();
            }
        });

        var fi = document.getElementById('outline-filter');
        var fc = document.getElementById('filter-clear');
        if (fi) {
            fi.addEventListener('input', function() {
                var v = this.value.toLowerCase();
                fc.style.display = v ? 'block' : 'none';
                var ps = document.querySelectorAll('.proc-item');
                for (var k=0;k<ps.length;k++) {
                    var n = ps[k].getAttribute('data-name');
                    ps[k].style.display = (!v || n.indexOf(v)>=0) ? '' : 'none';
                }
            });
        }
        if (fc) {
            fc.addEventListener('click', function() {
                fi.value = '';
                fc.style.display = 'none';
                fi.dispatchEvent(new Event('input'));
                fi.focus();
            });
        }
        var sb = document.getElementById('sort-btn');
        if (sb) {
            sb.addEventListener('click', function() {
                sortByName = !sortByName;
                buildOutline();
            });
        }
    }

    function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    var outlineVisible = true;
    outlinePanel.style.display = 'flex';
    outlinePanel.style.flexDirection = 'column';
    parseOutline();
    buildOutline();

    outlineToggle.addEventListener('click', function() {
        outlineVisible = !outlineVisible;
        outlinePanel.style.display = outlineVisible ? 'flex' : 'none';
        editor.layout();
    });

    // Resize handle for outline panel
    var resizeHandle = document.getElementById('resize-handle');
    if (resizeHandle) {
        var startX, startW;
        resizeHandle.addEventListener('mousedown', function(e) {
            startX = e.clientX;
            startW = outlinePanel.offsetWidth;
            e.preventDefault();
            document.addEventListener('mousemove', onResize);
            document.addEventListener('mouseup', stopResize);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        function onResize(e) {
            var newW = startW - (e.clientX - startX);
            if (newW < 200) newW = 200;
            if (newW > window.innerWidth * 0.6) newW = window.innerWidth * 0.6;
            outlinePanel.style.width = newW + 'px';
            editor.layout();
        }
        function stopResize() {
            document.removeEventListener('mousemove', onResize);
            document.removeEventListener('mouseup', stopResize);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    }

    // Theme switcher
    var btnTheme = document.getElementById('btn-theme');
    var themes = ['bsl-light', 'bsl-dark'];
    var themeNames = ['\u2600 \u0421\u0432\u0435\u0442\u043b\u0430\u044f', '\u263E \u0422\u0435\u043c\u043d\u0430\u044f'];
    var currentThemeIdx = isDark ? 1 : 0;

    function updateThemeClasses() {
        var dk = currentThemeIdx === 1;
        outlinePanel.className = dk ? 'dark' : 'light';
        outlineToggle.className = dk ? 'dark' : 'light';
        btnTheme.className = 'tb-btn ' + (dk?'dark':'light');
        btnTheme.innerHTML = themeNames[currentThemeIdx];
        // Re-style toolbar buttons
        var btns = document.querySelectorAll('.tb-btn');
        for (var i=0;i<btns.length;i++) {
            if (!btns[i].classList.contains('active') && !btns[i].classList.contains('save-ok')) {
                btns[i].classList.remove('dark','light');
                btns[i].classList.add(dk?'dark':'light');
            }
        }
        // Re-style outline-top
        var ot = document.getElementById('outline-top');
        if (ot) { ot.classList.remove('dark','light'); ot.classList.add(dk?'dark':'light'); }
    }

    btnTheme.addEventListener('click', function() {
        currentThemeIdx = (currentThemeIdx + 1) % themes.length;
        monaco.editor.setTheme(themes[currentThemeIdx]);
        isDark = currentThemeIdx === 1;
        updateThemeClasses();
        buildOutline();
    });

    btnTheme.innerHTML = themeNames[currentThemeIdx];
    btnTheme.className = 'tb-btn ' + (isDark?'dark':'light');

    // Edit/Save
    var btnEdit = document.getElementById('btn-edit');
    var btnSave = document.getElementById('btn-save');
    btnEdit.className = 'tb-btn ' + (isDark?'dark':'light');
    btnSave.className = 'tb-btn ' + (isDark?'dark':'light');
    var isEditing = false;

    function toggleEdit() {
        isEditing = !isEditing;
        editor.updateOptions({ readOnly: !isEditing });
        btnEdit.innerHTML = isEditing ? '&#9998; \u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435' : '&#9998; \u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440';
        if (isEditing) { btnEdit.classList.add('active'); btnSave.style.display=''; }
        else { btnEdit.classList.remove('active'); btnSave.style.display='none'; }
        editor.focus();
    }
    btnEdit.addEventListener('click', toggleEdit);

    function saveFile() {
        if (!isEditing) return;
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage('SAVE:' + editor.getValue());
            btnSave.classList.add('save-ok');
            btnSave.innerHTML = '&#10004; \u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e';
            setTimeout(function() {
                btnSave.classList.remove('save-ok');
                btnSave.className = 'tb-btn ' + (isDark?'dark':'light');
                btnSave.innerHTML = '&#128190; \u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c';
            }, 2000);
        }
    }
    btnSave.addEventListener('click', saveFile);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, toggleEdit);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);

    // Symbol provider for Ctrl+Shift+O
    monaco.languages.registerDocumentSymbolProvider('bsl', {
        provideDocumentSymbols: function(model) {
            var syms = [], lines = model.getLinesContent();
            var re = /^\s*(Процедура|Procedure|Функция|Function)\s+([a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*)/i;
            for (var i=0;i<lines.length;i++) {
                var m = lines[i].match(re);
                if (m) {
                    var k = m[1].toLowerCase();
                    var isF = (k==='\u0444\u0443\u043d\u043a\u0446\u0438\u044f'||k==='function');
                    syms.push({ name:m[2], detail:m[1],
                        kind: isF ? monaco.languages.SymbolKind.Function : monaco.languages.SymbolKind.Method,
                        range:{startLineNumber:i+1,startColumn:1,endLineNumber:i+1,endColumn:lines[i].length+1},
                        selectionRange:{startLineNumber:i+1,startColumn:1,endLineNumber:i+1,endColumn:lines[i].length+1}
                    });
                }
            }
            return syms;
        }
    });
});
</script>
</body>
</html>
)TEMPLATE";

#endif // MONACO_TEMPLATE_H
