import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evaluateSession } from '../scripts/memory-gate.mjs';

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'not1c-memory-gate-test-'));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function touchFile(filePath, date) {
  fs.utimesSync(filePath, date, date);
}

test('skips template projects', () => {
  const workspace = makeTempWorkspace();
  writeFile(path.join(workspace, '.memory', 'PROJECT.md'), '# Проект\n\n> Шаблонный файл.\n\n## Статус\nНе инициализировано\n');
  writeFile(path.join(workspace, 'src', 'app.ts'), 'export const demo = 1;\n');

  const start = new Date(Date.now() - 60_000);
  touchFile(path.join(workspace, 'src', 'app.ts'), new Date());

  const result = evaluateSession(workspace, start.toISOString());
  assert.equal(result.status, 'skip');
});

test('fails when project changed but memory was not updated', () => {
  const workspace = makeTempWorkspace();
  writeFile(path.join(workspace, '.memory', 'PROJECT.md'), '# Проект\n\n## Статус\nИнициализировано\n');
  writeFile(path.join(workspace, '.memory', 'ACTIVE.md'), '# Активная задача\n\n## Статус\nВ работе\n');
  writeFile(path.join(workspace, 'src', 'app.ts'), 'export const demo = 1;\n');

  const start = new Date(Date.now() - 60_000);
  const oldDate = new Date(start.getTime() - 60_000);
  touchFile(path.join(workspace, '.memory', 'PROJECT.md'), oldDate);
  touchFile(path.join(workspace, '.memory', 'ACTIVE.md'), oldDate);
  touchFile(path.join(workspace, 'src', 'app.ts'), new Date());

  const result = evaluateSession(workspace, start.toISOString());
  assert.equal(result.status, 'fail');
  assert.equal(result.exitCode, 2);
});

test('passes when project and memory changed in the same session', () => {
  const workspace = makeTempWorkspace();
  writeFile(path.join(workspace, '.memory', 'PROJECT.md'), '# Проект\n\n## Статус\nИнициализировано\n');
  writeFile(path.join(workspace, '.memory', 'ACTIVE.md'), '# Активная задача\n\n## Change ID\n2026-04-05-test\n');
  writeFile(path.join(workspace, '.memory', 'CHANGELOG.md'), '# История изменений\n');
  writeFile(path.join(workspace, 'src', 'app.ts'), 'export const demo = 1;\n');

  const start = new Date(Date.now() - 60_000);
  const oldDate = new Date(start.getTime() - 60_000);
  const now = new Date();
  touchFile(path.join(workspace, '.memory', 'PROJECT.md'), oldDate);
  touchFile(path.join(workspace, '.memory', 'ACTIVE.md'), now);
  touchFile(path.join(workspace, '.memory', 'CHANGELOG.md'), now);
  touchFile(path.join(workspace, 'src', 'app.ts'), now);

  const result = evaluateSession(workspace, start.toISOString());
  assert.equal(result.status, 'ok');
  assert.equal(result.exitCode, 0);
});
