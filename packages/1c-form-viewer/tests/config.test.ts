import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseCliArgs, parseViewport } from '../src/config.js';

test('CLI parses repeated roots and viewer options', () => {
  const cwd = path.resolve('C:\\workspace');
  const config = parseCliArgs([
    '--stdio', '--root', 'one', '--root', 'two', '--viewport', '1280x720',
    '--headless', '--max-bytes', '1024',
  ], cwd);
  assert.equal(config.stdio, true);
  assert.equal(config.headless, true);
  assert.deepEqual(config.viewport, { width: 1280, height: 720 });
  assert.equal(config.maxBytes, 1024);
  assert.deepEqual(config.roots, [path.resolve(cwd, 'one'), path.resolve(cwd, 'two')]);
});

test('CLI defaults the allowed root to cwd', () => {
  const cwd = path.resolve('sandbox');
  assert.deepEqual(parseCliArgs(['--stdio'], cwd).roots, [cwd]);
});

test('viewport and numeric validation reject malformed values', () => {
  assert.throws(() => parseViewport('wide'), /WIDTHxHEIGHT/);
  assert.throws(() => parseViewport('100x100'), /between/);
  assert.throws(() => parseCliArgs(['--max-bytes', '0']), /positive integer/);
  assert.throws(() => parseCliArgs(['--wat']), /Unknown option/);
});

