# 1c-form-viewer

Отдельный локальный read-only MCP-продукт для визуального просмотра управляемых
форм 1С, `Template.xml` и MXL. Подключается к любому MCP-агенту одной командой
и не требует установки 1С или конфигуратора.

Основной npm-вариант требует Windows, Node.js 20+ и современный браузер. Для
компактного подключения без Node.js используйте нативный Windows-вариант ниже.

## Запуск

Самое простое подключение — разрешить read-only просмотр по абсолютному пути:

```powershell
npx -y 1c-form-viewer@0.1.0 --stdio --allow-any-path
```

После этого агенту можно дать обычную просьбу вроде:

```text
Открой форму C:\work\configuration\Catalogs\Товары\Forms\ФормаЭлемента\Ext\Form.xml
```

Агент вызывает `open_preview` с этим адресом. Для ограниченного режима вместо
`--allow-any-path` укажите один или несколько `--root`:

```powershell
npx -y 1c-form-viewer@0.1.0 --stdio --root "C:\work\configuration"
```

`--root` можно передавать несколько раз. Файлы читаются только после `realpath` и
только из разрешённых корней. `--allow-any-path` явно включает чтение абсолютных
путей вне `--root`; запись файлов, произвольный JavaScript и произвольные сетевые
запросы сервер всё равно не выполняет. Дополнительные параметры:

```text
--viewport 1440x900
--headless
--max-bytes 67108864
```

## Инструменты MCP

- `open_preview(path)` открывает `Form.xml`, `Template.xml` или MXL.
- `get_preview_url()` возвращает loopback-URL для открытия текущего превью во
  внутреннем браузере MCP-клиента; отдельное окно Edge при этом продолжает работать.
- `reload_preview()` перечитывает файл и сохраняет доступные активные страницы.
- `inspect_preview(query?, visible_only?)` возвращает элементы, вкладки и прокрутки.
- `switch_tab(page_id, pages_id?)` переключает обычную или вложенную страницу.
- `select_element(element_id)` открывает родительские страницы и выделяет элемент.
- `scroll_preview(...)` прокручивает документ, страницу, таблицу или табличное поле.
- `capture_preview(scope, element_id?)` возвращает PNG окна, документа или элемента.
- `close_preview()` закрывает принадлежащую серверу сессию Edge.

Все навигационные команды возвращают структурированное состояние и PNG того же окна,
которое видит пользователь. Сервер не выполняет произвольный JavaScript, не принимает
CSS-селекторы и не изменяет исходные файлы.

Для клиентов со встроенным браузером после `open_preview` вызовите
`get_preview_url` и откройте возвращённый URL. Это отдельная read-only вкладка,
загружающая текущий документ из loopback-сервера; внешний Edge остаётся штатным
управляемым окном и не заменяется.

## Подключение из скачанного архива

Если npm-публикация недоступна, скачайте `1c-form-viewer-0.1.0.tgz` и установите
его в отдельный каталог:

```powershell
npm install --prefix "C:\Tools\1c-form-viewer" "C:\Downloads\1c-form-viewer-0.1.0.tgz"
```

В конфигурации MCP укажите локальный CLI:

```json
{
  "command": "node",
  "args": [
    "C:\\Tools\\1c-form-viewer\\node_modules\\1c-form-viewer\\dist\\cli.js",
    "--stdio",
    "--allow-any-path"
  ]
}
```

## Portable Windows-приложение

### Нативная компактная сборка

`1c-form-viewer-native-win-x64.zip` — самостоятельный нативный MCP-сервер размером
около 300 КБ в архиве. Он сам читает XML/MXL и поднимает loopback-сервер, а
рендеринг выполняется внешним браузером по умолчанию (Edge, Chrome и т.п.).
Node.js, npm, Playwright и браузер внутрь архива не входят.

```toml
[mcp_servers.one_c_form_viewer_native]
command = "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe"
args = ["--stdio", "--allow-any-path"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

`switch_tab`, `inspect_preview`, `select_element`, `scroll_preview` и
`capture_preview` выполняются самой открытой страницей через локальный командный
мост. Сервер не управляет конкретным браузером и не требует расширения.

Сборка:

```powershell
npm run build:native
```

Результат: `artifacts/1c-form-viewer-native-win-x64` и ZIP с тем же именем.

Для пользователей без Node.js можно собрать portable-архив:

```powershell
npm run build:portable
```

В результате появится каталог `artifacts/1c-form-viewer-win-x64` с
`1c-form-viewer.exe`, встроенным Node runtime и production-зависимостями.
MCP подключается непосредственно к `.exe`; в готовом архиве отдельная установка
Node.js и npm не нужна.

Если важен размер скачиваемого архива, используйте компактную сборку:

```powershell
npm run build:compact
```

`artifacts/1c-form-viewer-compact-win-x64.zip` занимает около 250 КБ. После
распаковки `install.ps1` подкачивает Node.js и production-зависимости один раз;
сам MCP затем подключается тем же `1c-form-viewer.exe`.

## Codex

Добавьте в общую конфигурацию Codex (`config.toml`):

```toml
[mcp_servers.one_c_form_viewer]
command = "npx"
args = ["-y", "1c-form-viewer@0.1.0", "--stdio", "--allow-any-path"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

## Cursor

Добавьте в `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "1c-form-viewer": {
      "command": "npx",
      "args": ["-y", "1c-form-viewer@0.1.0", "--stdio", "--allow-any-path"]
    }
  }
}
```

## Claude Code

```powershell
claude mcp add --transport stdio 1c-form-viewer -- npx -y 1c-form-viewer@0.1.0 --stdio --allow-any-path
```

## Разработка и публикация

Исходная база визуализации находится только в корневом `web/`. `npm run build`
компилирует MCP и побайтно копирует пять renderer-ассетов в генерируемый `dist/web`.
Файл `viewer.js` и Monaco в пакет не включаются. `npm run verify:assets` проверяет
побайтовое совпадение и состав сборки.

Перед публикацией:

```powershell
npm test
npm pack --dry-run
npm pack
npm install --ignore-scripts --prefix <empty-directory> .\1c-form-viewer-0.1.0.tgz
npm view 1c-form-viewer name version
```

Если имя уже занято в npm, публикацию нужно остановить. `npm publish --access public`
запускает только авторизованный владелец пакета.
