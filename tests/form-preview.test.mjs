import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadFormPreview() {
  return loadWebModules(root, ['xml-util.js', 'form-preview.js'], { CSS: { escape: (s) => String(s) } }).window.FormPreview;
}

const FP = loadFormPreview();
const T = FP._test;
const fixture = fs.readFileSync(path.join(root, 'testdata', 'Форма.xml'), 'utf8');

test('detects managed Form.xml', () => {
  assert.equal(FP.detect(fixture), true);
  assert.equal(FP.detect('<?xml version="1.0"?><Catalog/>'), false);
});

test('itemKey prefers id over name', () => {
  assert.equal(FP.itemKey({ id: '11', name: 'Номер' }), '11');
  assert.equal(FP.itemKey({ id: '', name: 'Номер' }), 'Номер');
});

test('checkboxes and buttons do not stretch by default', () => {
  const cb = { tag: 'CheckBoxField', properties: {} };
  const btn = { tag: 'Button', properties: {} };
  const input = { tag: 'InputField', properties: {} };
  assert.equal(T.wantsHStretch(cb, 'CheckBoxField', null), false);
  assert.equal(T.wantsHStretch(btn, 'Button', null), false);
  assert.equal(T.wantsHStretch(input, 'InputField', null), false);
  assert.equal(T.compactTag('CheckBoxField'), true);
});

test('explicit HorizontalStretch true still stretches', () => {
  const group = { properties: { HorizontalStretch: 'true' } };
  assert.equal(T.wantsHStretch(group, 'UsualGroup', null), true);
  const packed = { properties: { HorizontalStretch: 'false' } };
  assert.equal(T.wantsHStretch(packed, 'UsualGroup', null), false);
});

test('ChildItemsWidth Equal stretches children', () => {
  const input = { properties: {} };
  const parent = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', ChildItemsWidth: 'Equal' }
  });
  assert.equal(parent.orientation, 'horizontal');
  assert.equal(parent.childItemsWidth, 'equal');
  assert.equal(T.wantsHStretch(input, 'InputField', parent), true);
});

test('horizontal groups do not wrap', () => {
  const meta = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', Representation: 'None' }
  });
  assert.equal(meta.orientation, 'horizontal');
  assert.ok(meta.containerClassHints.indexOf('nowrap') >= 0);
});

test('UsualGroup without Group is horizontal (configurator default)', () => {
  const omitted = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Representation: 'None', ShowTitle: 'false' }
  });
  assert.equal(omitted.orientation, 'horizontal');
  const vertical = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Representation: 'None' }
  });
  assert.equal(vertical.orientation, 'vertical');
  const page = T.layoutMeta({ tag: 'Page', properties: {} });
  assert.equal(page.orientation, 'vertical');
});

test('top-title inputs stretch, default width is compact for side titles', () => {
  const top = { properties: { TitleLocation: 'Top' } };
  const side = { properties: {} };
  assert.equal(T.wantsHStretch(top, 'InputField', null), true);
  assert.equal(T.wantsHStretch(side, 'InputField', null), false);
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Date' } }), 10);
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Сумма' } }), 12);
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Контрагент' } }), 20);
});

test('tables and pages stretch, inputs stay compact', () => {
  assert.equal(T.wantsHStretch({ properties: {} }, 'Table', null), true);
  assert.equal(T.wantsHStretch({ properties: {} }, 'Pages', null), true);
  assert.equal(T.wantsHStretch({ properties: { PagesRepresentation: 'None' } }, 'Pages', null), false);
  assert.equal(T.wantsHStretch({ properties: {} }, 'InputField', null), false);
});

test('field groups pack in a horizontal parent unless ChildItemsWidth is set', () => {
  const parent = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' } });
  const withField = {
    tag: 'UsualGroup',
    properties: {},
    childItems: [{ tag: 'InputField', properties: {} }]
  };
  const decor = {
    tag: 'UsualGroup',
    properties: {},
    childItems: [{ tag: 'LabelDecoration', properties: { Title: 'x' } }]
  };
  assert.equal(T.groupHasFields(withField), true);
  assert.equal(T.groupHasFields(decor), false);
  assert.equal(T.wantsHStretch(withField, 'UsualGroup', parent), false);
  assert.equal(T.wantsHStretch(decor, 'UsualGroup', parent), false);
});

test('empty autofill-false command bar is skipped', () => {
  assert.equal(T.isEmptyCommandBar({ properties: { Autofill: 'false' }, childItems: [] }), true);
  assert.equal(T.isEmptyCommandBar({ properties: { Autofill: 'false' }, childItems: [{ tag: 'Button' }] }), false);
});

