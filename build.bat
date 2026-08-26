@echo off
setlocal enabledelayedexpansion

set MSVC=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207
set WINSDK=C:\Program Files (x86)\Windows Kits\10
set SDKVER=10.0.26100.0

rem Build from wherever the repository actually lives.
set SRC=%~dp0
if "%SRC:~-1%"=="\" set SRC=%SRC:~0,-1%

set WV2SDK=%SRC%\webview2sdk\build\native
set INCLUDE=%MSVC%\include;%MSVC%\atlmfc\include;%WINSDK%\Include\%SDKVER%\ucrt;%WINSDK%\Include\%SDKVER%\um;%WINSDK%\Include\%SDKVER%\shared;%WINSDK%\Include\%SDKVER%\winrt;%WV2SDK%\include
set LIBS=ole32.lib oleaut32.lib uuid.lib shlwapi.lib shell32.lib comdlg32.lib user32.lib kernel32.lib advapi32.lib gdi32.lib
set CFLAGS=/nologo /O2 /MT /std:c++17 /EHsc /W3 /wd4584 /utf-8 /D_CRT_SECURE_NO_WARNINGS /DNDEBUG /DWIN32 /D_WINDOWS
set PLUGIN_SRC="%SRC%\main.cpp" "%SRC%\bslcommon.cpp" "%SRC%\browserhost.cpp" "%SRC%\bslhighlight.cpp" "%SRC%\webview2host.cpp"

if not exist "%WV2SDK%\include\WebView2.h" (
    echo FAILED: WebView2 SDK not found at %WV2SDK%
    exit /b 1
)

if not exist "%SRC%\web\vs\loader.js" (
    echo Monaco assets missing, fetching...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\tools\fetch-monaco.ps1"
    if errorlevel 1 (
        echo FAILED: could not fetch Monaco
        exit /b 1
    )
)

for %%D in (obj32 obj64 objexe) do if not exist "%SRC%\%%D" mkdir "%SRC%\%%D"

set FAILED=0

echo ========================================
echo Building 32-bit BSLView.wlx
echo ========================================
set PATH=%MSVC%\bin\Hostx64\x86;%PATH%
set LIB=%MSVC%\lib\x86;%MSVC%\atlmfc\lib\x86;%WINSDK%\Lib\%SDKVER%\ucrt\x86;%WINSDK%\Lib\%SDKVER%\um\x86
cd /d "%SRC%\obj32"
cl.exe %CFLAGS% /D_USRDLL %PLUGIN_SRC% ^
  /Fe:"%SRC%\BSLView.wlx" ^
  /link /DLL /DEF:"%SRC%\exports.def" /IMPLIB:"%SRC%\obj32\BSLView.lib" %LIBS% "%WV2SDK%\x86\WebView2LoaderStatic.lib"
if errorlevel 1 (set FAILED=1& echo FAILED: 32-bit build) else (echo SUCCESS: BSLView.wlx)

echo.
echo ========================================
echo Building 64-bit BSLView.wlx64
echo ========================================
set PATH=%MSVC%\bin\Hostx64\x64;%PATH%
set LIB=%MSVC%\lib\x64;%MSVC%\atlmfc\lib\x64;%WINSDK%\Lib\%SDKVER%\ucrt\x64;%WINSDK%\Lib\%SDKVER%\um\x64
cd /d "%SRC%\obj64"
cl.exe %CFLAGS% /D_USRDLL %PLUGIN_SRC% ^
  /Fe:"%SRC%\BSLView.wlx64" ^
  /link /DLL /DEF:"%SRC%\exports.def" /IMPLIB:"%SRC%\obj64\BSLView.lib" %LIBS% "%WV2SDK%\x64\WebView2LoaderStatic.lib"
if errorlevel 1 (set FAILED=1& echo FAILED: 64-bit build) else (echo SUCCESS: BSLView.wlx64)

echo.
echo ========================================
echo Building 64-bit BSLEdit.exe
echo ========================================
cd /d "%SRC%\objexe"
cl.exe %CFLAGS% "%SRC%\bsledit.cpp" "%SRC%\bslcommon.cpp" "%SRC%\webview2host.cpp" ^
  /Fe:"%SRC%\BSLEdit.exe" ^
  /link %LIBS% "%WV2SDK%\x64\WebView2LoaderStatic.lib" /SUBSYSTEM:WINDOWS
if errorlevel 1 (set FAILED=1& echo FAILED: BSLEdit.exe build) else (echo SUCCESS: BSLEdit.exe)

cd /d "%SRC%"
echo.
if "%FAILED%"=="1" (echo Done with errors.& exit /b 1)
echo Done.
