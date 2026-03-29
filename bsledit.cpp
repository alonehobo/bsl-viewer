#include <windows.h>
#include <ole2.h>
#include <string>
#include <vector>
#include <shellapi.h>
#include <commdlg.h>
#include <shlobj.h>

#include "webview2host.h"
#include "monaco_template.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "shell32.lib")

static CWebView2Host* g_webView = NULL;
static std::wstring g_filePath;
static const wchar_t* WNDCLASS_NAME = L"BSLEditMainWnd";
static const wchar_t* APP_TITLE = L"BSL Editor";

// --- File reading (same as in main.cpp) ---

static std::wstring ReadFileToWString(const wchar_t* path)
{
    HANDLE hFile = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return L"";

    DWORD fileSize = GetFileSize(hFile, NULL);
    if (fileSize == 0 || fileSize == INVALID_FILE_SIZE) { CloseHandle(hFile); return L""; }

    std::vector<BYTE> data(fileSize);
    DWORD bytesRead = 0;
    ReadFile(hFile, data.data(), fileSize, &bytesRead, NULL);
    CloseHandle(hFile);
    if (bytesRead < fileSize) data.resize(bytesRead);

    const BYTE* p = data.data();
    size_t sz = data.size();

    // UTF-8 BOM
    if (sz >= 3 && p[0] == 0xEF && p[1] == 0xBB && p[2] == 0xBF) {
        int wlen = MultiByteToWideChar(CP_UTF8, 0, (const char*)p + 3, (int)(sz - 3), NULL, 0);
        std::wstring result(wlen, 0);
        MultiByteToWideChar(CP_UTF8, 0, (const char*)p + 3, (int)(sz - 3), &result[0], wlen);
        return result;
    }
    // UTF-16 LE BOM
    if (sz >= 2 && p[0] == 0xFF && p[1] == 0xFE)
        return std::wstring((const wchar_t*)(p + 2), (sz - 2) / sizeof(wchar_t));
    // UTF-16 BE BOM
    if (sz >= 2 && p[0] == 0xFE && p[1] == 0xFF) {
        std::wstring result((sz - 2) / sizeof(wchar_t), 0);
        for (size_t i = 0; i < result.size(); i++)
            result[i] = (wchar_t)((p[2 + i * 2] << 8) | p[2 + i * 2 + 1]);
        return result;
    }
    // Try UTF-8
    int wlen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char*)p, (int)sz, NULL, 0);
    if (wlen > 0) {
        std::wstring result(wlen, 0);
        MultiByteToWideChar(CP_UTF8, 0, (const char*)p, (int)sz, &result[0], wlen);
        return result;
    }
    // Fallback: Windows-1251
    wlen = MultiByteToWideChar(1251, 0, (const char*)p, (int)sz, NULL, 0);
    std::wstring result(wlen, 0);
    MultiByteToWideChar(1251, 0, (const char*)p, (int)sz, &result[0], wlen);
    return result;
}

// --- JS escaping ---

static std::string JsEscapeWide(const std::wstring& src)
{
    std::string out;
    out.reserve(src.size() * 2);
    for (wchar_t ch : src) {
        if (ch == L'\\') out += "\\\\";
        else if (ch == L'\'') out += "\\'";
        else if (ch == L'\n') out += "\\n";
        else if (ch == L'\r') out += "\\r";
        else if (ch == L'\t') out += "\\t";
        else if (ch < 0x20) { /* skip */ }
        else if (ch < 0x80) out += (char)ch;
        else {
            if (ch < 0x800) {
                out += (char)(0xC0 | (ch >> 6));
                out += (char)(0x80 | (ch & 0x3F));
            } else {
                out += (char)(0xE0 | (ch >> 12));
                out += (char)(0x80 | ((ch >> 6) & 0x3F));
                out += (char)(0x80 | (ch & 0x3F));
            }
        }
    }
    return out;
}

// --- Generate HTML ---

