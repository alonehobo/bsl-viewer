# BSLView - Total Commander Lister Plugin

WLX-плагин для Total Commander, обеспечивающий просмотр и редактирование файлов 1С:Предприятие (.bsl, .os, .sdbl, .query) с подсветкой синтаксиса по нажатию F3.

Использует [Monaco Editor](https://microsoft.github.io/monaco-editor/) (движок VS Code) через WebView2 с полной подсветкой синтаксиса BSL. При отсутствии WebView2 — fallback на встроенный C++ подсветчик через IE.

Цветовая схема подсветки соответствует конфигуратору 1С (на основе проекта [bsl_console](https://github.com/salexdv/bsl_console)).

## Возможности

- **Monaco Editor** с подсветкой синтаксиса BSL/OneScript
- Цветовая схема как в Конфигураторе 1С (светлая тема) и VS Code (темная тема)
- **Панель процедур/функций** (outline) справа с фильтром, сортировкой и изменяемым размером
- **Группировка по областям** (#Область / #Region) в панели процедур
- **Режим редактирования** с сохранением (Ctrl+S)
- **Переключатель темы** (светлая/темная) с автоопределением по настройкам TC
- Двуязычная поддержка (русский + английский синтаксис 1С)
- Minimap (карта кода)
- Нумерация строк, сворачивание блоков (folding)
- Автоопределение кодировки (UTF-8 BOM, UTF-8, UTF-16 LE/BE, Windows-1251)
- Поддерживаемые расширения: `.bsl`, `.os`, `.sdbl`, `.query`
- 32-bit и 64-bit версии
- Fallback на C++ подсветчик через IE при отсутствии WebView2

## BSLEdit - автономный редактор

В комплекте идет **BSLEdit.exe** — автономный редактор BSL файлов на базе Monaco Editor:

- Открытие файлов через командную строку или диалог выбора файла
- Автоматическая ассоциация с файлами `.bsl` и `.os` при первом запуске
- Автоопределение темы (светлая/темная) по настройкам Windows
- Полный набор функций: панель процедур, фильтр, сортировка, редактирование, сохранение

## Скриншоты

### Светлая тема (стиль Конфигуратора 1С)
Ключевые слова — красные, идентификаторы — синие, комментарии — зеленые, строки и числа — черные.

### Темная тема
Ключевые слова — бирюзовые, строки — оранжевые, комментарии — зеленые, числа — светло-зеленые.

## Сборка

### Требования

- Visual Studio 2022 Build Tools (или полная VS 2022)
- Компонент "Desktop development with C++"
- Windows SDK 10.0
- WebView2 SDK (включен в репозиторий как `webview2sdk/`)

### Компиляция

Запустите `build.bat` из Developer Command Prompt:

```batch
build.bat
```

Скрипт соберет:
- `BSLView.wlx` — 32-bit плагин для Total Commander
- `BSLView.wlx64` — 64-bit плагин для Total Commander
- `BSLEdit.exe` — 64-bit автономный редактор

### Структура проекта

| Файл | Описание |
|------|----------|
| `main.cpp` | Точка входа WLX-плагина, экспорты API Lister |
| `bsledit.cpp` | Точка входа BSLEdit.exe |
| `monaco_template.h` | HTML/JS шаблон Monaco Editor с токенизатором BSL |
| `webview2host.cpp/h` | Обертка над WebView2 (создание, навигация, сохранение) |
| `browserhost.cpp/h` | Обертка над IE WebBrowser (fallback) |
| `bslhighlight.cpp/h` | C++ подсветчик BSL для IE fallback |
| `BSLView.ini` | Конфигурация плагина |
| `build.bat` | Скрипт сборки |
| `exports.def` | DEF-файл экспортов DLL |

## Установка плагина

### Автоматическая (рекомендуется)

1. Скачайте `BSLView.zip` из [Releases](../../releases)
2. Откройте архив в Total Commander — установка предложится автоматически

### Ручная

1. Скопируйте файлы в папку `%COMMANDER_PATH%\plugins\wlx\BSLView\`:
   - `BSLView.wlx` (32-bit) и/или `BSLView.wlx64` (64-bit)
   - `BSLView.ini`
2. В Total Commander: Configuration -> Options -> Plugins -> Lister (WLX)
3. Нажмите "Add" и выберите `BSLView.wlx` / `BSLView.wlx64`

## Установка BSLEdit

1. Скачайте `BSLEdit.zip` из [Releases](../../releases)
2. Распакуйте `BSLEdit.exe` в любую папку
3. При первом запуске программа автоматически зарегистрирует ассоциацию файлов `.bsl` и `.os`

## Настройка

Настройки плагина хранятся в `BSLView.ini` рядом с плагином:

```ini
[Options]
FontFamily=Consolas, Courier New, monospace
FontSize=14
TabSize=4
LineNumbers=1
Theme=auto    ; auto (по настройкам TC), light, dark
UseMonaco=1   ; 1 = Monaco Editor, 0 = IE fallback

[Extensions]
BSLExtensions=bsl;os
QueryExtensions=sdbl;query
```

## Подсвечиваемые элементы

| Элемент | Примеры |
|---------|---------|
| Ключевые слова | `Если`/`If`, `Тогда`/`Then`, `Процедура`/`Procedure`, `Возврат`/`Return` |
| Комментарии | `// комментарий` |
| Строки | `"текст"`, многострочные с `\|` |
| Числа | `123`, `3.14` |
| Даты | `'20250101'` |
| Препроцессор | `#Область`/`#Region`, `#Если`/`#If` |
| Аннотации | `&НаСервере`/`&AtServer`, `&НаКлиенте`/`&AtClient` |
| Константы | `Истина`/`True`, `Ложь`/`False`, `Неопределено`/`Undefined`, `NULL` |

## Зависимости

- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) — для Monaco Editor (обычно уже установлен с Windows 10/11)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — загружается с CDN при первом открытии

## Лицензия

MIT
