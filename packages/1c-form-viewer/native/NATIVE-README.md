# 1C Form Viewer — native MCP

Это компактный Windows-вариант MCP-сервера без Node.js, npm и Playwright.

Приложение само читает XML/MXL и поднимает защищённый localhost-сервер. Интерфейс и
рендерер открываются во внешнем браузере по умолчанию — Edge, Chrome или другом
современном браузере.

```toml
[mcp_servers.one_c_form_viewer_native]
command = "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe"
args = ["--stdio", "--allow-any-path"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Поддерживаются открытие файла, переключение вкладок формы, инспекция, выделение
элемента, прокрутка и захват PNG. Команды просмотра выполняются JavaScript-кодом
самой открытой страницы через loopback-мост; браузером приложение не управляет.

Доступ к файлам лучше ограничить:

```toml
args = ["--stdio", "--root", "C:\\Work\\Configuration"]
```

`--allow-any-path` оставляет read-only режим, но разрешает передавать любые локальные
пути.
