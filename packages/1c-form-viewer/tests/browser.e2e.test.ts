import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { BrowserSession } from '../src/browser-session.js';
import { ViewerController } from '../src/controller.js';
import { FileLoader } from '../src/files.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');
const assetsDir = path.join(packageDir, 'dist', 'web');
const maxBytes = 64 * 1024 * 1024;

function options(root: string) {
  return {
    roots: [root],
    allowAnyPath: false,
    viewport: { width: 640, height: 480 },
    headless: true,
    maxBytes,
    assetsDir,
  };
}

function nestedForm(): string {
  const longFields = Array.from({ length: 35 }, (_, index) =>
    `<InputField name="Поле${index}" id="${200 + index}"><DataPath>Объект.Поле${index}</DataPath></InputField>`,
  ).join('');
  const columns = Array.from({ length: 18 }, (_, index) =>
    `<InputField name="Колонка${index}" id="${300 + index}"><DataPath>Объект.Таблица.Колонка${index}</DataPath></InputField>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <Pages name="ВнешниеСтраницы" id="100"><ChildItems>
      <Page name="Первая" id="101"><ChildItems><LabelDecoration name="ПерваяНадпись" id="103"/></ChildItems></Page>
      <Page name="Вторая" id="102"><ChildItems>
        <Pages name="ВложенныеСтраницы" id="110"><ChildItems>
          <Page name="ВложеннаяПервая" id="111"><ChildItems><LabelDecoration name="ВложеннаяНадпись" id="114"/></ChildItems></Page>
          <Page name="ВложеннаяВторая" id="112"><ChildItems>
            <UsualGroup name="ДлиннаяГруппа" id="120"><Group>Vertical</Group><ChildItems>${longFields}</ChildItems></UsualGroup>
            <Table name="Таблица" id="130"><DataPath>Объект.Таблица</DataPath><ChildItems>${columns}</ChildItems></Table>
          </ChildItems></Page>
          <Page name="ТабличныйДокументСтраница" id="115"><ChildItems>
            <SpreadSheetDocumentField name="ТабличныйДокумент" id="140"/>
          </ChildItems></Page>
        </ChildItems></Pages>
      </ChildItems></Page>
    </ChildItems></Pages>
  </ChildItems>
</Form>`;
}

test('one Edge page handles nested tabs, hidden selection, scrolling and reload', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-browser-'));
  const formPath = path.join(root, 'Nested.xml');
  await fs.writeFile(formPath, nestedForm());
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession(options(root));
  const controller = new ViewerController(loader, browser);
  t.after(async () => {
    await controller.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const opened = await controller.open(formPath);
  assert.equal(opened.state.format, 'form');
  assert.equal(opened.state.tabs.find((tab) => tab.pageId === '101')?.active, true);
  const context = (browser as unknown as { context: { newPage: () => Promise<any> } }).context;
  const internalPage = await context.newPage();
  await internalPage.setViewportSize({ width: 640, height: 480 });
  await internalPage.goto(browser.previewUrl(), { waitUntil: 'load' });
  await internalPage.waitForFunction(() => !document.getElementById('preview')?.hasAttribute('hidden'));
  assert.match(await internalPage.locator('#agent-format').textContent() || '', /Форма 1С/);
  assert.match(await internalPage.locator('#agent-path').textContent() || '', /Nested\.xml/);
  const originalPage = (browser as unknown as { page: unknown }).page;

  const selected = await controller.selectElement('140') as { found: boolean; state: { tabs: Array<Record<string, unknown>> } };
  assert.equal(selected.found, true);
  assert.equal(selected.state.tabs.find((tab) => tab.pageId === '102')?.active, true);
  assert.equal(selected.state.tabs.find((tab) => tab.pageId === '115')?.active, true);

  await controller.switchTab('111', '110');
  const switched = await controller.switchTab('112', '110');
  assert.equal(switched.tabs.find((tab) => tab.pageId === '112')?.active, true);

  const scrollablePage = switched.scrolls.find((row) => row.target === 'active-page' && Number(row.maxY) > 0);
  assert.ok(scrollablePage, `expected a vertically scrollable form page: ${JSON.stringify(switched.scrolls)}`);
  const active = await controller.scroll({ target: 'active-page', elementId: scrollablePage.elementId, deltaY: 250 });
  assert.ok(Number((active as { after: { y: number } }).after.y) > 0);
  const table = await controller.scroll({ target: 'table', elementId: '130', deltaX: 300, deltaY: 80 });
  assert.ok((table as { after: { x: number } }).after.x > 0);
  await controller.switchTab('115', '110');
  const spreadsheet = await controller.scroll({ target: 'spreadsheet', elementId: '140', x: 400, y: 300 });
  assert.ok((spreadsheet as { after: { x: number; y: number } }).after.x > 0);
  assert.ok((spreadsheet as { after: { x: number; y: number } }).after.y > 0, JSON.stringify(spreadsheet));

  await fs.appendFile(formPath, '\n<!-- external reload -->\n');
  const reloaded = await controller.reload();
  assert.equal(reloaded.state.tabs.find((tab) => tab.pageId === '115')?.active, true);
  assert.equal((browser as unknown as { page: unknown }).page, originalPage, 'browser page must be reused');
  const screenshot = await controller.capture('viewport');
  assert.deepEqual(screenshot.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.ok(screenshot.length > 10_000);
});

test('the same Edge page renders and scrolls Template.xml and MXL', async (t) => {
  const loader = await FileLoader.create([repositoryDir], maxBytes);
  const browser = new BrowserSession(options(repositoryDir));
  t.after(() => browser.close());

  const template = await browser.open(await loader.load(path.join(repositoryDir, 'testdata', 'Template.xml')));
  assert.equal(template.format, 'template');
  const page = (browser as unknown as { page: unknown }).page;
  const templateScroll = await browser.scroll({ target: 'document', deltaX: 500, deltaY: 400 }) as { after: { x: number; y: number } };
  assert.ok(templateScroll.after.x > 0);
  assert.ok(templateScroll.after.y > 0);

  const mxl = await browser.open(await loader.load(path.join(repositoryDir, 'testdata', 'upd.mxl')));
  assert.equal(mxl.format, 'mxl');
  assert.equal((browser as unknown as { page: unknown }).page, page);
  const mxlScroll = await browser.scroll({ target: 'document', deltaX: 500, deltaY: 400 }) as { after: { x: number; y: number } };
  assert.ok(mxlScroll.after.x > 0);
  assert.ok(mxlScroll.after.y > 0);
});

test('built CLI serves the tools over STDIO and shuts its Edge process down', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(packageDir, 'dist', 'cli.js'), '--stdio', '--headless',
      '--viewport', '640x480', '--root', repositoryDir,
    ],
    cwd: repositoryDir,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-e2e', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 9);
  const opened = await client.callTool({
    name: 'open_preview',
    arguments: { path: path.join(repositoryDir, 'testdata', 'Форма.xml') },
  });
  assert.equal(opened.isError, undefined);
  assert.equal(opened.content.some((block) => block.type === 'image'), true);
  const closed = await client.callTool({ name: 'close_preview', arguments: {} });
  assert.equal(closed.isError, undefined);
});
