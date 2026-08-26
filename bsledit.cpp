#include <windows.h>
#include <ole2.h>
#include <string>
#include <shellapi.h>
#include <commdlg.h>
#include <shlobj.h>

#include "webview2host.h"
#include "bslcommon.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "shell32.lib")

static CWebView2Host* g_webView = NULL;
static const wchar_t* WNDCLASS_NAME = L"BSLEditMainWnd";
static const wchar_t* APP_TITLE = L"BSL Editor";
static const DWORD MAX_FILE_BYTES = 256u * 1024u * 1024u;

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_SIZE:
        if (g_webView) g_webView->Resize();
        return 0;

    case WM_BSLVIEW_WEBVIEW_FAILED:
        {
            HRESULT hr = CWebView2Host::LastError();
            if (!hr) hr = (HRESULT)wParam;
            wchar_t text[640];
            wsprintfW(text,
                L"Не удалось запустить WebView2 (0x%08X).\n\n"
                L"Если Runtime уже установлен, закройте Total Commander и откройте редактор снова — "
                L"плагин мог занять профиль браузера.\n\n"
                L"Иначе установите Microsoft Edge WebView2 Runtime:\n"
                L"https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                (unsigned)hr);
            MessageBoxW(hwnd, text, APP_TITLE, MB_OK | MB_ICONERROR);
            DestroyWindow(hwnd);
        }
        return 0;

    case WM_DESTROY:
        if (g_webView) {
            g_webView->Close();
            g_webView->Release();
            g_webView = NULL;
        }
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static std::wstring GetFileFromCmdLine()
{
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::wstring result;
    if (argv && argc > 1) result = argv[1];
    if (argv) LocalFree(argv);
    return result;
}

static void RegisterFileAssociation()
{
    wchar_t exePath[MAX_PATH];
    if (!GetModuleFileNameW(NULL, exePath, MAX_PATH)) return;

    HKEY hKey;
    wchar_t existing[MAX_PATH] = {};
    DWORD sz = sizeof(existing);
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\.bsl", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        RegQueryValueExW(hKey, NULL, NULL, NULL, (BYTE*)existing, &sz);
        RegCloseKey(hKey);
        if (wcscmp(existing, L"BSLEdit.File") == 0) return;
    }

    const wchar_t* exts[] = { L".bsl", L".os" };
    for (int i = 0; i < 2; i++) {
        std::wstring key = std::wstring(L"Software\\Classes\\") + exts[i];
        if (RegCreateKeyExW(HKEY_CURRENT_USER, key.c_str(), 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) != ERROR_SUCCESS)
            continue;
        const wchar_t* val = L"BSLEdit.File";
        RegSetValueExW(hKey, NULL, 0, REG_SZ, (const BYTE*)val, (DWORD)(wcslen(val) + 1) * 2);
        RegCloseKey(hKey);
    }

    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\BSLEdit.File", 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS) {
        const wchar_t* desc = L"1C:Enterprise BSL Module";
        RegSetValueExW(hKey, NULL, 0, REG_SZ, (const BYTE*)desc, (DWORD)(wcslen(desc) + 1) * 2);
        RegCloseKey(hKey);
    }

    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\BSLEdit.File\\DefaultIcon", 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS) {
        std::wstring iconVal = std::wstring(exePath) + L",0";
        RegSetValueExW(hKey, NULL, 0, REG_SZ, (const BYTE*)iconVal.c_str(), (DWORD)(iconVal.size() + 1) * 2);
        RegCloseKey(hKey);
    }

    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\BSLEdit.File\\shell\\open\\command", 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS) {
        std::wstring cmdVal = std::wstring(L"\"") + exePath + L"\" \"%1\"";
        RegSetValueExW(hKey, NULL, 0, REG_SZ, (const BYTE*)cmdVal.c_str(), (DWORD)(cmdVal.size() + 1) * 2);
        RegCloseKey(hKey);
    }

    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
}

