/* Fails if any generated copy of the shared core has drifted from the core
 * itself — the guard that makes "edit core, never the copy" enforceable rather
 * than a convention people remember. Run it in CI and before every release. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { browserAssets, browserPath, nodeFiles, nodePath, readSprite } from '../manifest.mjs';
import { repositoryDir, SPRITE_BEGIN, SPRITE_END, spriteBlock } from './paths.mjs';

const problems = [];

async function compare(directory, names, resolve) {
  for (const name of names) {
    const target = path.join(directory, name);
    const [source, copy] = await Promise.all([
      readFile(resolve(name)),
      readFile(target).catch(() => null),
    ]);
    if (!copy) problems.push(`missing generated copy: ${path.relative(repositoryDir, target)}`);
    else if (!source.equals(copy)) problems.push(`stale generated copy: ${path.relative(repositoryDir, target)}`);
  }
}

const vscodeDir = path.join(repositoryDir, 'packages', '1c-form-viewer-vscode');
const mcpDir = path.join(repositoryDir, 'packages', '1c-form-viewer');

await compare(path.join(repositoryDir, 'web'), browserAssets, browserPath);
await compare(path.join(vscodeDir, 'media'), browserAssets, browserPath);
await compare(path.join(vscodeDir, 'core'), nodeFiles, nodePath);
await compare(path.join(mcpDir, 'src', 'core'), nodeFiles, nodePath);

const viewerHtml = path.join(repositoryDir, 'web', 'viewer.html');
const html = await readFile(viewerHtml, 'utf8');
const begin = html.indexOf(SPRITE_BEGIN);
const end = html.indexOf(SPRITE_END);
if (begin < 0 || end < 0) problems.push(`web/viewer.html has no ${SPRITE_BEGIN} / ${SPRITE_END} markers`);
else if (html.slice(begin, end + SPRITE_END.length) !== spriteBlock(await readSprite())) {
  problems.push('web/viewer.html icon sprite differs from packages/1c-preview-core/browser/icons.svg');
}

if (problems.length) {
  process.stderr.write(`1c-preview-core: ${problems.length} problem(s)\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.stderr.write('Run: npm run sync --workspace 1c-preview-core\n');
  process.exitCode = 1;
} else {
  process.stdout.write('1c-preview-core: all generated copies match\n');
}