static std::string GenerateMonacoHTML(const std::wstring& content, bool darkMode, int fontSize)
{
    std::string html(MONACO_HTML_PART1);
    html += MONACO_HTML_PART2;

    std::string theme = darkMode ? "bsl-dark" : "bsl-light";
    for (size_t pos = html.find("%THEME%"); pos != std::string::npos; pos = html.find("%THEME%", pos))
        html.replace(pos, 7, theme);

    std::string fs = std::to_string(fontSize > 0 ? fontSize : 14);
    for (size_t pos = html.find("%FONTSIZE%"); pos != std::string::npos; pos = html.find("%FONTSIZE%", pos))
        html.replace(pos, 10, fs);

    // Set readOnly to false for editor mode
    {
        size_t pos = html.find("readOnly: true");
        if (pos != std::string::npos) html.replace(pos, 14, "readOnly: false");
    }

    std::string escaped = "'" + JsEscapeWide(content) + "'";
    size_t pos = html.find("BSL_CONTENT");
    if (pos != std::string::npos) html.replace(pos, 11, escaped);

    return html;
}

// --- Write temp HTML ---

static std::wstring WriteTempHTML(const std::string& html)
{
    wchar_t tempDir[MAX_PATH];
    GetTempPathW(MAX_PATH, tempDir);
    std::wstring tempPath = std::wstring(tempDir) + L"BSLEdit_monaco.html";

    HANDLE hFile = CreateFileW(tempPath.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return L"";

    BYTE bom[] = {0xEF, 0xBB, 0xBF};
    DWORD written;
    WriteFile(hFile, bom, 3, &written, NULL);
    WriteFile(hFile, html.c_str(), (DWORD)html.size(), &written, NULL);
    CloseHandle(hFile);
    return tempPath;
}

// --- Window proc ---

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_SIZE:
        if (g_webView) g_webView->Resize();
        return 0;
    case WM_DESTROY:
        if (g_webView) {
            g_webView->Close();
            delete g_webView;
            g_webView = NULL;
        }
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// --- Parse command line for file path ---

static std::wstring GetFileFromCmdLine()
{
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::wstring result;
    if (argv && argc > 1) {
        result = argv[1];
        // Remove surrounding quotes if present
        if (result.size() >= 2 && result.front() == L'"' && result.back() == L'"')
            result = result.substr(1, result.size() - 2);
    }
    if (argv) LocalFree(argv);
    return result;
}

// --- Register file association ---

static void RegisterFileAssociation()
{
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(NULL, exePath, MAX_PATH);

    // Check if already registered
    HKEY hKey;
    wchar_t existing[MAX_PATH] = {};
    DWORD sz = sizeof(existing);
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\.bsl", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        RegQueryValueExW(hKey, NULL, NULL, NULL, (BYTE*)existing, &sz);
        RegCloseKey(hKey);
        if (wcscmp(existing, L"BSLEdit.File") == 0) return; // already registered
    }

    // .bsl -> BSLEdit.File
    const wchar_t* exts[] = { L".bsl", L".os" };
    for (int i = 0; i < 2; i++) {
        std::wstring key = std::wstring(L"Software\\Classes\\") + exts[i];
        RegCreateKeyExW(HKEY_CURRENT_USER, key.c_str(), 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL);
        const wchar_t* val = L"BSLEdit.File";
        RegSetValueExW(hKey, NULL, 0, REG_SZ, (BYTE*)val, (DWORD)(wcslen(val) + 1) * 2);
        RegCloseKey(hKey);
    }

    // BSLEdit.File description
    RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\BSLEdit.File", 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL);
    const wchar_t* desc = L"1C:Enterprise BSL Module";
    RegSetValueExW(hKey, NULL, 0, REG_SZ, (BYTE*)desc, (DWORD)(wcslen(desc) + 1) * 2);
    RegCloseKey(hKey);

    // Default icon
    RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\BSLEdit.File\\DefaultIcon", 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL);
    std::wstring iconVal = std::wstring(exePath) + L",0";
    RegSetValueExW(hKey, NULL, 0, REG_SZ, (BYTE*)iconVal.c_str(), (DWORD)(iconVal.size() + 1) * 2);
    RegCloseKey(hKey);

    // shell\open\command
    RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\BSLEdit.File\\shell\\open\\command", 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL);
    std::wstring cmdVal = std::wstring(L"\"") + exePath + L"\" \"%1\"";
    RegSetValueExW(hKey, NULL, 0, REG_SZ, (BYTE*)cmdVal.c_str(), (DWORD)(cmdVal.size() + 1) * 2);
    RegCloseKey(hKey);

    // Notify shell
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
}

