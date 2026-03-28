@echo off
setlocal

set MSVC=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207
set WINSDK=C:\Program Files (x86)\Windows Kits\10
set SDKVER=10.0.26100.0
set SRC=C:\Yandex.Disk\Cursor\tc-bsl-viewer

set INCLUDE=%MSVC%\include;%MSVC%\atlmfc\include;%WINSDK%\Include\%SDKVER%\ucrt;%WINSDK%\Include\%SDKVER%\um;%WINSDK%\Include\%SDKVER%\shared
set LIBS=ole32.lib oleaut32.lib uuid.lib shlwapi.lib user32.lib kernel32.lib advapi32.lib gdi32.lib

echo ========================================
echo Building 32-bit BSLView.wlx
echo ========================================

set PATH=%MSVC%\bin\Hostx64\x86;%PATH%
set LIB=%MSVC%\lib\x86;%MSVC%\atlmfc\lib\x86;%WINSDK%\Lib\%SDKVER%\ucrt\x86;%WINSDK%\Lib\%SDKVER%\um\x86

cd /d "%SRC%\obj32"
cl.exe /nologo /O2 /MT /std:c++17 /EHsc /W3 /wd4584 /D_CRT_SECURE_NO_WARNINGS /DNDEBUG /DWIN32 /D_WINDOWS /D_USRDLL ^
  "%SRC%\main.cpp" "%SRC%\browserhost.cpp" "%SRC%\bslhighlight.cpp" ^
  /Fe:"%SRC%\BSLView.wlx" ^
  /link /DLL /DEF:"%SRC%\exports.def" /IMPLIB:"%SRC%\obj32\BSLView.lib" %LIBS%

if errorlevel 1 (
    echo FAILED: 32-bit build
    goto build64
)
echo SUCCESS: BSLView.wlx created

:build64
echo.
echo ========================================
echo Building 64-bit BSLView.wlx64
echo ========================================

set PATH=%MSVC%\bin\Hostx64\x64;%PATH%
set LIB=%MSVC%\lib\x64;%MSVC%\atlmfc\lib\x64;%WINSDK%\Lib\%SDKVER%\ucrt\x64;%WINSDK%\Lib\%SDKVER%\um\x64

cd /d "%SRC%\obj64"
cl.exe /nologo /O2 /MT /std:c++17 /EHsc /W3 /wd4584 /D_CRT_SECURE_NO_WARNINGS /DNDEBUG /DWIN32 /D_WINDOWS /D_USRDLL ^
  "%SRC%\main.cpp" "%SRC%\browserhost.cpp" "%SRC%\bslhighlight.cpp" ^
  /Fe:"%SRC%\BSLView.wlx64" ^
  /link /DLL /DEF:"%SRC%\exports.def" /IMPLIB:"%SRC%\obj64\BSLView.lib" %LIBS%

if errorlevel 1 (
    echo FAILED: 64-bit build
    goto end
)
echo SUCCESS: BSLView.wlx64 created

:end
echo.
echo Done.
