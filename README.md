# BSLView - Total Commander Lister Plugin

WLX-плагин для Total Commander, обеспечивающий просмотр файлов 1С:Предприятие (.bsl, .os, .sdbl, .query) с подсветкой синтаксиса по нажатию F3.

Основан на архитектуре [HTMLView](http://sites.google.com/site/htmlview/) / [wlx-markdown-viewer](https://github.com/rg-software/wlx-markdown-viewer) и грамматике из проекта [1c-syntax](https://github.com/1c-syntax/1c-syntax).

## Возможности

- Подсветка синтаксиса BSL/OneScript (ключевые слова, комментарии, строки, числа, даты, директивы препроцессора, аннотации, встроенные функции)
- Двуязычная поддержка (русский + английский синтаксис 1С)
- Поддержка светлой и темной темы (автоматически определяется по настройкам TC)
- Нумерация строк
- Поиск текста (F7 в Lister)
- Копирование (Ctrl+C) и выделение всего (Ctrl+A)
- Автоопределение кодировки (UTF-8, UTF-16, Windows-1251)
- Поддерживаемые расширения: `.bsl`, `.os`, `.sdbl`, `.query`
- 32-bit и 64-bit версии

## Сборка

### Требования

- Visual Studio 2022 (Community/Professional/Enterprise)
- Компонент "Desktop development with C++" (C++ workload)
- Windows SDK 10.0

### Компиляция

1. Откройте `BSLView.sln` в Visual Studio 2022
2. Выберите конфигурацию:
   - `Release | Win32` — для 32-bit TC (BSLView.wlx)
   - `Release | x64` — для 64-bit TC (BSLView.wlx64)
3. Build -> Build Solution (Ctrl+Shift+B)
4. Результат будет в `bin\Release\x32\` или `bin\Release\x64\`

### Компиляция из командной строки

```batch
:: Откройте Developer Command Prompt for VS 2022
:: 32-bit:
msbuild BSLView.sln /p:Configuration=Release /p:Platform=Win32
:: 64-bit:
msbuild BSLView.sln /p:Configuration=Release /p:Platform=x64
```

## Установка

### Автоматическая (рекомендуется)

1. Скопируйте `BSLView.wlx` (и/или `BSLView.wlx64`), `BSLView.ini`, `pluginst.inf` в ZIP-архив
2. Откройте архив в Total Commander — установка предложится автоматически

### Ручная

1. Скопируйте файлы в папку `%COMMANDER_PATH%\plugins\wlx\BSLView\`:
   - `BSLView.wlx` (32-bit) и/или `BSLView.wlx64` (64-bit)
   - `BSLView.ini`
2. В Total Commander: Configuration -> Options -> Plugins -> Lister (WLX)
3. Нажмите "Add" и выберите `BSLView.wlx` / `BSLView.wlx64`

## Настройка

Настройки хранятся в `BSLView.ini` рядом с плагином:

```ini
[Options]
FontFamily=Consolas, Courier New, monospace
FontSize=14
TabSize=4
LineNumbers=1

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
| Встроенные функции | `Сообщить`, `СтрДлина`, `Формат`, `ТипЗнч` и др. |

## Лицензия

MIT
