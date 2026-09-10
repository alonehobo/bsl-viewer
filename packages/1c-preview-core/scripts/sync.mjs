/* Fans the shared core out to every host that keeps its copies on disk rather
 * than building them into a dist/ of its own:
 *
 *   web/                                  the Total Commander plugin, which is
 *                                         compiled by build.bat and has no npm
 *                                         build of its own
 *   1c-form-viewer-vscode/media/          the extension's webview assets
 *   1c-form-viewer-vscode/core/           the extension's Node-side helper
 *   1c-form-viewer/src/core/              the MCP server's Node-side helper,
 *                                         where tsc can see it
 *
 * Every one of those copies is generated and git-ignored: edit the file in
 * packages/1c-preview-core, never the copy. `npm run verify --workspace
 * 1c-preview-core` fails the build if a copy has drifted.
 *
 * The MCP server's dist/web is not synced here — it is a build output, filled
 * by that package's own copy-assets step from the same manifest. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserAssets, browserPath, nodeFiles, nodePath, readSprite } from '../manifest.mjs';
import { repositoryDir, SPRITE_BEGIN, SPRITE_END, spriteBlock } from './paths.mjs';

async function copyInto(directory, names, resolve) {
  await mkdir(directory, { recursive: true });
  for (const name of names) await copyFile(resolve(name), path.join(directory, name));
}

/* The plugin's shell markup is hand-written and stays that way; only the
 * sprite between the markers is generated, so re-running sync is a no-op
 * unless the icons themselves changed. */
async function injectSprite(htmlPath) {
  const html = await readFile(htmlPath, 'utf8');
  const begin = html.indexOf(SPRITE_BEGIN);
  const end = html.indexOf(SPRITE_END);
  if (begin < 0 || end < 0) {
    throw new Error(`${htmlPath} has no ${SPRITE_BEGIN} / ${SPRITE_END} markers`);
  }
  const next = html.slice(0, begin) + spriteBlock(await readSprite()) + html.slice(end + SPRITE_END.length);
  if (next === html) return false;
  await writeFile(htmlPath, next, 'utf8');
  return true;
}

const vscodeDir = path.join(repositoryDir, 'packages', '1c-form-viewer-vscode');
const mcpDir = path.join(repositoryDir, 'packages', '1c-form-viewer');

await copyInto(path.join(repositoryDir, 'web'), browserAssets, browserPath);
await copyInto(path.join(vscodeDir, 'media'), browserAssets, browserPath);
await copyInto(path.join(vscodeDir, 'core'), nodeFiles, nodePath);
await copyInto(path.join(mcpDir, 'src', 'core'), nodeFiles, nodePath);
const spriteChanged = await injectSprite(path.join(repositoryDir, 'web', 'viewer.html'));

process.stdout.write(`1c-preview-core: synced ${browserAssets.length} browser and ${nodeFiles.length} node files${spriteChanged ? ', icon sprite updated' : ''}\n`);