// --- Open file dialog ---

static std::wstring OpenFileDialog(HWND hParent)
{
    wchar_t filePath[MAX_PATH] = {};
    OPENFILENAMEW ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = hParent;
    ofn.lpstrFilter = L"BSL files (*.bsl;*.os)\0*.bsl;*.os\0All files (*.*)\0*.*\0";
    ofn.lpstrFile = filePath;
    ofn.nMaxFile = MAX_PATH;
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
    ofn.lpstrTitle = L"Открыть файл BSL";
    if (GetOpenFileNameW(&ofn))
        return filePath;
    return L"";
}

// --- Entry point ---

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR, int nCmdShow)
{
    OleInitialize(NULL);

    // Register file association on first run
    RegisterFileAssociation();

    g_filePath = GetFileFromCmdLine();
    if (g_filePath.empty()) {
        g_filePath = OpenFileDialog(NULL);
        if (g_filePath.empty()) return 0;
    }

    std::wstring content = ReadFileToWString(g_filePath.c_str());
    if (content.empty() && GetFileAttributesW(g_filePath.c_str()) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL, L"File not found.", APP_TITLE, MB_OK | MB_ICONERROR);
        return 1;
    }

    // Register window class
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = WNDCLASS_NAME;
    wc.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    RegisterClassExW(&wc);

    // Window title: "BSL Editor - filename.bsl"
    const wchar_t* fname = wcsrchr(g_filePath.c_str(), L'\\');
    if (!fname) fname = wcsrchr(g_filePath.c_str(), L'/');
    fname = fname ? fname + 1 : g_filePath.c_str();
    std::wstring title = std::wstring(APP_TITLE) + L" - " + fname;

    HWND hwnd = CreateWindowExW(0, WNDCLASS_NAME, title.c_str(),
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1200, 800,
        NULL, NULL, hInstance, NULL);

    if (!hwnd) { MessageBoxW(NULL, L"Failed to create window.", APP_TITLE, MB_OK); return 1; }

    ShowWindow(hwnd, nCmdShow);
    UpdateWindow(hwnd);

    // Create WebView2
    g_webView = new CWebView2Host();
    if (!g_webView->Create(hwnd)) {
        MessageBoxW(NULL,
            L"WebView2 is not available.\n\nPlease install Microsoft Edge WebView2 Runtime:\nhttps://developer.microsoft.com/en-us/microsoft-edge/webview2/",
            APP_TITLE, MB_OK | MB_ICONERROR);
        delete g_webView;
        g_webView = NULL;
        DestroyWindow(hwnd);
        return 1;
    }

    g_webView->mFilePath = g_filePath;
    g_webView->SetupMessageHandler();

    // Detect system dark mode
    bool darkMode = false;
    HKEY hThemeKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        0, KEY_READ, &hThemeKey) == ERROR_SUCCESS) {
        DWORD val = 1, sz2 = sizeof(val);
        RegQueryValueExW(hThemeKey, L"AppsUseLightTheme", NULL, NULL, (BYTE*)&val, &sz2);
        darkMode = (val == 0);
        RegCloseKey(hThemeKey);
    }

    // Generate and load HTML
    std::string html = GenerateMonacoHTML(content, darkMode, 14);
    std::wstring tempPath = WriteTempHTML(html);

    if (!tempPath.empty()) {
        g_webView->NavigateToFile(tempPath);
    }

    // Message loop
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    // Cleanup temp file
    if (!tempPath.empty()) DeleteFileW(tempPath.c_str());

    OleUninitialize();
    return (int)msg.wParam;
}
