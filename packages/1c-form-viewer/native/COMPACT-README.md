# 1c-form-viewer Compact

Это компактный bootstrap-архив. Распакуйте его в постоянный каталог и один раз
запустите `install.ps1`. Скрипт скачает Node.js и production-зависимости в
подкаталоги `runtime` и `app/node_modules`. Сам архив не содержит Node.js.

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Подключение к MCP-агенту после установки:

```toml
[mcp_servers.one_c_form_viewer]
command = "C:\\Tools\\1c-form-viewer\\1c-form-viewer.exe"
args = ["--stdio", "--allow-any-path"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Для работы нужен Microsoft Edge. MCP работает read-only и не изменяет исходные
файлы.