test('titleLocation and boolean helpers', () => {
  assert.equal(T.titleLocation({ properties: { TitleLocation: 'None' } }), 'none');
  assert.equal(T.titleLocation({ properties: {} }), 'left');
  assert.equal(T.isFalse('false'), true);
  assert.equal(T.isTrue('true'), true);
});

test('DataPath fallback is humanized', () => {
  assert.equal(T.humanizeIdent('ХозяйственнаяОперация'), 'Хозяйственная Операция');
  assert.equal(T.humanizeIdent('ВариантОформленияПродажи'), 'Вариант Оформления Продажи');
  assert.equal(T.titleOf({ properties: { DataPath: 'Объект.ХозяйственнаяОперация' } }), 'Хозяйственная Операция');
  assert.equal(T.titleOf({ properties: { Title: 'Операция', DataPath: 'Объект.ХозяйственнаяОперация' } }), 'Операция');
});

test('hidden title is not shown on label fields', () => {
  const item = {
    tag: 'LabelField',
    name: 'СтрокаИсправление',
    properties: { DataPath: 'СтрокаИсправление', TitleLocation: 'None' }
  };
  assert.equal(T.displayLabel(item, null, 'LabelField'), '');
});

test('checkbox rows are skipped by label equalization', () => {
  const row = { classList: { contains: (c) => c === 'fp-check-row' } };
  assert.equal(T.fieldRowSkipped(row), true);
});

test('radio options come from ChoiceList, not Да/Нет/Авто', () => {
  const withList = {
    properties: { ChoiceListItems: ['Подразделение', 'Участок'], TitleLocation: 'None' }
  };
  assert.equal(Array.from(T.radioOptions(withList)).join('|'), 'Подразделение|Участок');
  assert.equal(Array.from(T.radioOptions({ properties: {} })).join('|'), 'Да|Нет|Авто');
  assert.equal(T.displayLabel(withList, null, 'RadioButtonField'), '');
});

test('empty decorations do not fall back to the element name', () => {
  const deco = { tag: 'LabelDecoration', name: 'Декорация_Разделитель_1', properties: {} };
  assert.equal(T.titleOf(deco), '');
  assert.equal(T.displayLabel(deco, null, 'LabelDecoration'), '');
});

test('InCell column group uses child captions, not auto group title', () => {
  const table = {
    tag: 'Table',
    childItems: [{
      tag: 'ColumnGroup',
      name: 'ВыполнениеОперацийГруппаНоменклатура',
      properties: { Title: 'Группа номенклатура', Group: 'InCell' },
      childItems: [
        { tag: 'LabelField', name: 'Номенклатура', properties: { DataPath: 'ВыполнениеОпераций.Номенклатура' } },
        { tag: 'LabelField', name: 'Характеристика', properties: { DataPath: 'ВыполнениеОпераций.Характеристика' } }
      ]
    }]
  };
  const cols = T.tableColumns(table);
  assert.equal(cols.length, 1);
  assert.equal(T.isInCellGroup(cols[0]), true);
  assert.equal(T.columnCaption(cols[0]), 'Номенклатура, Характеристика');
});

test('Horizontal column group with ShowInHeader stays grouped', () => {
  const table = {
    tag: 'Table',
    childItems: [{
      tag: 'ColumnGroup',
      name: 'ГруппаКоличество',
      properties: { Title: 'Количество', Group: 'Horizontal', ShowInHeader: 'true' },
      childItems: [
        { tag: 'LabelField', properties: { Title: 'План' } },
        { tag: 'LabelField', properties: { Title: 'Готово' } }
      ]
    }]
  };
  const cols = T.tableColumns(table);
  assert.equal(cols.length, 1);
  assert.equal(T.columnCaption(cols[0]), 'Количество');
});

test('table std commands respect ChangeRowSet/ChangeRowOrder', () => {
  const locked = {
    properties: { ChangeRowSet: 'false', ChangeRowOrder: 'false' },
    autoCommandBar: { properties: {}, childItems: [] }
  };
  assert.equal(T.tableStdCommands(locked).length, 0);
  const noFill = {
    properties: {},
    autoCommandBar: { properties: { Autofill: 'false' }, childItems: [{ tag: 'Button' }] }
  };
  assert.equal(T.tableStdCommands(noFill).length, 0);
  const normal = { properties: {}, autoCommandBar: { properties: {}, childItems: [] } };
  assert.ok(T.tableStdCommands(normal).some((b) => b.properties.Title === 'Добавить'));
  const list = { properties: { Representation: 'List' }, autoCommandBar: { properties: {}, childItems: [] } };
  const listCmds = T.tableStdCommands(list);
  assert.ok(listCmds.some((b) => b.properties.Title === 'Добавить'));
  assert.equal(listCmds.some((b) => /вверх|вниз/i.test(b.properties.Title || '')), false);
});

