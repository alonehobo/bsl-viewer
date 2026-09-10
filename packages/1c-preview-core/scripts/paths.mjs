import path from 'node:path';
import { coreDir } from '../manifest.mjs';

export const repositoryDir = path.resolve(coreDir, '..', '..');

export const SPRITE_BEGIN = '<!-- ICON_SPRITE:BEGIN generated from packages/1c-preview-core/browser/icons.svg -->';
export const SPRITE_END = '<!-- ICON_SPRITE:END -->';

/** The generated block as it appears in a host's shell markup. */
export function spriteBlock(sprite) {
  return `${SPRITE_BEGIN}\n${sprite.trim()}\n${SPRITE_END}`;
}
