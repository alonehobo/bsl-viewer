(function () {
  'use strict';

  const api = acquireVsCodeApi();
  const preview = document.getElementById('preview-root');
  const outline = document.getElementById('outline');
  const message = document.getElementById('message');
  const name = document.getElementById('document-name');
  const kind = document.getElementById('document-kind');
  let active = null;
  let outlineItems = [];

  function showError(text) {
    preview.innerHTML = '';
    outline.innerHTML = '';
    message.textContent = text;
    message.hidden = !text;
  }

  function titleOf(item) {
    return item.title || item.name || item.tag || item.id || 'Без имени';
  }

  function renderOutline(items) {
    outline.innerHTML = '';
    outlineItems = items || [];
    for (const item of outlineItems) {
      const row = document.createElement('div');
      row.className = 'outline-item';
      row.dataset.id = item.id || item.name || '';
      row.style.paddingLeft = `${8 + (item.depth || 0) * 14}px`;
      const label = document.createElement('span');
      label.textContent = titleOf(item);
      const line = document.createElement('span');
      line.className = 'outline-line';
      line.textContent = item.line ? String(item.line) : '';
      row.append(label, line);
      row.addEventListener('click', function () {
        for (const other of outline.querySelectorAll('.selected')) other.classList.remove('selected');
        row.classList.add('selected');
        if (active && active.viewer && item.id) active.viewer.highlight(preview, item.id);
        api.postMessage({ type: 'select', line: item.line || 0 });
      });
      outline.appendChild(row);
    }
  }

  /* Which module claims a file, and which one draws it, comes from the shared
   * registry in packages/1c-preview-core/browser/providers.js, so this webview
   * recognises exactly what the Total Commander viewer and the MCP server do. */
  function loadDocument(payload) {
    message.hidden = true;
    name.textContent = payload.name || 'Документ';
    kind.textContent = '';
    preview.innerHTML = '';
    active = null;
    try {
      const entry = PreviewProviders.detect(payload.content, {});
      if (!entry) {
        showError(PreviewProviders.unsupportedMessage);
        return;
      }
      const result = PreviewProviders.parse(entry, payload.content, { objectMeta: payload.objectMeta });
      if (!result || result.error || !result.model) {
        showError((result && result.error) || 'Не удалось построить модель документа.');
        return;
      }
      active = { viewer: PreviewProviders.view(entry), kind: entry.label };
      kind.textContent = payload.encoding ? `${entry.label} · ${payload.encoding}` : entry.label;
      active.viewer.render(result.model, preview, {
        onSelect: function (selected) {
          if (!selected || !selected.id) return;
          active.viewer.highlight(preview, selected.id);
        },
      });
      renderOutline(active.viewer.outline(result.model, payload.content));
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  document.getElementById('reload').addEventListener('click', function () {
    api.postMessage({ type: 'reload' });
  });
  document.getElementById('open-source').addEventListener('click', function () {
    api.postMessage({ type: 'open-source' });
  });
  window.addEventListener('message', function (event) {
    const payload = event.data || {};
    if (payload.type === 'load') loadDocument(payload);
    if (payload.type === 'error') showError(payload.message || 'Не удалось прочитать файл.');
  });
  api.postMessage({ type: 'ready' });
}());