test('empty command-bar popups are not treated as main-row items', () => {
  const empty = {
    tag: 'Popup',
    properties: { Title: 'Печать', Representation: 'Picture' },
    childItems: [{ tag: 'ButtonGroup', childItems: [] }]
  };
  assert.equal(T.popupHasCommands(empty), false);
  const filled = {
    tag: 'Popup',
    properties: { Title: 'Действие' },
    childItems: [{ tag: 'Button', properties: { CommandName: 'Form.Command.X' } }]
  };
  assert.equal(T.popupHasCommands(filled), true);
});

test('popup menu lists nested buttons and picture+text for Добавить', () => {
  const popup = {
    tag: 'Popup',
    name: 'ПодменюДобавить',
    properties: { Title: 'Добавить', Picture: 'StdPicture.CreateListItem' },
    childItems: [
      { tag: 'Button', name: 'ДобавитьИзФайлаНаДиске', properties: { Title: 'Файл с диска...' } },
      { tag: 'Button', name: 'ДобавитьФайлПоШаблону', properties: { Title: 'По шаблону файла...' } },
      {
        tag: 'ButtonGroup',
        childItems: [
          { tag: 'Button', name: 'Hidden', properties: { Visible: 'false', Title: 'Скрыто' } },
          { tag: 'Button', name: 'Dead', properties: { CommandName: '0', Title: 'Мёртвая' } }
        ]
      },
      { tag: 'Button', name: 'ДобавитьФайлСоСканера', properties: { Title: 'Со сканера...' } }
    ]
  };
  const entries = T.popupMenuEntries(popup);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, 'ДобавитьИзФайлаНаДиске');
  assert.equal(entries[1].name, 'ДобавитьФайлПоШаблону');
  assert.equal(entries[2].name, 'ДобавитьФайлСоСканера');
  assert.equal(T.titleOf(entries[0]), 'Файл с диска...');
  assert.equal(T.resolveButtonRep(popup, {}), 'pictureandtext');
});

test('dead and extra command-bar buttons are not kept in the main row', () => {
  assert.equal(T.isDeadCommand({ tag: 'Button', properties: { CommandName: '0' } }), true);
  assert.equal(T.isDeadCommand({ tag: 'Button', properties: { CommandName: 'Form.Command.Create' } }), false);
  assert.equal(T.inAdditionalBar({ properties: { CommandName: 'Form.StandardCommand.CustomizeForm' } }), true);
  const group = {
    tag: 'ButtonGroup',
    childItems: [
      { tag: 'Button', properties: { CommandName: '0' } },
      { tag: 'Button', name: 'ФормаИзменитьФорму', properties: { CommandName: 'Form.StandardCommand.CustomizeForm' } }
    ]
  };
  assert.equal(T.hasMainBarChildren(group), false);
  const extra = [];
  T.collectAdditionalBarItems(group, extra);
  assert.equal(extra.length, 1);
  assert.equal(extra[0].name, 'ФормаИзменитьФорму');
  const emptyGlobal = { tag: 'ButtonGroup', properties: { CommandSource: 'FormCommandPanelGlobalCommands' }, childItems: [] };
  assert.equal(T.hasMainBarChildren(emptyGlobal), false);
});

test('search addition is hidden when location is None', () => {
  const table = { properties: { SearchStringLocation: 'None', ViewStatusLocation: 'None' } };
  assert.equal(T.additionHidden(table, 'SearchStringLocation'), true);
  assert.equal(T.additionHidden(table, 'ViewStatusLocation'), true);
  assert.equal(T.additionHidden({ properties: {} }, 'SearchStringLocation'), false);
});

test('comment and name fields are text, not references', () => {
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Комментарий' } }), 'text');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Наименование' } }), 'text');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Контрагент' } }), 'ref');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.ПричинаЗадержки', ChoiceButton: 'false' } }), 'text');
});

test('group title shows unless ShowTitle is false', () => {
  const hidden = {
    tag: 'UsualGroup',
    properties: { Title: 'Распоряжение', Representation: 'None', ShowTitle: 'false' }
  };
  assert.equal(T.showGroupTitle(hidden), false);
  const autoTitle = {
    tag: 'UsualGroup',
    properties: { Title: 'Контроль качества', Representation: 'None' }
  };
  assert.equal(T.showGroupTitle(autoTitle), true);
  const shown = {
    tag: 'UsualGroup',
    properties: { Title: 'Распоряжение', Representation: 'None', ShowTitle: 'true' }
  };
  assert.equal(T.showGroupTitle(shown), true);
});

