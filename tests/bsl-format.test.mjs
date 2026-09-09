/* Tests for web/bsl-format.js — the only module that rewrites the user's own
 * source, so every case here is either "output is exactly this" or "the
 * formatter must not touch this". */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BslFormatter = loadWebModules(root, ['bsl-format.js']).window.BslFormatter;

/* viewer.js calls format(text, range, { eol }) with no feature flags, so the
 * no-options path is the one that actually ships. */
function fmt(text, options) {
  return BslFormatter.format(text, null, options || {})[0].text;
}

function lines(...rows) {
  return rows.join('\n');
}

function assertStable(text, options) {
  const once = fmt(text, options);
  assert.equal(fmt(once, options), once, 'formatting is not idempotent');
  return once;
}

// --- shipping default: indentation only ------------------------------------

test('indents nested blocks with tabs', () => {
  const src = lines(
    'Процедура Тест(А, Б) Экспорт',
    'Если А > 0 Тогда',
    'Для Каждого Э Из Б Цикл',
    'Сообщить("привет");',
    'КонецЦикла;',
    'Иначе',
    'Попытка',
    'Х = 1;',
    'Исключение',
    'Х = 2;',
    'КонецПопытки;',
    'КонецЕсли;',
    'КонецПроцедуры'
  );
  assert.equal(assertStable(src), lines(
    'Процедура Тест(А, Б) Экспорт',
    '\tЕсли А > 0 Тогда',
    '\t\tДля Каждого Э Из Б Цикл',
    '\t\t\tСообщить("привет");',
    '\t\tКонецЦикла;',
    '\tИначе',
    '\t\tПопытка',
    '\t\t\tХ = 1;',
    '\t\tИсключение',
    '\t\t\tХ = 2;',
    '\t\tКонецПопытки;',
    '\tКонецЕсли;',
    'КонецПроцедуры'
  ));
});

test('English keywords indent like their Russian counterparts', () => {
  const src = lines('Procedure P()', 'If A Then', 'While B Do', 'X = 1;', 'EndDo;', 'EndIf;', 'EndProcedure');
  assert.equal(assertStable(src), lines(
    'Procedure P()', '\tIf A Then', '\t\tWhile B Do', '\t\t\tX = 1;', '\t\tEndDo;', '\tEndIf;', 'EndProcedure'
  ));
});

test('re-indenting already correct code changes nothing', () => {
  const src = lines('Процедура П()', '\tЕсли А Тогда', '\t\tБ = 1;', '\tКонецЕсли;', 'КонецПроцедуры');
  assert.equal(fmt(src), src);
});

test('collapses runs of blank lines to one, keeping single blanks', () => {
  const src = lines('Процедура П()', '', '', '', 'А = 1;', '', '', 'КонецПроцедуры');
  assert.equal(assertStable(src), lines('Процедура П()', '', '\tА = 1;', '', 'КонецПроцедуры'));
});

test('keeps the document EOL', () => {
  assert.equal(fmt('Процедура П()\r\nА=1;\r\nКонецПроцедуры'),
    'Процедура П()\r\n\tА=1;\r\nКонецПроцедуры');
  assert.equal(fmt('Процедура П()\nА=1;\nКонецПроцедуры'),
    'Процедура П()\n\tА=1;\nКонецПроцедуры');
});

test('an explicit eol option overrides the detected one', () => {
  assert.equal(fmt('Процедура П()\nА=1;\nКонецПроцедуры', { eol: '\r\n' }),
    'Процедура П()\r\n\tА=1;\r\nКонецПроцедуры');
});

test('format returns a single edit carrying the range it was given', () => {
  const range = { startLineNumber: 1, endLineNumber: 2 };
  const edits = BslFormatter.format('А = 1;', range, {});
  assert.equal(edits.length, 1);
  assert.equal(edits[0].range, range);
});

test('empty and whitespace-only input survive', () => {
  assert.equal(fmt(''), '');
  assert.equal(fmt('   '), '');
  assert.equal(fmt(null), '');
});

// --- what must never be rewritten ------------------------------------------

test('block keywords inside a string literal do not change indentation', () => {
  const src = lines('Процедура П()', 'А = "КонецПроцедуры";', 'Б = 1;', 'КонецПроцедуры');
  assert.equal(assertStable(src), lines(
    'Процедура П()', '\tА = "КонецПроцедуры";', '\tБ = 1;', 'КонецПроцедуры'
  ));
});

test('block keywords inside a comment do not change indentation', () => {
  const src = lines('Процедура П()', '// КонецПроцедуры', 'Б = 1;', 'КонецПроцедуры');
  assert.equal(assertStable(src), lines(
    'Процедура П()', '\t// КонецПроцедуры', '\tБ = 1;', 'КонецПроцедуры'
  ));
});

/* Continuation lines of a multi-line query keep their marker and inner
 * spacing; BSL ignores whitespace before the bar, so the added indent is safe. */