static std::wstring OpenFileDialog(HWND hParent)
{
    wchar_t filePath[MAX_PATH] = {};
    OPENFILENAMEW ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = hParent;
    ofn.lpstrFilter =
        L"Supported files\0*.bsl;*.os;*.sdbl;*.query;*.md;*.markdown;*.json;*.xml;*.ps1;*.psm1;*.psd1;*.html;*.htm\0"
        L"BSL files (*.bsl;*.os)\0*.bsl;*.os\0"
        L"Markdown (*.md)\0*.md;*.markdown\0"
        L"JSON (*.json)\0*.json\0"
        L"XML (*.xml)\0*.xml\0"
        L"PowerShell (*.ps1)\0*.ps1;*.psm1;*.psd1\0"
        L"HTML (*.html)\0*.html;*.htm\0"
        L"All files (*.*)\0*.*\0";
    ofn.lpstrFile = filePath;
    ofn.nMaxFile = MAX_PATH;
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    ofn.lpstrTitle = L"Открыть файл BSL";
    return GetOpenFileNameW(&ofn) ? std::wstring(filePath) : std::wstring();
}

static bool SystemUsesDarkTheme()
{
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                      0, KEY_READ, &hKey) != ERROR_SUCCESS)
        return false;

    DWORD val = 1, sz = sizeof(val), type = 0;
    bool dark = false;
    if (RegQueryValueExW(hKey, L"AppsUseLightTheme", NULL, &type, (BYTE*)&val, &sz) == ERROR_SUCCESS && type == REG_DWORD)
        dark = (val == 0);
    RegCloseKey(hKey);
    return dark;
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR, int nCmdShow)
{
    OleInitialize(NULL);

    // Getting Chromium up is the slowest part of startup, so start it before
    // touching the registry, the file dialog or the disk. Nothing is parked:
    // a single-window app has no second open to speed up.
    CWebView2Host::WarmUp(ModuleDirectory(GetModuleHandleW(NULL)) + L"web", false);

    RegisterFileAssociation();

    std::wstring filePath = GetFileFromCmdLine();
    if (filePath.empty()) {
        filePath = OpenFileDialog(NULL);
        if (filePath.empty()) return 0;
    }

    TextFile file = ReadTextFile(filePath.c_str(), MAX_FILE_BYTES);
    if (!file.ok) {
        MessageBoxW(NULL, L"Не удалось прочитать файл (отсутствует, недоступен или слишком большой).",
                    APP_TITLE, MB_OK | MB_ICONERROR);
        return 1;
    }

    std::wstring webRoot = ModuleDirectory(GetModuleHandleW(NULL)) + L"web";
    if (GetFileAttributesW((webRoot + L"\\viewer.html").c_str()) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL,
            L"Не найдена папка web рядом с BSLEdit.exe.\n\n"
            L"Распакуйте архив целиком, включая подпапку web.",
            APP_TITLE, MB_OK | MB_ICONERROR);
        return 1;
    }

    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursorW(NULL, MAKEINTRESOURCEW(32512));   // IDC_ARROW
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = WNDCLASS_NAME;
    wc.hIcon = LoadIconW(NULL, MAKEINTRESOURCEW(32512));       // IDI_APPLICATION
    RegisterClassExW(&wc);

    size_t slash = filePath.find_last_of(L"\\/");
    std::wstring title = std::wstring(APP_TITLE) + L" - "
                       + (slash == std::wstring::npos ? filePath : filePath.substr(slash + 1));

    HWND hwnd = CreateWindowExW(0, WNDCLASS_NAME, title.c_str(),
                                WS_OVERLAPPEDWINDOW,
                                CW_USEDEFAULT, CW_USEDEFAULT, 1200, 800,
                                NULL, NULL, hInstance, NULL);
    if (!hwnd) {
        MessageBoxW(NULL, L"Failed to create window.", APP_TITLE, MB_OK | MB_ICONERROR);
        return 1;
    }

    ShowWindow(hwnd, nCmdShow);
    UpdateWindow(hwnd);

    g_webView = CWebView2Host::Acquire(hwnd, webRoot);
    g_webView->mFilePath = filePath;
    g_webView->mEncoding = file.encoding;

    BslLoadRequest req;
    req.content  = file.text;
    req.language = MonacoLanguageForPath(filePath.c_str());
    req.dark     = SystemUsesDarkTheme();
    req.fontSize = 14;
    req.readOnly = false;   // standalone editor opens ready to edit
    g_webView->Load(req);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    CWebView2Host::Shutdown();
    OleUninitialize();
    return (int)msg.wParam;
}