test('PopUp group keeps title even without ShowTitle', () => {
  assert.equal(T.groupBehavior({ properties: { Behavior: 'PopUp' } }), 'popup');
  assert.equal(T.groupBehavior({ properties: { Поведение: 'Всплывающая' } }), 'popup');
  assert.equal(T.groupBehavior({ properties: { Behavior: 'Usual' } }), 'usual');
  const pop = {
    tag: 'UsualGroup',
    properties: { Title: 'Итого', Behavior: 'PopUp', Representation: 'None' }
  };
  assert.equal(T.isPopUpGroup(pop), true);
  assert.equal(T.showGroupTitle(pop), true);
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <UsualGroup name="ГруппаМультивалютныеСуммы" id="1">
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Итого</v8:content></v8:item></Title>
      <Behavior>PopUp</Behavior>
      <Representation>None</Representation>
      <ChildItems>
        <Table name="ТаблицаИтоговПоВалютам" id="2">
          <DataPath>ТаблицаИтоговПоВалютам</DataPath>
        </Table>
      </ChildItems>
    </UsualGroup>
  </ChildItems>
</Form>`);
  assert.ok(!parsed.error, parsed.error);
  const g = parsed.model.childItemsRoot[0];
  assert.equal(g.properties.Behavior, 'PopUp');
  assert.equal(T.groupBehavior(g), 'popup');
  assert.equal(T.showGroupTitle(g), true);
});

test('applyLabelWidth equalizes titles in one vertical group', () => {
  const labs = [
    { offsetWidth: 48, textContent: 'Автор:', style: {} },
    { offsetWidth: 136, textContent: 'Главный бухгалтер:', style: {} },
    { offsetWidth: 80, textContent: 'Руководитель:', style: {} }
  ];
  T.applyLabelWidth(labs);
  assert.equal(labs[0].style.minWidth, '136px');
  assert.equal(labs[1].style.minWidth, '136px');
  assert.equal(labs[2].style.minWidth, '136px');
});

test('object meta path works for config objects and external reports', () => {
  const cat = T.objectMetaCandidates(
    'E:\\cf\\Catalogs\\Partners\\Forms\\ItemForm\\Ext\\Form.xml'
  );
  assert.equal(cat[0], 'E:\\cf\\Catalogs\\Partners.xml');
  assert.equal(cat[1], 'E:\\cf\\Catalogs\\Partners\\Partners.xml');
  const ext = T.objectMetaCandidates(
    'C:/src/CostReport2025/Forms/ReportForm/Ext/Form.xml'
  );
  assert.equal(ext[0], 'C:\\src\\CostReport2025.xml');
  assert.equal(ext[1], 'C:\\src\\CostReport2025\\CostReport2025.xml');
  assert.equal(T.objectMetaCandidates('Form.xml').length, 0);
  assert.equal(T.objectMetaCandidates('E:\\cf\\Catalogs\\Partners.xml').length, 0);
});

test('form attribute titles fill in missing field titles', () => {
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <InputField name="Номенклатура" id="1">
      <DataPath>Номенклатура</DataPath>
      <TitleLocation>Left</TitleLocation>
    </InputField>
    <InputField name="Количество" id="2">
      <DataPath>ДеревоРасчета.Количество</DataPath>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Отчет" id="1">
      <Type><v8:Type>cfg:ExternalReportObject.Cost</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
    <Attribute name="Номенклатура" id="2">
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Номенклатура</v8:content></v8:item></Title>
    </Attribute>
    <Attribute name="ДеревоРасчета" id="3">
      <Columns>
        <Column name="Количество" id="1">
          <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Количество факт</v8:content></v8:item></Title>
          <Type>
            <v8:Type>xs:string</v8:Type>
            <v8:StringQualifiers><v8:Length>12</v8:Length></v8:StringQualifiers>
          </Type>
        </Column>
      </Columns>
    </Attribute>
  </Attributes>
</Form>`);
  assert.ok(!parsed.error, parsed.error);
  const idx = T.buildCaptionIndex(parsed.model);
  assert.equal(T.captionForPath('Номенклатура', idx), 'Номенклатура');
  assert.equal(T.captionForPath('ДеревоРасчета.Количество', idx), 'Количество факт');
  const field = parsed.model.childItemsRoot[0];
  const col = parsed.model.childItemsRoot[1];
  const ctx = { captionIndex: idx };
  assert.equal(T.titleOf(field, ctx), 'Номенклатура');
  assert.equal(T.titleOf(col, ctx), 'Количество факт');
  assert.equal(T.defaultFieldChars(col, ctx), 12);
});

