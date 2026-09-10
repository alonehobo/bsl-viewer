# 1c-form-viewer

Локальный read-only MCP-сервер для визуального просмотра управляемых форм 1С,
`Template.xml` и MXL. Сервер использует существующие рендереры BSLView и управляет
одним окном Microsoft Edge через Playwright. Требуются Windows, Node.js 20+ и Edge.

## Запуск

```powershell
npx -y 1c-form-viewer@0.1.0 --stdio --root "C:\work\configuration"
```

`--root` можно передавать несколько раз. Файлы читаются только после `realpath` и
только из разрешённых корней. Дополнительные параметры:

```text
--viewport 1440x900
--headless
--max-bytes 67108864
```

## Инструменты MCP

- `open_preview(path)` открывает `Form.xml`, `Template.xml` или MXL.
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

## Codex

Добавьте в общую конфигурацию Codex (`config.toml`):

```toml
[mcp_servers.one_c_form_viewer]
command = "npx"
args = ["-y", "1c-form-viewer@0.1.0", "--stdio", "--root", "C:\\work\\configuration"]
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
      "args": ["-y", "1c-form-viewer@0.1.0", "--stdio", "--root", "C:\\work\\configuration"]
    }
  }
}
```

## Claude Code

```powershell
claude mcp add --transport stdio 1c-form-viewer -- npx -y 1c-form-viewer@0.1.0 --stdio --root "C:\work\configuration"
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

