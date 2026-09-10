import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(packageDir, '..', '..', '..');
const sourceDir = path.join(rootDir, 'web');
const targetDir = path.join(packageDir, '..', 'media');
const assets = ['xml-util.js', 'form-preview.js', 'template-preview.js', 'mxl-preview.js', 'viewer.css'];

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
for (const asset of assets) await cp(path.join(sourceDir, asset), path.join(targetDir, asset));
await cp(path.join(packageDir, '..', 'ui', 'extension.css'), path.join(targetDir, 'extension.css'));
await cp(path.join(packageDir, '..', 'ui', 'webview.js'), path.join(targetDir, 'webview.js'));