test('object metadata synonyms beat humanized DataPath, form Title still wins', () => {
  const objectMeta = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Catalog>
    <Properties>
      <Name>Контрагенты</Name>
      <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Контрагенты</v8:content></v8:item></Synonym>
      <DescriptionLength>100</DescriptionLength>
    </Properties>
    <ChildObjects>
      <Attribute>
        <Properties>
          <Name>НаименованиеПолное</Name>
          <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Сокращенное юр. наименование</v8:content></v8:item></Synonym>
          <Type>
            <v8:Type>xs:string</v8:Type>
            <v8:StringQualifiers><v8:Length>250</v8:Length></v8:StringQualifiers>
          </Type>
        </Properties>
      </Attribute>
      <Attribute>
        <Properties>
          <Name>ИНН</Name>
          <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>ИНН</v8:content></v8:item></Synonym>
        </Properties>
      </Attribute>
    </ChildObjects>
  </Catalog>
</MetaDataObject>`;
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <InputField name="НаименованиеПолное" id="1">
      <DataPath>Объект.НаименованиеПолное</DataPath>
    </InputField>
    <InputField name="ИНН" id="2">
      <DataPath>Объект.ИНН</DataPath>
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>ИНН юрлица</v8:content></v8:item></Title>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:CatalogObject.Контрагенты</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`, objectMeta);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.objectMeta.captions['НаименованиеПолное'], 'Сокращенное юр. наименование');
  const ctx = { captionIndex: T.buildCaptionIndex(parsed.model) };
  assert.equal(T.titleOf(parsed.model.childItemsRoot[0], ctx), 'Сокращенное юр. наименование');
  assert.equal(T.titleOf(parsed.model.childItemsRoot[1], ctx), 'ИНН юрлица');
  assert.equal(T.titleOf(parsed.model.childItemsRoot[0], null), 'Наименование Полное');
  assert.equal(T.defaultFieldChars(parsed.model.childItemsRoot[0], ctx), 40);
});

test('missing object metadata does not break form captions', () => {
  const parsed = FP.parse(fixture);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.objectMeta, null);
  assert.equal(T.titleOf({ properties: { DataPath: 'Объект.ХозяйственнаяОперация' } }), 'Хозяйственная Операция');
});

test('standard WriteAndClose is a default text button, not an icon', () => {
  const writeClose = {
    tag: 'Button',
    properties: {
      Type: 'CommandBarButton',
      DefaultButton: 'true',
      CommandName: 'Form.StandardCommand.WriteAndClose'
    }
  };
  const write = {
    tag: 'Button',
    properties: {
      Type: 'CommandBarButton',
      CommandName: 'Form.StandardCommand.Write'
    }
  };
  const pictured = {
    tag: 'Button',
    properties: { CommandName: 'Form.Command.X', Picture: 'StdPicture.Find' }
  };
  assert.equal(T.resolveButtonRep(writeClose), 'text');
  assert.equal(T.titleOf(writeClose), 'Записать и закрыть');
  assert.equal(T.resolveButtonRep(write), 'text');
  assert.equal(T.titleOf(write), 'Записать');
  assert.equal(T.resolveButtonRep(pictured), 'picture');
  assert.equal(T.resolveButtonRep({
    properties: { Representation: 'Picture', CommandName: 'Form.StandardCommand.Write' }
  }), 'picture');
});

test('platform pictures map to Tabler icon ids', () => {
  assert.equal(T.iconIdFromRef('StdPicture.Write'), 'save');
  assert.equal(T.iconIdFromRef('StdPicture.Post'), 'file-check');
  assert.equal(T.iconIdFromRef('StdPicture.Print'), 'printer');
  assert.equal(T.iconIdFromRef('StdPicture.MoveUp'), 'arrow-up');
  assert.equal(T.iconIdFor({
    properties: { CommandName: 'Form.StandardCommand.Write', Representation: 'Picture' }
  }), 'save');
  assert.equal(T.iconIdFor({
    properties: { CommandName: 'Form.StandardCommand.Post', Picture: 'StdPicture.Post' }
  }), 'file-check');
  assert.equal(T.iconIdFor({
    properties: { CommandName: 'Form.StandardCommand.Help' }
  }), 'help');
  assert.equal(T.iconFor('InputField').icon, 'forms');
  assert.equal(T.iconFor('Button').icon, 'click');
  assert.equal(T.iconFor('Table').icon, 'table');
});

