const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED = new Set(['.xml', '.mxl']);
const panels = new Map();

function isSupported(uri) {
  return uri && SUPPORTED.has(path.extname(uri.fsPath).toLowerCase());
}

function normalizePath(uri) {
  return uri.toString();
}

function decodeText(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { content: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { content: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2);
    const swapped = new Uint8Array(body.length - (body.length % 2));
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return { content: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf16be' };
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
  } catch {
    return { content: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  }
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return decodeText(bytes);
}

async function readObjectMeta(uri) {
  if (path.basename(uri.fsPath).toLowerCase() !== 'form.xml') return '';
  const extDir = path.dirname(uri.fsPath);
  if (path.basename(extDir).toLowerCase() !== 'ext') return '';
  const formDir = path.dirname(extDir);
  const formsDir = path.dirname(formDir);
  if (path.basename(formsDir).toLowerCase() !== 'forms') return '';
  const objectDir = path.dirname(formsDir);
  const objectName = path.basename(objectDir);
  const candidates = [
    path.join(path.dirname(objectDir), `${objectName}.xml`),
    path.join(objectDir, `${objectName}.xml`),
  ];
  for (const candidate of candidates) {
    try {
      const value = await readText(vscode.Uri.file(candidate));
      if (value.content.includes('MetaDataObject')) return value.content;
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
<link rel="stylesheet" href="${media('viewer.css')}">
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
<script nonce="${nonce}" src="${media('xml-util.js')}"></script>
<script nonce="${nonce}" src="${media('form-preview.js')}"></script>
<script nonce="${nonce}" src="${media('template-preview.js')}"></script>
<script nonce="${nonce}" src="${media('mxl-preview.js')}"></script>
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

function openPreview(context, inputUri) {
  const uri = inputUri || vscode.window.activeTextEditor?.document.uri;
  if (!isSupported(uri)) {
    void vscode.window.showWarningMessage('Выберите файл Form.xml, Template.xml или MXL.');
    return;
  }
  const key = normalizePath(uri);
  const previous = panels.get(key);
  if (previous) {
    previous.panel.reveal(vscode.ViewColumn.Beside);
    void sendDocument(previous);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    '1cFormViewer.preview',
    `1C: ${path.basename(uri.fsPath)}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    },
  );
  const panelState = { panel, uri };
  panels.set(key, panelState);
  panel.webview.html = htmlFor(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage((message) => {
    if (message?.type === 'ready' || message?.type === 'reload') {
      void sendDocument(panelState);
    } else if (message?.type === 'open-source') {
      void revealSource(uri);
    } else if (message?.type === 'select') {
      void revealSource(uri, Number(message.line));
    }
  }, undefined, context.subscriptions);
  panel.onDidDispose(() => panels.delete(key), undefined, context.subscriptions);

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(uri.fsPath), path.basename(uri.fsPath)),
  );
  watcher.onDidChange((changed) => {
    if (normalizePath(changed) === key) void sendDocument(panelState);
  }, undefined, context.subscriptions);
  panel.onDidDispose(() => watcher.dispose(), undefined, context.subscriptions);
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
    vscode.commands.registerCommand('1cFormViewer.openPreview', (uri) => openPreview(context, uri)),
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
