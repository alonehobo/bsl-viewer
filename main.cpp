#include <windows.h>
#include <ole2.h>
#include <string>
#include <vector>

#include "listerplugin.h"
#include "browserhost.h"
#include "bslhighlight.h"
#include "webview2host.h"
#include "monaco_template.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

// --- Globals ---
static HINSTANCE g_hInst = NULL;
static const char* WNDCLASS_NAME = "BSLViewMainWnd";
static const char* PROP_BROWSER = "BSLView_Browser";     // IE browser host
static const char* PROP_WEBVIEW = "BSLView_WebView2";     // WebView2 host
static const char* PROP_TEMPFILE = "BSLView_TempFile";    // temp HTML file path
static char g_iniPath[MAX_PATH] = {0};

// --- INI helpers ---

static int GetIniInt(const char* section, const char* key, int def)
{
    return GetPrivateProfileIntA(section, key, def, g_iniPath);
}

static std::string GetIniStr(const char* section, const char* key, const char* def)
{
    char buf[512];
    GetPrivateProfileStringA(section, key, def, buf, sizeof(buf), g_iniPath);
    return buf;
}

// --- File reading ---

static std::wstring ReadFileToWString(const char* path)
{
    HANDLE hFile = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return L"";

    DWORD fileSize = GetFileSize(hFile, NULL);
    if (fileSize == 0 || fileSize == INVALID_FILE_SIZE) {
        CloseHandle(hFile);
        return L"";
    }

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
    if (sz >= 2 && p[0] == 0xFF && p[1] == 0xFE) {
        return std::wstring((const wchar_t*)(p + 2), (sz - 2) / sizeof(wchar_t));
    }
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

// --- Check file extension ---

static bool HasExtension(const char* filePath, const char* extensions)
{
    const char* dot = strrchr(filePath, '.');
    if (!dot) return false;
    dot++;
    std::string ext(dot);
    for (auto& c : ext) c = (char)tolower((unsigned char)c);

    std::string exts(extensions);
    for (auto& c : exts) c = (char)tolower((unsigned char)c);

    size_t pos = 0;
    while (pos < exts.size()) {
        size_t sep = exts.find(';', pos);
        if (sep == std::string::npos) sep = exts.size();
        if (exts.substr(pos, sep - pos) == ext) return true;
        pos = sep + 1;
    }
    return false;
}

// --- JavaScript string escaping for Monaco content ---

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
        else if (ch < 0x20) { /* skip control chars */ }
        else if (ch < 0x80) out += (char)ch;
        else {
            // Output as UTF-8
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

// --- Generate Monaco HTML ---

static std::string GenerateMonacoHTML(const std::wstring& content, bool darkMode, int fontSize)
{
    std::string html(MONACO_HTML_PART1);
    html += MONACO_HTML_PART2;

    // Replace all occurrences of %THEME%
    std::string theme = darkMode ? "bsl-dark" : "bsl-light";
    for (size_t pos = html.find("%THEME%"); pos != std::string::npos; pos = html.find("%THEME%", pos))
        html.replace(pos, 7, theme);

    // Replace all occurrences of %FONTSIZE%
    std::string fs = std::to_string(fontSize > 0 ? fontSize : 14);
    for (size_t pos = html.find("%FONTSIZE%"); pos != std::string::npos; pos = html.find("%FONTSIZE%", pos))
        html.replace(pos, 10, fs);

    // Replace BSL_CONTENT with the escaped file content
    std::string escaped = "'" + JsEscapeWide(content) + "'";
    size_t pos = html.find("BSL_CONTENT");
    if (pos != std::string::npos) html.replace(pos, 11, escaped);

    return html;
}

// --- Write temp HTML file ---

static std::wstring WriteTempHTML(const std::string& html)
{
    wchar_t tempDir[MAX_PATH];
    GetTempPathW(MAX_PATH, tempDir);
    std::wstring tempPath = std::wstring(tempDir) + L"BSLView_monaco.html";

    HANDLE hFile = CreateFileW(tempPath.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return L"";

    // Write UTF-8 BOM + content
    BYTE bom[] = {0xEF, 0xBB, 0xBF};
    DWORD written;
    WriteFile(hFile, bom, 3, &written, NULL);
    WriteFile(hFile, html.c_str(), (DWORD)html.size(), &written, NULL);
    CloseHandle(hFile);

    return tempPath;
}

// --- Window procedure ---

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_SIZE: {
        CWebView2Host* wv = (CWebView2Host*)GetPropA(hwnd, PROP_WEBVIEW);
        if (wv) { wv->Resize(); return 0; }
        CBrowserHost* browser = (CBrowserHost*)GetPropA(hwnd, PROP_BROWSER);
        if (browser) browser->Resize();
        return 0;
    }
    case WM_DESTROY: {
        CWebView2Host* wv = (CWebView2Host*)GetPropA(hwnd, PROP_WEBVIEW);
        if (wv) {
            wv->Close();
            delete wv;
            RemovePropA(hwnd, PROP_WEBVIEW);
        }
        CBrowserHost* browser = (CBrowserHost*)GetPropA(hwnd, PROP_BROWSER);
        if (browser) {
            browser->Quit();
            browser->Release();
            RemovePropA(hwnd, PROP_BROWSER);
        }
        // Delete temp file
        wchar_t* tempFile = (wchar_t*)GetPropW(hwnd, L"BSLView_TempFile");
        if (tempFile) {
            DeleteFileW(tempFile);
            free(tempFile);
            RemovePropW(hwnd, L"BSLView_TempFile");
        }
        return 0;
    }
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// --- Load BSL with IE fallback ---

static bool LoadBSLFileIE(CBrowserHost* browser, const char* filePath, int showFlags)
{
    std::string bslExts = GetIniStr("Extensions", "BSLExtensions", "bsl;os");
    std::string queryExts = GetIniStr("Extensions", "QueryExtensions", "sdbl;query");

    if (!HasExtension(filePath, bslExts.c_str()) &&
        !HasExtension(filePath, queryExts.c_str()))
        return false;

    std::wstring content = ReadFileToWString(filePath);
    if (content.empty()) return false;

    BSLHighlightOptions opts;
    opts.darkMode = (showFlags & lcp_darkmode) != 0;
    opts.lineNumbers = GetIniInt("Options", "LineNumbers", 1) != 0;
    std::string fontFamily = GetIniStr("Options", "FontFamily", "Consolas, Courier New, monospace");
    opts.fontFamily = fontFamily.c_str();
    opts.fontSize = GetIniInt("Options", "FontSize", 14);
    opts.tabSize = GetIniInt("Options", "TabSize", 4);

    std::string html = HasExtension(filePath, queryExts.c_str())
        ? HighlightSDBL(content.c_str(), content.size(), opts)
        : HighlightBSL(content.c_str(), content.size(), opts);

    browser->LoadHTML(html);
    return true;
}

// --- DLL entry ---

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH) {
        g_hInst = (HINSTANCE)hModule;
        DisableThreadLibraryCalls(hModule);

        GetModuleFileNameA(g_hInst, g_iniPath, MAX_PATH);
        char* lastSlash = strrchr(g_iniPath, '\\');
        if (!lastSlash) lastSlash = strrchr(g_iniPath, '/');
        if (lastSlash) strcpy(lastSlash + 1, "BSLView.ini");

        WNDCLASSA wc = {};
        wc.lpfnWndProc = WndProc;
        wc.hInstance = g_hInst;
        wc.lpszClassName = WNDCLASS_NAME;
        RegisterClassA(&wc);
    }
    return TRUE;
}

// --- WLX Exports ---

extern "C" {

__declspec(dllexport)
void __stdcall ListSetDefaultParams(ListDefaultParamStruct* dps)
{
    GetModuleFileNameA(g_hInst, g_iniPath, MAX_PATH);
    char* lastSlash = strrchr(g_iniPath, '\\');
    if (!lastSlash) lastSlash = strrchr(g_iniPath, '/');
    if (lastSlash) strcpy(lastSlash + 1, "BSLView.ini");
}

__declspec(dllexport)
void __stdcall ListGetDetectString(char* DetectString, int maxlen)
{
    strncpy(DetectString, "EXT=\"BSL\" | EXT=\"OS\" | EXT=\"SDBL\" | EXT=\"QUERY\"", maxlen - 1);
    DetectString[maxlen - 1] = 0;
}

__declspec(dllexport)
HWND __stdcall ListLoad(HWND ParentWin, char* FileToLoad, int ShowFlags)
{
    std::string bslExts = GetIniStr("Extensions", "BSLExtensions", "bsl;os");
    std::string queryExts = GetIniStr("Extensions", "QueryExtensions", "sdbl;query");

    if (!HasExtension(FileToLoad, bslExts.c_str()) &&
        !HasExtension(FileToLoad, queryExts.c_str()))
        return NULL;

    RECT rcParent;
    GetClientRect(ParentWin, &rcParent);

    HWND hwnd = CreateWindowExA(0, WNDCLASS_NAME, "",
                                WS_CHILD | WS_VISIBLE,
                                0, 0, rcParent.right, rcParent.bottom,
                                ParentWin, NULL, g_hInst, NULL);
    if (!hwnd) return NULL;

    // Read file content
    std::wstring content = ReadFileToWString(FileToLoad);
    if (content.empty()) { DestroyWindow(hwnd); return NULL; }

    int fontSize = GetIniInt("Options", "FontSize", 14);

    // Theme: auto (follow TC), light, dark
    std::string themeOpt = GetIniStr("Options", "Theme", "auto");
    bool darkMode;
    if (themeOpt == "light") darkMode = false;
    else if (themeOpt == "dark") darkMode = true;
    else darkMode = (ShowFlags & lcp_darkmode) != 0;

    // Try WebView2 first (Monaco Editor)
    bool useMonaco = GetIniInt("Options", "UseMonaco", 1) != 0;
    if (useMonaco) {
        CWebView2Host* wv = new CWebView2Host();
        if (wv->Create(hwnd)) {
            SetPropA(hwnd, PROP_WEBVIEW, (HANDLE)wv);

            // Store the source file path for save functionality
            int wlen = MultiByteToWideChar(CP_ACP, 0, FileToLoad, -1, NULL, 0);
            std::wstring wFilePath(wlen - 1, 0);
            MultiByteToWideChar(CP_ACP, 0, FileToLoad, -1, &wFilePath[0], wlen);
            wv->mFilePath = wFilePath;
            wv->SetupMessageHandler();

            std::string html = GenerateMonacoHTML(content, darkMode, fontSize);
            std::wstring tempPath = WriteTempHTML(html);

            if (!tempPath.empty()) {
                // Store temp file path for cleanup
                wchar_t* stored = _wcsdup(tempPath.c_str());
                SetPropW(hwnd, L"BSLView_TempFile", (HANDLE)stored);
                wv->NavigateToFile(tempPath);
                return hwnd;
            }
        }
        delete wv;
        RemovePropA(hwnd, PROP_WEBVIEW);
    }

    // Fallback to IE with C++ highlighter
    OleInitialize(NULL);
    CBrowserHost* browser = new CBrowserHost();
    browser->mAllowScripts = true;
    if (browser->CreateBrowser(hwnd)) {
        SetPropA(hwnd, PROP_BROWSER, (HANDLE)browser);
        if (LoadBSLFileIE(browser, FileToLoad, ShowFlags))
            return hwnd;
        browser->Quit();
        browser->Release();
        RemovePropA(hwnd, PROP_BROWSER);
    }

    DestroyWindow(hwnd);
    return NULL;
}

__declspec(dllexport)
int __stdcall ListLoadNext(HWND ParentWin, HWND PluginWin, char* FileToLoad, int ShowFlags)
{
    std::wstring content = ReadFileToWString(FileToLoad);
    if (content.empty()) return LISTPLUGIN_ERROR;

    int fontSize = GetIniInt("Options", "FontSize", 14);
    std::string themeOpt = GetIniStr("Options", "Theme", "auto");
    bool darkMode;
    if (themeOpt == "light") darkMode = false;
    else if (themeOpt == "dark") darkMode = true;
    else darkMode = (ShowFlags & lcp_darkmode) != 0;

    // Try WebView2
    CWebView2Host* wv = (CWebView2Host*)GetPropA(PluginWin, PROP_WEBVIEW);
    if (wv && wv->mReady) {
        // Delete old temp file
        wchar_t* oldTemp = (wchar_t*)GetPropW(PluginWin, L"BSLView_TempFile");
        if (oldTemp) { DeleteFileW(oldTemp); free(oldTemp); }

        std::string html = GenerateMonacoHTML(content, darkMode, fontSize);
        std::wstring tempPath = WriteTempHTML(html);
        if (!tempPath.empty()) {
            wchar_t* stored = _wcsdup(tempPath.c_str());
            SetPropW(PluginWin, L"BSLView_TempFile", (HANDLE)stored);
            wv->NavigateToFile(tempPath);
            return LISTPLUGIN_OK;
        }
    }

    // Fallback IE
    CBrowserHost* browser = (CBrowserHost*)GetPropA(PluginWin, PROP_BROWSER);
    if (browser) {
        if (LoadBSLFileIE(browser, FileToLoad, ShowFlags))
            return LISTPLUGIN_OK;
    }

    return LISTPLUGIN_ERROR;
}

__declspec(dllexport)
void __stdcall ListCloseWindow(HWND ListWin)
{
    DestroyWindow(ListWin);
}

__declspec(dllexport)
int __stdcall ListSearchText(HWND ListWin, char* SearchString, int SearchParameter)
{
    // WebView2: Monaco has built-in Ctrl+F search, so this is just for IE fallback
    CBrowserHost* browser = (CBrowserHost*)GetPropA(ListWin, PROP_BROWSER);
    if (!browser || !SearchString) return LISTPLUGIN_ERROR;

    int wlen = MultiByteToWideChar(CP_ACP, 0, SearchString, -1, NULL, 0);
    std::wstring ws(wlen, 0);
    MultiByteToWideChar(CP_ACP, 0, SearchString, -1, &ws[0], wlen);
    return browser->FindText(ws.c_str(), SearchParameter) ? LISTPLUGIN_OK : LISTPLUGIN_ERROR;
}

__declspec(dllexport)
int __stdcall ListSearchTextW(HWND ListWin, WCHAR* SearchString, int SearchParameter)
{
    CBrowserHost* browser = (CBrowserHost*)GetPropA(ListWin, PROP_BROWSER);
    if (!browser || !SearchString) return LISTPLUGIN_ERROR;
    return browser->FindText(SearchString, SearchParameter) ? LISTPLUGIN_OK : LISTPLUGIN_ERROR;
}

__declspec(dllexport)
int __stdcall ListSendCommand(HWND ListWin, int Command, int Parameter)
{
    // WebView2: Monaco handles copy/selectall internally
    CWebView2Host* wv = (CWebView2Host*)GetPropA(ListWin, PROP_WEBVIEW);
    if (wv) return LISTPLUGIN_OK;

    CBrowserHost* browser = (CBrowserHost*)GetPropA(ListWin, PROP_BROWSER);
    if (!browser || !browser->mWebBrowser) return LISTPLUGIN_ERROR;

    IDispatch* pDisp = NULL;
    browser->mWebBrowser->get_Document(&pDisp);
    if (!pDisp) return LISTPLUGIN_ERROR;

    IHTMLDocument2* pDoc = NULL;
    pDisp->QueryInterface(IID_IHTMLDocument2, (void**)&pDoc);
    pDisp->Release();
    if (!pDoc) return LISTPLUGIN_ERROR;

    VARIANT_BOOL success;
    VARIANT vIn;
    VariantInit(&vIn);

    if (Command == lc_copy)
        pDoc->execCommand(L"Copy", VARIANT_FALSE, vIn, &success);
    else if (Command == lc_selectall)
        pDoc->execCommand(L"SelectAll", VARIANT_FALSE, vIn, &success);

    pDoc->Release();
    return LISTPLUGIN_OK;
}

} // extern "C"