test('unlimited comment field stretches across the page', () => {
  const comment = {
    tag: 'InputField',
    properties: {
      DataPath: 'Объект.Комментарий',
      TitleLocation: 'None',
      AutoMaxWidth: 'false'
    }
  };
  const objectMeta = T.parseObjectMeta(`<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Catalog>
    <ChildObjects>
      <Attribute>
        <Properties>
          <Name>Комментарий</Name>
          <Type>
            <v8:Type>xs:string</v8:Type>
            <v8:StringQualifiers>
              <v8:Length>0</v8:Length>
              <v8:AllowedLength>Variable</v8:AllowedLength>
            </v8:StringQualifiers>
          </Type>
        </Properties>
      </Attribute>
    </ChildObjects>
  </Catalog>
</MetaDataObject>`);
  const ctx = {
    captionIndex: T.buildCaptionIndex({
      attributes: [{ name: 'Объект', properties: { MainAttribute: 'true' } }],
      objectMeta
    })
  };
  assert.equal(T.isUnlimitedString(comment, ctx), true);
  assert.equal(T.isMultilineField(comment, ctx), true);
  assert.equal(T.wantsHStretch(comment, 'InputField', null, ctx), true);
  assert.equal(T.wantsVStretch(comment, 'InputField', ctx), true);
  const compact = {
    tag: 'InputField',
    properties: { DataPath: 'Объект.Комментарий', TitleLocation: 'Left', VerticalStretch: 'false' }
  };
  assert.equal(T.wantsVStretch(compact, 'InputField', ctx), false);
  const listChoice = {
    tag: 'InputField',
    properties: {
      DataPath: 'ОформлениеПоступления',
      TitleLocation: 'Left',
      ListChoiceMode: 'true',
      AutoMaxWidth: 'false',
      MaxWidth: '30'
    }
  };
  const listCtx = {
    captionIndex: T.buildCaptionIndex({
      attributes: [{
        name: 'ОформлениеПоступления',
        properties: {},
        stringLen: -1
      }]
    })
  };
  assert.equal(T.isUnlimitedString(listChoice, listCtx), true);
  assert.equal(T.isMultilineField(listChoice, listCtx), false);
  assert.equal(T.wantsVStretch(listChoice, 'InputField', listCtx), false);
  assert.equal(T.fieldKind(listChoice), 'list');
});

test('HorizontalStretch does not grow vertically in a page', () => {
  const group = { properties: { HorizontalStretch: 'true' } };
  assert.equal(T.wantsHStretch(group, 'UsualGroup', null), true);
  assert.equal(T.wantsVStretch(group, 'UsualGroup'), false);
});

test('multiline Height is kept even if VerticalStretch is true', () => {
  const field = {
    tag: 'InputField',
    properties: {
      DataPath: 'Объект.ДополнительнаяИнформация',
      TitleLocation: 'Left',
      Height: '3',
      VerticalStretch: 'true',
      MultiLine: 'true'
    }
  };
  assert.equal(T.isMultilineField(field), true);
  assert.equal(T.fieldHeight(field), 3);
  assert.equal(T.wantsVStretch(field, 'InputField'), false);
});

test('catalog AutoCommandBar autofills WriteAndClose and Write', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1">
    <ChildItems>
      <Popup name="ПодменюПечать" id="1">
        <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Печать</v8:content></v8:item></Title>
      </Popup>
    </ChildItems>
  </AutoCommandBar>
  <ChildItems>
    <InputField name="Код" id="2">
      <DataPath>Объект.Code</DataPath>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:CatalogObject.Контрагенты</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(T.formObjectKind(parsed.model), 'catalog');
  const bar = T.formCommandBar(parsed.model);
  const keys = (bar.childItems || []).map((it) => T.stdCommandKey(it));
  assert.equal(keys[0], 'writeandclose');
  assert.equal(keys[1], 'write');
  const writeClose = bar.childItems[0];
  assert.equal(T.resolveButtonRep(writeClose), 'text');
  assert.equal(T.titleOf(writeClose), 'Записать и закрыть');
  assert.equal(T.isTrue(writeClose.properties.DefaultButton), true);
  assert.equal(T.resolveButtonRep(bar.childItems[1]), 'text');
});

test('document AutoCommandBar autofills PostAndClose, Write icon, Post icon', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>
  <ChildItems>
    <InputField name="Номер" id="2">
      <DataPath>Объект.Number</DataPath>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:DocumentObject.ЗаказКлиента</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(T.formObjectKind(parsed.model), 'document');
  const bar = T.formCommandBar(parsed.model);
  const items = bar.childItems || [];
  assert.equal(items.length, 3);
  assert.equal(T.stdCommandKey(items[0]), 'postandclose');
  assert.equal(T.titleOf(items[0]), 'Провести и закрыть');
  assert.equal(T.resolveButtonRep(items[0]), 'text');
  assert.equal(T.isTrue(items[0].properties.DefaultButton), true);
  assert.equal(T.stdCommandKey(items[1]), 'write');
  assert.equal(T.resolveButtonRep(items[1]), 'picture');
  assert.equal(T.iconIdFor(items[1]), 'save');
  assert.equal(T.stdCommandKey(items[2]), 'post');
  assert.equal(T.resolveButtonRep(items[2]), 'picture');
  assert.equal(T.iconIdFor(items[2]), 'file-check');
});

