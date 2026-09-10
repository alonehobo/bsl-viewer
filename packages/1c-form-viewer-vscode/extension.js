const vscode = require('vscode');
const path = require('node:path');

/* Encodings, form-descriptor resolution and object metadata are the same 1C
 * rules the MCP server applies, so they live in packages/1c-preview-core and
 * are synced into core/ at build time — never reimplemented here. */
const core = require('./core/document.cjs');
const assets = require('./media/assets.json');

const panels = new Map();

function isSupported(uri) {
  return !!uri && core.isSupportedExtension(uri.fsPath);
}

function normalizePath(uri) {
  return uri.toString();
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return core.decodeText(bytes);
}

/* `Forms/ФормаСписка.xml` is the descriptor; the layout the renderers want is
 * `Forms/ФормаСписка/Ext/Form.xml`. Opening the descriptor should show the
 * form, the way it already does over MCP. Falls back to the original file when
 * there is no layout beside it. */
async function resolveDocumentUri(uri) {
  const layout = core.formLayoutFor(uri.fsPath);
  if (!layout) return uri;
  const candidate = vscode.Uri.file(layout);
  try {
    const stat = await vscode.workspace.fs.stat(candidate);
    return stat.type === vscode.FileType.File ? candidate : uri;
  } catch {
    return uri;
  }
}

async function readObjectMeta(uri) {
  for (const candidate of core.objectMetaCandidates(uri.fsPath)) {
    try {
      const value = await readText(vscode.Uri.file(candidate));
      if (value.content.includes(core.OBJECT_META_MARKER)) return value.content;
    } catch {
      // Object metadata is optional for the visual preview.
    }
  }
  return '';
}

function createNonce() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function htmlFor(webview, extensionUri) {
  const nonce = createNonce();
  const media = (name) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name));
  /* Asset names and their load order come from the generated media/assets.json,
   * written from packages/1c-preview-core/assets.manifest.json — the only place
   * a renderer is ever named. */
  const styleTags = assets.styles
    .map((name) => `<link rel="stylesheet" href="${media(name)}">`)
    .join('');
  const scriptTags = assets.scripts
    .map((name) => `<script nonce="${nonce}" src="${media(name)}"></script>`)
    .join('');
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styleTags}
<link rel="stylesheet" href="${media('extension.css')}">
<title>1C Form Viewer</title>
</head>
<body>
<header class="toolbar">
  <span id="document-name" class="document-name">1C Form Viewer</span>
  <span id="document-kind" class="document-kind"></span>
  <span class="toolbar-spacer"></span>
  <button id="reload" type="button">Перечитать</button>
  <button id="open-source" type="button">Открыть исходник</button>
</header>
<div id="message" class="message" hidden></div>
<main>
  <aside class="outline-pane">
    <div class="outline-title">Структура</div>
    <div id="outline" class="outline-list"></div>
  </aside>
<section id="preview-root" class="preview-pane" aria-label="Визуальное представление"></section>
</main>
${scriptTags}
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body>
</html>`;
}

async function sendDocument(panelState) {
  try {
    const text = await readText(panelState.uri);
    const objectMeta = await readObjectMeta(panelState.uri);
    await panelState.panel.webview.postMessage({
      type: 'load',
      path: panelState.uri.fsPath,
      name: path.basename(panelState.uri.fsPath),
      content: text.content,
      encoding: text.encoding,
      objectMeta,
    });
  } catch (error) {
    await panelState.panel.webview.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function revealSource(uri, line) {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
  if (Number.isInteger(line) && line > 0) {
    const position = new vscode.Position(line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

async function openPreview(context, inputUri) {
  const selected = inputUri || vscode.window.activeTextEditor?.document.uri;
  if (!isSupported(selected)) {
    void vscode.window.showWarningMessage('Выберите файл Form.xml, Template.xml или MXL.');
    return;
  }
  const uri = await resolveDocumentUri(selected);
  const key = normalizePath(uri);
  const previous = panels.get(key);
  if (previous) {
    previous.panel.reveal(vscode.ViewColumn.Active);
    void sendDocument(previous);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    '1cFormViewer.preview',
    `1C: ${path.basename(uri.fsPath)}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    },
  );
  const panelState = { panel, uri };
  panels.set(key, panelState);
  panel.webview.html = htmlFor(panel.webview, context.extensionUri);
  /* Everything below belongs to this panel, not to the extension: collecting it
   * on context.subscriptions would keep one entry per panel ever opened alive
   * until the window closes. */
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(uri.fsPath), path.basename(uri.fsPath)),
  );
  const owned = [
    panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'ready' || message?.type === 'reload') {
        void sendDocument(panelState);
      } else if (message?.type === 'open-source') {
        void revealSource(uri);
      } else if (message?.type === 'select') {
        void revealSource(uri, Number(message.line));
      }
    }),
    watcher.onDidChange((changed) => {
      if (normalizePath(changed) === key) void sendDocument(panelState);
    }),
    watcher,
  ];
  panel.onDidDispose(() => {
    panels.delete(key);
    for (const disposable of owned) disposable.dispose();
  });
  void sendDocument(panelState);
}

function activate(context) {
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = '1cFormViewer.openPreview';
  statusItem.text = '$(preview) 1C Preview';
  statusItem.tooltip = 'Открыть визуальное представление 1С';
  const updateStatusItem = () => {
    if (isSupported(vscode.window.activeTextEditor?.document.uri)) statusItem.show();
    else statusItem.hide();
  };
  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('1cFormViewer.openPreview', (uri) => void openPreview(context, uri)),
    vscode.window.onDidChangeActiveTextEditor(updateStatusItem),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const state = panels.get(normalizePath(document.uri));
      if (state) void sendDocument(state);
    }),
  );
  updateStatusItem();
}

function deactivate() {
  panels.clear();
}

module.exports = { activate, deactivate };
