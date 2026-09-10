import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');
const sourceWeb = path.join(repositoryDir, 'web');
const sourceUi = path.join(packageDir, 'ui');
const targetWeb = path.join(packageDir, 'dist', 'web');
const rendererAssets = [
  'xml-util.js',
  'form-preview.js',
  'template-preview.js',
  'mxl-preview.js',
  'viewer.css',
];

await mkdir(targetWeb, { recursive: true });
for (const name of rendererAssets) {
  await copyFile(path.join(sourceWeb, name), path.join(targetWeb, name));
}
await copyFile(path.join(sourceUi, 'agent-viewer.js'), path.join(targetWeb, 'agent-viewer.js'));
await copyFile(path.join(sourceUi, 'agent-viewer.css'), path.join(targetWeb, 'agent-viewer.css'));

const viewerHtml = await readFile(path.join(sourceWeb, 'viewer.html'), 'utf8');
const sprite = viewerHtml.match(/<svg\s+style="display:none"\s+aria-hidden="true">[\s\S]*?<\/svg>/i)?.[0];
if (!sprite) throw new Error('Could not extract the SVG icon sprite from web/viewer.html');
const template = await readFile(path.join(sourceUi, 'index.template.html'), 'utf8');
if (!template.includes('<!-- ICON_SPRITE -->')) throw new Error('UI template has no icon sprite placeholder');
await writeFile(path.join(targetWeb, 'index.html'), template.replace('<!-- ICON_SPRITE -->', sprite), 'utf8');

