# 1c-form-viewer Portable

Распакуйте архив в постоянный каталог. Установка Node.js и npm не требуется;
нужен только Microsoft Edge.

Подключение к MCP-агенту:

```toml
[mcp_servers.one_c_form_viewer]
command = "C:\\Tools\\1c-form-viewer\\1c-form-viewer.exe"
args = ["--stdio", "--allow-any-path"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

После подключения передайте агенту абсолютный путь к `Form.xml`, `Template.xml`
или MXL-файлу. Для ограничения доступа вместо `--allow-any-path` используйте
один или несколько аргументов `--root`.

Приложение работает read-only и не изменяет исходные файлы.
