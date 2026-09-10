/* Adds this extension's own webview shell to media/, which the core sync has
 * already filled with the shared renderers, and writes the generated
 * media/assets.json so extension.js never hardcodes an asset name or a load
 * order of its own. */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scripts, styles } from '1c-preview-core/manifest.mjs';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mediaDir = path.join(packageDir, 'media');

await mkdir(mediaDir, { recursive: true });
for (const name of ['extension.css', 'webview.js']) {
  await copyFile(path.join(packageDir, 'ui', name), path.join(mediaDir, name));
}
await writeFile(
  path.join(mediaDir, 'assets.json'),
  `${JSON.stringify({ scripts, styles }, null, 2)}\n`,
  'utf8',
);
