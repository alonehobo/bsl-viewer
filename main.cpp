#include <windows.h>
#include <ole2.h>
#include <string>
#include <vector>
#include <fstream>

#include "listerplugin.h"
#include "browserhost.h"
#include "bslhighlight.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

// --- Globals ---
static HINSTANCE g_hInst = NULL;
static const char* WNDCLASS_NAME = "BSLViewMainWnd";
static const char* PROP_BROWSER = "BSLView_Browser";
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
    // Try to detect BOM and read appropriately
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

    // Detect encoding by BOM
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
        for (size_t i = 0; i < result.size(); i++) {
            result[i] = (wchar_t)((p[2 + i * 2] << 8) | p[2 + i * 2 + 1]);
        }
        return result;
    }

    // Try UTF-8 first (most common for modern BSL files)
    int wlen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char*)p, (int)sz, NULL, 0);
    if (wlen > 0) {
        std::wstring result(wlen, 0);
        MultiByteToWideChar(CP_UTF8, 0, (const char*)p, (int)sz, &result[0], wlen);
        return result;
    }

    // Fallback: Windows-1251 (legacy 1C files)
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
    dot++; // skip the dot

    std::string ext(dot);
    for (auto& c : ext) c = (char)tolower((unsigned char)c);

    // Parse semicolon-separated extensions list
    std::string exts(extensions);
    for (auto& c : exts) c = (char)tolower((unsigned char)c);

    size_t pos = 0;
    while (pos < exts.size()) {
        size_t sep = exts.find(';', pos);
        if (sep == std::string::npos) sep = exts.size();
        std::string e = exts.substr(pos, sep - pos);
        if (e == ext) return true;
        pos = sep + 1;
    }
    return false;
}

// --- Window procedure ---

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_SIZE: {
        CBrowserHost* browser = (CBrowserHost*)GetPropA(hwnd, PROP_BROWSER);
        if (browser) browser->Resize();
        return 0;
    }
    case WM_DESTROY: {
        CBrowserHost* browser = (CBrowserHost*)GetPropA(hwnd, PROP_BROWSER);
        if (browser) {
            browser->Quit();
            browser->Release();
            RemovePropA(hwnd, PROP_BROWSER);
        }
        return 0;
    }
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// --- Load and display a BSL file ---

static bool LoadBSLFile(CBrowserHost* browser, const char* filePath, int showFlags)
{
    std::string bslExts = GetIniStr("Extensions", "BSLExtensions", "bsl;os");
    std::string queryExts = GetIniStr("Extensions", "QueryExtensions", "sdbl;query");

    bool isBSL = HasExtension(filePath, bslExts.c_str());
    bool isQuery = HasExtension(filePath, queryExts.c_str());
    if (!isBSL && !isQuery) return false;

    std::wstring content = ReadFileToWString(filePath);
    if (content.empty()) return false;

    BSLHighlightOptions opts;
    opts.darkMode = (showFlags & lcp_darkmode) != 0;
    opts.lineNumbers = GetIniInt("Options", "LineNumbers", 1) != 0;
    std::string fontFamily = GetIniStr("Options", "FontFamily", "Consolas, Courier New, monospace");
    opts.fontFamily = fontFamily.c_str();
    opts.fontSize = GetIniInt("Options", "FontSize", 14);
    opts.tabSize = GetIniInt("Options", "TabSize", 4);

    std::string html;
    if (isQuery) {
        html = HighlightSDBL(content.c_str(), content.size(), opts);
    } else {
        html = HighlightBSL(content.c_str(), content.size(), opts);
    }

    browser->LoadHTML(html);
    return true;
}

// --- DLL entry ---

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH) {
        g_hInst = (HINSTANCE)hModule;
        DisableThreadLibraryCalls(hModule);

        // Set INI path next to DLL
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
    // Get INI path next to the DLL itself
    GetModuleFileNameA(g_hInst, g_iniPath, MAX_PATH);
    char* lastSlash = strrchr(g_iniPath, '\\');
    if (!lastSlash) lastSlash = strrchr(g_iniPath, '/');
    if (lastSlash) {
        strcpy(lastSlash + 1, "BSLView.ini");
    }
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
    // Check if we handle this file type
    std::string bslExts = "bsl;os";
    std::string queryExts = "sdbl;query";
    if (g_iniPath[0]) {
        bslExts = GetIniStr("Extensions", "BSLExtensions", "bsl;os");
        queryExts = GetIniStr("Extensions", "QueryExtensions", "sdbl;query");
    }

    if (!HasExtension(FileToLoad, bslExts.c_str()) &&
        !HasExtension(FileToLoad, queryExts.c_str()))
        return NULL;

    OleInitialize(NULL);

    RECT rcParent;
    GetClientRect(ParentWin, &rcParent);

    HWND hwnd = CreateWindowExA(0, WNDCLASS_NAME, "",
                                WS_CHILD | WS_VISIBLE,
                                0, 0, rcParent.right, rcParent.bottom,
                                ParentWin, NULL, g_hInst, NULL);
    if (!hwnd) return NULL;

    CBrowserHost* browser = new CBrowserHost();
    browser->mAllowScripts = true;
    if (!browser->CreateBrowser(hwnd)) {
        browser->Release();
        DestroyWindow(hwnd);
        return NULL;
    }

    SetPropA(hwnd, PROP_BROWSER, (HANDLE)browser);

    if (!LoadBSLFile(browser, FileToLoad, ShowFlags)) {
        browser->Quit();
        browser->Release();
        RemovePropA(hwnd, PROP_BROWSER);
        DestroyWindow(hwnd);
        return NULL;
    }

    return hwnd;
}

__declspec(dllexport)
int __stdcall ListLoadNext(HWND ParentWin, HWND PluginWin, char* FileToLoad, int ShowFlags)
{
    CBrowserHost* browser = (CBrowserHost*)GetPropA(PluginWin, PROP_BROWSER);
    if (!browser) return LISTPLUGIN_ERROR;

    if (!LoadBSLFile(browser, FileToLoad, ShowFlags))
        return LISTPLUGIN_ERROR;

    return LISTPLUGIN_OK;
}

__declspec(dllexport)
void __stdcall ListCloseWindow(HWND ListWin)
{
    DestroyWindow(ListWin);
    OleUninitialize();
}

__declspec(dllexport)
int __stdcall ListSearchText(HWND ListWin, char* SearchString, int SearchParameter)
{
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
    CBrowserHost* browser = (CBrowserHost*)GetPropA(ListWin, PROP_BROWSER);
    if (!browser || !browser->mWebBrowser) return LISTPLUGIN_ERROR;

    IDispatch* pDisp = NULL;
    browser->mWebBrowser->get_Document(&pDisp);
    if (!pDisp) return LISTPLUGIN_ERROR;

    IHTMLDocument2* pDoc = NULL;
    pDisp->QueryInterface(IID_IHTMLDocument2, (void**)&pDoc);
    pDisp->Release();
    if (!pDoc) return LISTPLUGIN_ERROR;

    switch (Command) {
    case lc_copy: {
        // Execute "Copy" command
        VARIANT_BOOL success;
        VARIANT vIn;
        VariantInit(&vIn);
        pDoc->execCommand(L"Copy", VARIANT_FALSE, vIn, &success);
        break;
    }
    case lc_selectall: {
        // Execute "SelectAll" command
        VARIANT_BOOL success;
        VARIANT vIn;
        VariantInit(&vIn);
        pDoc->execCommand(L"SelectAll", VARIANT_FALSE, vIn, &success);
        break;
    }
    }

    pDoc->Release();
    return LISTPLUGIN_OK;
}

} // extern "C"
