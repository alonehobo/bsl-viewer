import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');
const sourceWeb = path.join(repositoryDir, 'web');
const targetWeb = path.join(packageDir, 'dist', 'web');
const rendererAssets = [
  'xml-util.js',
  'form-preview.js',
  'template-preview.js',
  'mxl-preview.js',
  'viewer.css',
];
const expected = [...rendererAssets, 'agent-viewer.css', 'agent-viewer.js', 'index.html'].sort();

for (const name of rendererAssets) {
  const [source, built] = await Promise.all([
    readFile(path.join(sourceWeb, name)),
    readFile(path.join(targetWeb, name)),
  ]);
  if (!source.equals(built)) throw new Error(`Built renderer asset differs from source: ${name}`);
}

const actual = (await readdir(targetWeb, { withFileTypes: true })).map((entry) => {
  if (!entry.isFile()) throw new Error(`Unexpected directory in dist/web: ${entry.name}`);
  return entry.name;
}).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected dist/web contents: ${actual.join(', ')}`);
}

const generatedHtml = await readFile(path.join(targetWeb, 'index.html'), 'utf8');
if (!generatedHtml.includes('<symbol ') || generatedHtml.includes('<!-- ICON_SPRITE -->')) {
  throw new Error('Generated index.html does not contain the extracted viewer icon sprite');
}

const forbidden = /(?:monaco|\.exe\b|\.wlx\d*\b|testdata|fixtures)/i;
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (forbidden.test(path.relative(packageDir, absolute))) {
      throw new Error(`Forbidden package artifact: ${absolute}`);
    }
    if (entry.isDirectory()) await walk(absolute);
  }
};
await walk(path.join(packageDir, 'dist'));

