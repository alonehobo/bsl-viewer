# 1C Form Viewer для VS Code

Расширение открывает визуальный read-only preview управляемых форм 1С,
`Template.xml` и текстовых MXL рядом с исходным файлом. Используются те же
renderer-ы, что и в BSLView и `1c-form-viewer`.

Для открытого `.xml` или `.mxl` файла кнопка `1C Preview` доступна в статус-баре
справа внизу и, если хватает места, в заголовке редактора. Также остаются
Command Palette и контекстное меню файла.

## Использование

1. Откройте `.xml` или `.mxl` в VS Code.
2. Запустите `1C: Open Visual Preview` через Command Palette или контекстное
   меню файла.
3. Выберите элемент в дереве слева, чтобы подсветить его в макете и перейти к
   соответствующей строке исходника.

Preview не изменяет файл. После сохранения или внешнего изменения исходника он
перечитывается автоматически.

## Разработка

Из корня репозитория:

```powershell
npm test --workspace=1c-form-viewer-vscode
```

Для локального запуска откройте корень репозитория в VS Code и нажмите `F5`,
выбрав конфигурацию `Run 1C Form Viewer Extension`. Откроется отдельное окно
`Extension Development Host`; в нём запустите `1C: Open Visual Preview`.

Для создания установочного VSIX из корня репозитория:

```powershell
$root = "C:\Users\Serge\YandexDisk\Cursor\OtherProjects\tc-bsl-viewer"
Set-Location "$root\packages\1c-form-viewer-vscode"
npm run build
npx --yes @vscode/vsce package --no-dependencies --out "$root\1c-form-viewer-vscode-0.1.4.vsix"
code --install-extension "$root\1c-form-viewer-vscode-0.1.4.vsix" --force
```

Сборка ассетов выполняется из корневой папки `web/`:

```powershell
npm run build --workspace=1c-form-viewer-vscode
```
