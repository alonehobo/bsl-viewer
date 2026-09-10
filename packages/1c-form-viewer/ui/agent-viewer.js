(function (root) {
'use strict';

var host = document.getElementById('preview');
var empty = document.getElementById('agent-empty');
var pathLabel = document.getElementById('agent-path');
var formatLabel = document.getElementById('agent-format');
var current = null;

function fail(message) { throw new Error(message); }
function itemId(item) { return item && (item.id || item.name) ? String(item.id || item.name) : ''; }

/* Which module claims a file, and which one draws it, is decided by the shared
 * registry in packages/1c-preview-core/browser/providers.js — the same one the
 * Total Commander viewer and the VS Code webview use. Provider ids are the
 * `format` values this page reports back over MCP. */
var Providers = root.PreviewProviders;

function providerFor(format) {
    var entry = Providers.byId(format);
    if (!entry) fail('Unknown preview format: ' + format);
    return entry;
}

function renderCurrent() {
    var entry = providerFor(current.format);
    host.hidden = false;
    empty.hidden = true;
    Providers.view(entry).render(current.model, host, {
        onSelect: function (item) { current.selectedId = itemId(item); }
    });
    formatLabel.textContent = entry.label;
    pathLabel.textContent = current.path;
    pathLabel.title = current.path;
}

function load(input) {
    var entry = Providers.detect(input.content, {});
    if (!entry) fail(Providers.unsupportedMessage);
    var parsed = Providers.parse(entry, input.content, { objectMeta: input.objectMeta });
    if (!parsed || parsed.error || !parsed.model) fail((parsed && parsed.error) || 'The renderer did not produce a model.');
    current = {
        format: entry.id,
        path: input.path,
        content: input.content,
        objectMeta: input.objectMeta || '',
        model: parsed.model,
        outline: Providers.view(entry).outline(parsed.model, input.content) || [],
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
    var view = Providers.view(providerFor(current.format));
    if (!view.highlight) fail('The active renderer does not support selection.');
    var hit = view.highlight(host, String(id));
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

function captureNode(node) {
    if (!node) fail('Capture target is not available.');
    var rect = node.getBoundingClientRect();
    var width = Math.max(1, Math.ceil(node === document.documentElement || node === document.body ? document.documentElement.clientWidth : rect.width));
    var height = Math.max(1, Math.ceil(node === document.documentElement || node === document.body ? document.documentElement.clientHeight : rect.height));
    var clone = node.cloneNode(true);
    var allOriginal = [node].concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    var allClone = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    for (var i = 0; i < allOriginal.length && i < allClone.length; i++) {
        var computed = getComputedStyle(allOriginal[i]);
        for (var j = 0; j < computed.length; j++) {
            var property = computed[j];
            allClone[i].style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
        }
    }
    var wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = 'width:' + width + 'px;height:' + height + 'px;overflow:hidden;background:' + getComputedStyle(document.body).backgroundColor + ';';
    if (node === document.documentElement || node === document.body) {
        while (clone.firstChild) wrapper.appendChild(clone.firstChild);
    } else {
        wrapper.appendChild(clone);
    }
    var markup = new XMLSerializer().serializeToString(wrapper);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
    return new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () {
            var canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            var context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            var result = canvas.toDataURL('image/png');
            resolve({ data: result.substring(result.indexOf(',') + 1), mimeType: 'image/png' });
        };
        image.onerror = function () { reject(new Error('The browser could not render the preview as PNG.')); };
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
}

function capture(scope, elementId) {
    if (scope === 'element') {
        if (!elementId) fail('element_id is required when scope is element.');
        return captureNode(findDom(elementId));
    }
    return captureNode(scope === 'document' ? document.body : document.documentElement);
}

root.AgentViewer = {
    ready: true,
    load: load,
    state: state,
    inspect: inspect,
    selectElement: selectElement,
    switchTab: switchTab,
    scroll: scroll,
    elementSelector: elementSelector,
    capture: capture
};

/* Internal mode: the page pulls the document and its commands over HTTP instead
 * of being driven from outside.
 *
 * Only the native C++ server implements the command channel — the Node server
 * drives this same page through the browser automation API and serves no
 * `command` endpoint. So the poll stops itself the first time the endpoint is
 * absent rather than issuing a 404 five times a second forever. */
if (new URLSearchParams(window.location.search).get('internal') === '1') {
    var lastRevision = -1;
    var commandBusy = false;
    var commandTimer = 0;

    function postResult(command, result) {
        return fetch('result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: command.id, ok: true, value: result })
        });
    }

    function postError(command, error) {
        return fetch('result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: command.id, ok: false, error: error instanceof Error ? error.message : String(error) })
        });
    }

    function executeCommand(command) {
        var args = command.args || {};
        try {
            var value;
            if (command.op === 'inspect') value = { elements: root.AgentViewer.inspect(args), state: root.AgentViewer.state() };
            else if (command.op === 'select') value = root.AgentViewer.selectElement(args.elementId);
            else if (command.op === 'switchTab') value = root.AgentViewer.switchTab(args.pageId, args.pagesId);
            else if (command.op === 'scroll') value = root.AgentViewer.scroll(args);
            else if (command.op === 'capture') return root.AgentViewer.capture(args.scope, args.elementId).then(function (image) { return postResult(command, image); }, function (error) { return postError(command, error); });
            else if (command.op === 'state') value = root.AgentViewer.state();
            else fail('Unknown browser command: ' + command.op);
            return postResult(command, value).catch(function (error) { return postError(command, error); });
        } catch (error) {
            return postError(command, error);
        }
    }

    function pollCommand() {
        if (commandBusy) return;
        commandBusy = true;
        fetch('command', { cache: 'no-store' })
            .then(function (response) {
                if (response.status === 404) {
                    window.clearInterval(commandTimer);
                    return null;
                }
                return response.status === 204 ? null : response.json();
            })
            .then(function (command) { return command ? executeCommand(command) : null; })
            .catch(function () {})
            .finally(function () { commandBusy = false; });
    }

    function refreshState() {
        fetch('state-meta.json', { cache: 'no-store' })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (meta) {
                if (!meta || !meta.available || meta.revision === lastRevision) return null;
                return fetch('state.json', { cache: 'no-store' })
                    .then(function (response) { return response.ok ? response.json() : null; })
                    .then(function (input) {
                        if (input) {
                            root.AgentViewer.load(input);
                            lastRevision = meta.revision;
                        }
                    });
            })
            .catch(function () {});
    }

    refreshState();
    window.setInterval(refreshState, 300);
    commandTimer = window.setInterval(pollCommand, 120);
}
})(window);
