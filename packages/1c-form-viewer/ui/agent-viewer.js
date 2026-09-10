(function (root) {
'use strict';

var host = document.getElementById('preview');
var empty = document.getElementById('agent-empty');
var pathLabel = document.getElementById('agent-path');
var formatLabel = document.getElementById('agent-format');
var current = null;

function fail(message) { throw new Error(message); }
function itemId(item) { return item && (item.id || item.name) ? String(item.id || item.name) : ''; }
function provider(format) {
    if (format === 'form') return { parser: root.FormPreview, viewer: root.FormPreview };
    if (format === 'template') return { parser: root.TemplatePreview, viewer: root.TemplatePreview };
    if (format === 'mxl') return { parser: root.MxlPreview, viewer: root.TemplatePreview };
    return null;
}

function detect(input) {
    if (root.FormPreview.detect(input.content)) return 'form';
    if (root.MxlPreview.detect(input.content)) return 'mxl';
    if (root.TemplatePreview.detect(input.content)) return 'template';
    fail('The file is not a supported 1C form, spreadsheet template, or MXL document.');
}

function renderCurrent() {
    var p = provider(current.format);
    host.hidden = false;
    empty.hidden = true;
    p.viewer.render(current.model, host, {
        onSelect: function (item) { current.selectedId = itemId(item); }
    });
    formatLabel.textContent = current.format === 'form' ? 'Форма 1С' : (current.format === 'mxl' ? 'MXL' : 'Макет 1С');
    pathLabel.textContent = current.path;
    pathLabel.title = current.path;
}

function load(input) {
    var format = detect(input);
    var p = provider(format);
    var parsed = format === 'form'
        ? p.parser.parse(input.content, input.objectMeta || '')
        : p.parser.parse(input.content);
    if (!parsed || parsed.error || !parsed.model) fail((parsed && parsed.error) || 'The renderer did not produce a model.');
    current = {
        format: format,
        path: input.path,
        content: input.content,
        objectMeta: input.objectMeta || '',
        model: parsed.model,
        outline: p.viewer.outline(parsed.model, input.content) || [],
        selectedId: ''
    };
    renderCurrent();
    return state();
}

function requireCurrent() {
    if (!current) fail('No preview is open. Call open_preview first.');
    return current;
}

function byId(id) {
    var items = requireCurrent().outline;
    for (var i = 0; i < items.length; i++) if (String(items[i].id) === String(id)) return items[i];
    return null;
}

function findDom(id) {
    var nodes = host.querySelectorAll('[data-id]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-id') === String(id)) return nodes[i];
    return null;
}

function visible(node) {
    if (!node) return false;
    var style = getComputedStyle(node);
    var rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function modelPages() {
    var map = Object.create(null);
    function walk(items) {
        (items || []).forEach(function (item) {
            if (!item) return;
            if (item.tag === 'Pages') {
                map[itemId(item)] = (item.childItems || []).filter(function (child) { return child && child.tag === 'Page'; });
            }
            walk(item.childItems);
            if (item.autoCommandBar) walk([item.autoCommandBar]);
        });
    }
    if (current && current.model) {
        walk(current.model.childItemsRoot);
        if (current.model.autoCommandBar) walk([current.model.autoCommandBar]);
    }
    return map;
}

function tabs() {
    if (!current || current.format !== 'form') return [];
    var pages = modelPages();
    var result = [];
    var lists = host.querySelectorAll('.fp-pages-tablist');
    for (var i = 0; i < lists.length; i++) {
        var wrapper = lists[i].closest('.fp-item[data-id]');
        var pagesId = wrapper ? wrapper.getAttribute('data-id') : '';
        var pageItems = pages[pagesId] || [];
        var buttons = lists[i].querySelectorAll('[role="tab"]');
        for (var j = 0; j < buttons.length; j++) {
            result.push({
                pagesId: pagesId,
                pageId: itemId(pageItems[j]),
                name: pageItems[j] && pageItems[j].name || '',
                caption: buttons[j].textContent || '',
                active: buttons[j].getAttribute('aria-selected') === 'true'
            });
        }
    }
    return result;
}

function scrollInfo(node, target, elementId) {
    if (!node) return null;
    return {
        target: target,
        elementId: elementId || '',
        x: node.scrollLeft,
        y: node.scrollTop,
        maxX: Math.max(0, node.scrollWidth - node.clientWidth),
        maxY: Math.max(0, node.scrollHeight - node.clientHeight),
        clientWidth: node.clientWidth,
        clientHeight: node.clientHeight
    };
}

function scrolls() {
    if (!current) return [];
    var result = [];
    var documentScroll = current.format === 'form' ? host.querySelector('.fp-body') : host.querySelector('.tp-scroll');
    var info = scrollInfo(documentScroll, 'document', '');
    if (info) result.push(info);
    host.querySelectorAll('.fp-pages-active-panel').forEach(function (node) {
        var owner = node.closest('.fp-item[data-id]');
        result.push(scrollInfo(node, 'active-page', owner && owner.getAttribute('data-id')));
    });
    host.querySelectorAll('.fp-table-mock').forEach(function (node) {
        var owner = node.closest('.fp-item[data-id]');
        result.push(scrollInfo(node, 'table', owner && owner.getAttribute('data-id')));
    });
    host.querySelectorAll('.fp-spreadsheet-viewport').forEach(function (node) {
        var owner = node.closest('.fp-item[data-id]');
        result.push(scrollInfo(node, 'spreadsheet', owner && owner.getAttribute('data-id')));
    });
    return result.filter(Boolean);
}

function state() {
    requireCurrent();
    var rect = host.getBoundingClientRect();
    var props = current.model.properties || {};
    return {
        format: current.format,
        path: current.path,
        selectedId: current.selectedId,
        summary: {
            elements: current.outline.length,
            sourceWidth: current.model.width || props.Width || null,
            sourceHeight: current.model.height || props.Height || null,
            viewportWidth: document.documentElement.clientWidth,
            viewportHeight: document.documentElement.clientHeight,
            previewWidth: Math.round(rect.width),
            previewHeight: Math.round(rect.height)
        },
        tabs: tabs(),
        scrolls: scrolls()
    };
}

function inspect(options) {
    requireCurrent();
    options = options || {};
    var needle = String(options.query || '').trim().toLocaleLowerCase();
    var tabRows = tabs();
    var parents = [];
    return current.outline.map(function (item) {
        var id = String(item.id || '');
        var depth = Number(item.depth || 0);
        parents.length = depth;
        var node = findDom(id);
        var tab = tabRows.find(function (row) { return row.pageId === id; });
        var row = {
            id: id,
            name: item.name || '',
            caption: item.title || item.caption || item.name || '',
            tag: item.tag || item.kind || item.type || '',
            depth: depth,
            parentId: depth > 0 ? (parents[depth - 1] || '') : '',
            line: item.line || null,
            visible: tab ? true : visible(node),
            activePage: tab ? !!tab.active : false
        };
        parents[depth] = id;
        return row;
    }).filter(function (row) {
        if (options.visibleOnly && !row.visible) return false;
        if (!needle) return true;
        return [row.id, row.name, row.caption, row.tag].join('\n').toLocaleLowerCase().indexOf(needle) >= 0;
    });
}

function selectElement(id) {
    var item = byId(id);
    if (!item) fail('Unknown element_id: ' + id);
    var p = provider(current.format);
    if (!p.viewer.highlight) fail('The active renderer does not support selection.');
    var hit = p.viewer.highlight(host, String(id));
    current.selectedId = String(id);
    return { found: !!hit, element: item, state: state() };
}

function switchTab(pageId, pagesId) {
    if (requireCurrent().format !== 'form') fail('switch_tab is available only for Form.xml previews.');
    var allPages = modelPages();
    var matches = [];
    Object.keys(allPages).forEach(function (ownerId) {
        allPages[ownerId].forEach(function (page) {
            if (itemId(page) === String(pageId) && (!pagesId || ownerId === String(pagesId))) {
                matches.push({ pagesId: ownerId, page: page });
            }
        });
    });
    if (!matches.length) fail('Unknown page_id' + (pagesId ? ' for pages_id ' + pagesId : '') + ': ' + pageId);
    if (matches.length > 1) fail('page_id is ambiguous; provide pages_id. Candidates: ' + matches.map(function (m) { return m.pagesId; }).join(', '));
    root.FormPreview.highlight(host, String(pageId));
    current.selectedId = String(pageId);
    return state();
}

function findScrollTarget(target, elementId) {
    if (target === 'document') return current.format === 'form' ? host.querySelector('.fp-body') : host.querySelector('.tp-scroll');
    if (target === 'active-page') {
        if (elementId) {
            var pages = findDom(elementId);
            return pages && pages.querySelector('.fp-pages-active-panel');
        }
        var panels = host.querySelectorAll('.fp-pages-active-panel');
        return panels.length ? panels[panels.length - 1] : null;
    }
    if (!elementId) fail('element_id is required for target ' + target + '.');
    var owner = findDom(elementId);
    if (!owner) fail('Element is not visible: ' + elementId);
    if (target === 'table') return owner.querySelector('.fp-table-mock');
    if (target === 'spreadsheet') return owner.querySelector('.fp-spreadsheet-viewport');
    fail('Unknown scroll target: ' + target);
}

function scroll(options) {
    requireCurrent();
    var node = findScrollTarget(options.target, options.elementId || '');
    if (!node) fail('Scrollable target is not available in the current view.');
    var before = scrollInfo(node, options.target, options.elementId);
    if (typeof options.x === 'number') node.scrollLeft = options.x;
    else node.scrollLeft += Number(options.deltaX || 0);
    if (typeof options.y === 'number') node.scrollTop = options.y;
    else node.scrollTop += Number(options.deltaY || 0);
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
    return { before: before, after: scrollInfo(node, options.target, options.elementId), state: state() };
}

function elementSelector(id) {
    var node = findDom(id);
    if (!node) fail('Element is not visible: ' + id);
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return '[data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]';
}

root.AgentViewer = {
    ready: true,
    load: load,
    state: state,
    inspect: inspect,
    selectElement: selectElement,
    switchTab: switchTab,
    scroll: scroll,
    elementSelector: elementSelector
};
})(window);