test('Autofill false does not inject standard form commands', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1">
    <Autofill>false</Autofill>
    <ChildItems>
      <Button name="ФормаЗаписатьИЗакрыть" id="1">
        <DefaultButton>true</DefaultButton>
        <CommandName>Form.StandardCommand.WriteAndClose</CommandName>
      </Button>
    </ChildItems>
  </AutoCommandBar>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:CatalogObject.Контрагенты</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`;
  const parsed = FP.parse(xml);
  assert.equal(T.formStdCommandButtons(parsed.model).length, 0);
  const bar = T.formCommandBar(parsed.model);
  assert.equal((bar.childItems || []).length, 1);
});

const erpForm = 'E:\\Bases\\ERP_DESIGNER\\src\\cf\\Catalogs\\ДоговорыКонтрагентов\\Forms\\ФормаЭлемента\\Ext\\Form.xml';
const erpMeta = 'E:\\Bases\\ERP_DESIGNER\\src\\cf\\Catalogs\\ДоговорыКонтрагентов.xml';
if (fs.existsSync(erpForm)) {
  test('ERP ДоговорыКонтрагентов: WriteAndClose text and comment fills the page', () => {
    const xml = fs.readFileSync(erpForm, 'utf8');
    const meta = fs.existsSync(erpMeta) ? fs.readFileSync(erpMeta, 'utf8') : '';
    const parsed = FP.parse(xml, meta);
    assert.ok(!parsed.error, parsed.error);
    const bar = parsed.model.autoCommandBar;
    const writeClose = (bar.childItems || []).find((it) => it.name === 'ФормаЗаписатьИЗакрыть');
    const write = (bar.childItems || []).find((it) => it.name === 'ФормаЗаписать');
    assert.ok(writeClose);
    assert.equal(T.resolveButtonRep(writeClose), 'text');
    assert.equal(T.titleOf(writeClose), 'Записать и закрыть');
    assert.equal(T.resolveButtonRep(write), 'text');
    const ctx = { captionIndex: T.buildCaptionIndex(parsed.model) };
    function findByName(items, name) {
      for (const it of items || []) {
        if (it.name === name && it.tag === 'InputField') return it;
        const hit = findByName(it.childItems, name);
        if (hit) return hit;
      }
      return null;
    }
    const comment = findByName(parsed.model.childItemsRoot, 'Комментарий');
    assert.ok(comment);
    assert.equal(comment.properties.TitleLocation, 'None');
    assert.equal(T.isMultilineField(comment, ctx), true);
    assert.equal(T.wantsHStretch(comment, 'InputField', null, ctx), true);
    assert.equal(T.wantsVStretch(comment, 'InputField', ctx), true);
  });

  test('ERP ДоговорыКонтрагентов: Добавить popup lists file commands', () => {
    const xml = fs.readFileSync(erpForm, 'utf8');
    const parsed = FP.parse(xml);
    assert.ok(!parsed.error, parsed.error);
    function findByName(items, name) {
      for (const it of items || []) {
        if (it.name === name) return it;
        const hit = findByName(it.childItems, name)
          || findByName(it.autoCommandBar && it.autoCommandBar.childItems, name);
        if (hit) return hit;
      }
      return null;
    }
    const popup = findByName(parsed.model.childItemsRoot, 'ПодменюДобавить');
    assert.ok(popup, 'ПодменюДобавить');
    const titles = T.popupMenuEntries(popup).map((e) => T.titleOf(e));
    assert.ok(titles.some((t) => /диска/i.test(t)), titles.join(', '));
    assert.ok(titles.some((t) => /шаблон/i.test(t)), titles.join(', '));
    assert.equal(T.resolveButtonRep(popup, {}), 'pictureandtext');
  });
}

const erpAdvanceForm = 'E:\\Bases\\ERP_DESIGNER\\src\\cf\\Documents\\АвансовыйОтчет\\Forms\\ФормаДокумента\\Ext\\Form.xml';
if (fs.existsSync(erpAdvanceForm)) {
  test('ERP АвансовыйОтчет: print page is vertical; Итого group is PopUp', () => {
    const xml = fs.readFileSync(erpAdvanceForm, 'utf8');
    const parsed = FP.parse(xml);
    assert.ok(!parsed.error, parsed.error);
    function findByName(items, name) {
      for (const it of items || []) {
        if (it.name === name) return it;
        const hit = findByName(it.childItems, name);
        if (hit) return hit;
      }
      return null;
    }
    const page = findByName(parsed.model.childItemsRoot, 'ГруппаДляПечати');
    assert.ok(page, 'ГруппаДляПечати');
    assert.equal(page.tag, 'Page');
    assert.equal(T.layoutMeta(page).orientation, 'vertical');
    const fields = (page.childItems || []).filter((it) => it.tag === 'InputField');
    assert.ok(fields.length >= 4, 'print page fields');
    const pop = findByName(parsed.model.childItemsRoot, 'ГруппаМультивалютныеСуммы');
    assert.ok(pop, 'ГруппаМультивалютныеСуммы');
    assert.equal(T.groupBehavior(pop), 'popup');
    assert.equal(T.showGroupTitle(pop), true);
    const table = findByName(pop.childItems, 'ТаблицаИтоговПоВалютам');
    assert.ok(table, 'ТаблицаИтоговПоВалютам');
  });
}

const erpCatalogForm = 'E:\\Bases\\ERP_DESIGNER\\src\\cf\\Catalogs\\Контрагенты\\Forms\\ФормаЭлемента\\Ext\\Form.xml';
if (fs.existsSync(erpCatalogForm)) {
  test('ERP Контрагенты: autofill Write buttons; extra info height stays 3', () => {
    const xml = fs.readFileSync(erpCatalogForm, 'utf8');
    const parsed = FP.parse(xml);
    assert.ok(!parsed.error, parsed.error);
    assert.equal(T.formObjectKind(parsed.model), 'catalog');
    const bar = T.formCommandBar(parsed.model);
    const keys = (bar.childItems || []).map((it) => T.stdCommandKey(it));
    assert.equal(keys[0], 'writeandclose');
    assert.equal(keys[1], 'write');
    assert.equal(T.resolveButtonRep(bar.childItems[0]), 'text');
    assert.equal(T.isTrue(bar.childItems[0].properties.DefaultButton), true);
    function findByName(items, name) {
      for (const it of items || []) {
        if (it.name === name) return it;
        const hit = findByName(it.childItems, name);
        if (hit) return hit;
      }
      return null;
    }
    const extra = findByName(parsed.model.childItemsRoot, 'ДополнительнаяИнформация');
    assert.ok(extra);
    assert.equal(extra.properties.Height, '3');
    assert.equal(T.wantsVStretch(extra, 'InputField'), false);
    assert.equal(T.isMultilineField(extra), true);
  });
}

test('form outline marks groups as collapsible and hides nested children', () => {
  const parsed = FP.parse(fixture);
  const items = FP.outline(parsed.model, fixture);
  const sh = items.find((x) => x.name === 'ГруппаШапка');
  assert.ok(sh, 'ГруппаШапка');
  assert.equal(sh.hasChildren, true);
  const shIdx = items.indexOf(sh);
  const child = items[shIdx + 1];
  assert.ok(child && child.depth > sh.depth);
  const collapsed = {};
  collapsed[sh.id] = true;
  assert.equal(FP.outlineHidden(items, shIdx, collapsed), false);
  assert.equal(FP.outlineHidden(items, shIdx + 1, collapsed), true);
  const pages = items.find((x) => x.name === 'Страницы');
  assert.ok(pages && pages.hasChildren);
  collapsed[pages.id] = true;
  const pIdx = items.indexOf(pages);
  assert.equal(FP.outlineHidden(items, pIdx + 1, collapsed), true);
  assert.equal(FP.outlineExpandTo(items, items[pIdx + 1].id, collapsed), true);
  assert.equal(collapsed[pages.id], undefined);
});

test('collapsing one group does not hide a sibling group', () => {
  const items = [
    { type: 'form', id: 'A', depth: 0 },
    { type: 'form', id: 'A1', depth: 1 },
    { type: 'form', id: 'B', depth: 0 },
    { type: 'form', id: 'B1', depth: 1 }
  ];
  FP.outlineHasChildren(items);
  assert.equal(items[0].hasChildren, true);
  assert.equal(items[2].hasChildren, true);
  const collapsed = { A: true };
  assert.equal(FP.outlineHidden(items, 1, collapsed), true);
  assert.equal(FP.outlineHidden(items, 2, collapsed), false);
  assert.equal(FP.outlineHidden(items, 3, collapsed), false);
});