test('multi-line query strings keep their content', () => {
  const src = lines(
    'Процедура П()', 'Запрос.Текст =', '"ВЫБРАТЬ', '|  Ссылка', '|ИЗ', '|  Справочник.Товары";', 'КонецПроцедуры'
  );
  const out = assertStable(src);
  assert.match(out, /\|  Ссылка/);
  assert.match(out, /\|  Справочник\.Товары";/);
  assert.equal(out.replace(/^\t+/gm, ''), src);
});

test('commas inside string literals are left alone', () => {
  assert.equal(fmt('Ф(1,2,"а,б",3);', { formatSpaceAfterComma: true }), 'Ф(1, 2, "а,б", 3);');
});

// --- optional passes -------------------------------------------------------

test('formatSplitStatements puts each statement on its own line', () => {
  const src = lines('Процедура П()', 'А = 1; Б = 2; В = 3;', 'КонецПроцедуры');
  assert.equal(assertStable(src, { formatSplitStatements: true }), lines(
    'Процедура П()', '\tА = 1;', '\tБ = 2;', '\tВ = 3;', 'КонецПроцедуры'
  ));
});

test('formatJoinThen pulls a stray Тогда back onto the condition', () => {
  const src = lines('Процедура П()', 'Если А > 0', 'Тогда', 'Б = 1;', 'КонецЕсли;', 'КонецПроцедуры');
  assert.equal(assertStable(src, { formatJoinThen: true }), lines(
    'Процедура П()', '\tЕсли А > 0 Тогда', '\t\tБ = 1;', '\tКонецЕсли;', 'КонецПроцедуры'
  ));
});

test('formatAlignAssignments pads names to a common column', () => {
  const src = lines('Процедура П()', 'Длинное = 1;', 'А = 2;', 'Среднее = 3;', 'КонецПроцедуры');
  assert.equal(assertStable(src, { formatAlignAssignments: true }), lines(
    'Процедура П()', '\tДлинное = 1;', '\tА       = 2;', '\tСреднее = 3;', 'КонецПроцедуры'
  ));
});

test('formatBlankLinesAroundBlocks separates procedures', () => {
  const src = lines('Процедура А()', 'Х = 1;', 'КонецПроцедуры', 'Процедура Б()', 'Y = 2;', 'КонецПроцедуры');
  assert.equal(assertStable(src, { formatBlankLinesAroundBlocks: true }), lines(
    'Процедура А()', '', '\tХ = 1;', '', 'КонецПроцедуры', '',
    'Процедура Б()', '', '\tY = 2;', '', 'КонецПроцедуры'
  ));
});

test('formatCanonicalKeywords restores the configured casing', () => {
  const keywords = ['Процедура', 'КонецПроцедуры', 'Если', 'Тогда', 'КонецЕсли'];
  const src = lines('процедура П()', 'если А тогда', 'конецесли;', 'конецпроцедуры');
  assert.equal(assertStable(src, { formatCanonicalKeywords: true, keywords }), lines(
    'Процедура П()', '\tЕсли А Тогда', '\tКонецЕсли;', 'КонецПроцедуры'
  ));
});

test('canonicalisation leaves identifiers and string contents alone', () => {
  const keywords = ['Если'];
  const out = fmt('А = "если"; ЕслиТо = 1;', { formatCanonicalKeywords: true, keywords });
  assert.equal(out, 'А = "если"; ЕслиТо = 1;');
});

// --- incremental helpers used by the editor --------------------------------

test('getIndentLevel counts open blocks', () => {
  assert.equal(BslFormatter.getIndentLevel(''), 0);
  assert.equal(BslFormatter.getIndentLevel('Процедура П()'), 1);
  assert.equal(BslFormatter.getIndentLevel('Процедура П()\nЕсли А Тогда'), 2);
  assert.equal(BslFormatter.getIndentLevel('Процедура П()\nКонецПроцедуры'), 0);
});

test('getIndentLevel never goes negative on unbalanced input', () => {
  assert.equal(BslFormatter.getIndentLevel('КонецЕсли;\nКонецПроцедуры'), 0);
});

test('getState reports an unterminated string', () => {
  assert.equal(BslFormatter.getState('А = "начало').inString, true);
  assert.equal(BslFormatter.getState('А = "готово";').inString, false);
});

test('getState continues from a previous line state', () => {
  const mid = BslFormatter.getState('А = "начало');
  assert.equal(BslFormatter.getState('|конец";', mid).inString, false);
});

/* Keys are lower-cased for lookup, values keep the canonical spelling; both the
 * Russian and the English name of the same entry map to their own spelling. */
test('buildPlatformNameMaps indexes globals, classes and methods', () => {
  const maps = BslFormatter.buildPlatformNameMaps({
    globalfunctions: { 'Сообщить': { name: 'Сообщить', name_en: 'Message' } },
    classes: {
      'ТаблицаЗначений': {
        name: 'ТаблицаЗначений',
        methods: { 'Добавить': { name: 'Добавить', name_en: 'Add' } }
      }
    }
  });
  assert.deepEqual({ ...maps.globalFunctions }, { 'сообщить': 'Сообщить', 'message': 'Message' });
  assert.deepEqual({ ...maps.classes }, { 'таблицазначений': 'ТаблицаЗначений' });
  assert.deepEqual({ ...maps.methods }, { 'добавить': 'Добавить', 'add': 'Add' });
});

/* The maps come out of the vm realm, so spread them before comparing: a
 * cross-realm plain object is not deepStrictEqual to a local one. */
test('buildPlatformNameMaps tolerates missing input', () => {
  for (const input of [null, {}]) {
    const maps = BslFormatter.buildPlatformNameMaps(input);
    assert.deepEqual({ ...maps.globalFunctions }, {});
    assert.deepEqual({ ...maps.classes }, {});
    assert.deepEqual({ ...maps.methods }, {});
  }
});
