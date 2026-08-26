#include <windows.h>
#include <ole2.h>
#include <string>
#include <vector>

#include "listerplugin.h"
#include "browserhost.h"
#include "bslhighlight.h"
#include "webview2host.h"
#include "bslcommon.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

static HINSTANCE g_hInst = NULL;
static const wchar_t* WNDCLASS_NAME = L"BSLViewMainWnd";
static const wchar_t* PROP_STATE = L"BSLView_State";
static ATOM g_wndClass = 0;

static std::wstring g_iniPath;
static std::wstring g_webRoot;
static bool g_webRootUsable = false;

// --- Settings --------------------------------------------------------------

struct Settings {
    int          fontSize;
    std::wstring theme;
    bool         useMonaco;
    bool         keepWarm;
    DWORD        maxBytes;
    std::wstring bslExts;
    std::wstring queryExts;
    std::wstring textExts;
    bool         loaded;
};

static Settings g_settings = {};

static std::wstring IniStr(const wchar_t* section, const wchar_t* key, const wchar_t* def)
{
    wchar_t buf[512];
    DWORD n = GetPrivateProfileStringW(section, key, def, buf, 512, g_iniPath.c_str());
    return std::wstring(buf, n);
}

static void LoadSettings(bool force)
{
    if (g_settings.loaded && !force) return;
    g_settings.fontSize  = GetPrivateProfileIntW(L"Options", L"FontSize", 14, g_iniPath.c_str());
    g_settings.theme     = IniStr(L"Options", L"Theme", L"auto");
    g_settings.useMonaco = GetPrivateProfileIntW(L"Options", L"UseMonaco", 1, g_iniPath.c_str()) != 0;
    g_settings.keepWarm  = GetPrivateProfileIntW(L"Options", L"KeepWarm", 1, g_iniPath.c_str()) != 0;

    int maxMb = GetPrivateProfileIntW(L"Options", L"MaxFileSizeMB", 64, g_iniPath.c_str());
    if (maxMb < 1) maxMb = 1;
    if (maxMb > 512) maxMb = 512;
    g_settings.maxBytes = (DWORD)maxMb * 1024u * 1024u;

    g_settings.bslExts   = IniStr(L"Extensions", L"BSLExtensions", L"bsl;os");
    g_settings.queryExts = IniStr(L"Extensions", L"QueryExtensions", L"sdbl;query");
    g_settings.textExts  = IniStr(L"Extensions", L"TextExtensions", L"md;markdown;json;xml;ps1;psm1;psd1;html;htm");
    g_settings.loaded = true;
}

// --- Per-window state ------------------------------------------------------

struct WindowState {
    CWebView2Host* wv;
    CBrowserHost*  ie;
    std::wstring   filePath;
    std::wstring   content;
    TextEncoding   encoding;
    const char*    language;
    bool           dark;

    WindowState() : wv(NULL), ie(NULL), encoding(ENC_UTF8_BOM), language("plaintext"), dark(false) {}
};

// --- Extension matching ----------------------------------------------------

static bool HasExtension(const wchar_t* filePath, const std::wstring& list)
{
    const wchar_t* dot = wcsrchr(filePath, L'.');
    if (!dot) return false;

    std::wstring ext(dot + 1);
    for (auto& c : ext) c = (wchar_t)towlower(c);

    size_t pos = 0;
    while (pos <= list.size()) {
        size_t sep = list.find(L';', pos);
        if (sep == std::wstring::npos) sep = list.size();
        if (sep > pos) {
            std::wstring item = list.substr(pos, sep - pos);
            for (auto& c : item) c = (wchar_t)towlower(c);
            if (item == ext) return true;
        }
        pos = sep + 1;
    }
    return false;
}

static bool IsSupported(const wchar_t* filePath)
{
    return HasExtension(filePath, g_settings.bslExts)
        || HasExtension(filePath, g_settings.queryExts)
        || HasExtension(filePath, g_settings.textExts);
}

static bool ResolveDarkMode(int showFlags)
{
    if (g_settings.theme == L"light") return false;
    if (g_settings.theme == L"dark") return true;
    return (showFlags & lcp_darkmode) != 0;
}

// --- IE fallback -----------------------------------------------------------

static bool ShowInIE(WindowState* st, HWND hwnd)
{
    bool isBsl   = HasExtension(st->filePath.c_str(), g_settings.bslExts);
    bool isQuery = HasExtension(st->filePath.c_str(), g_settings.queryExts);
    if (!isBsl && !isQuery) return false;   // the C++ highlighter only knows BSL and SDBL

    if (!st->ie) {
        OleInitialize(NULL);
        CBrowserHost* browser = new CBrowserHost();
        browser->mAllowScripts = true;
        if (!browser->CreateBrowser(hwnd)) { browser->Release(); return false; }
        st->ie = browser;
    }

    BSLHighlightOptions opts;
    opts.darkMode = st->dark;
    opts.lineNumbers = GetPrivateProfileIntW(L"Options", L"LineNumbers", 1, g_iniPath.c_str()) != 0;
    std::wstring fontFamilyW = IniStr(L"Options", L"FontFamily", L"Consolas, Courier New, monospace");
    std::string fontFamily;
    fontFamily.reserve(fontFamilyW.size());
    for (wchar_t c : fontFamilyW) fontFamily += (c < 0x80) ? (char)c : '?';
    opts.fontFamily = fontFamily.c_str();
    opts.fontSize = g_settings.fontSize;
    opts.tabSize = GetPrivateProfileIntW(L"Options", L"TabSize", 4, g_iniPath.c_str());

    std::string html = isQuery
        ? HighlightSDBL(st->content.c_str(), st->content.size(), opts)
        : HighlightBSL(st->content.c_str(), st->content.size(), opts);

    st->ie->LoadHTML(html);
    return true;
}

// --- Window procedure ------------------------------------------------------

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    WindowState* st = (WindowState*)GetPropW(hwnd, PROP_STATE);

    switch (msg) {
    case WM_SIZE:
        if (st) {
            if (st->wv) st->wv->Resize();
            if (st->ie) st->ie->Resize();
        }
        return 0;

    case WM_BSLVIEW_WEBVIEW_FAILED:
        if (st) {
            if (st->wv) { st->wv->Close(); st->wv->Release(); st->wv = NULL; }
            if (!ShowInIE(st, hwnd)) InvalidateRect(hwnd, NULL, TRUE);
        }
        return 0;

    case WM_ERASEBKGND:
        // Fill before WebView2 attaches so the client is never an uninitialized
        // black region behind a still-loading page.
        {
            RECT rc;
            GetClientRect(hwnd, &rc);
            FillRect((HDC)wParam, &rc, (HBRUSH)(COLOR_WINDOW + 1));
            return 1;
        }

    case WM_PAINT:
        if (st && !st->wv && !st->ie) {
            PAINTSTRUCT ps;
            HDC hdc = BeginPaint(hwnd, &ps);
            RECT rc;
            GetClientRect(hwnd, &rc);
            FillRect(hdc, &rc, (HBRUSH)(COLOR_WINDOW + 1));
            SetBkMode(hdc, TRANSPARENT);
            const wchar_t* text =
                L"Не удалось запустить WebView2.\n\n"
                L"Установите Microsoft Edge WebView2 Runtime\n"
                L"или укажите UseMonaco=0 в BSLView.ini.";
            DrawTextW(hdc, text, -1, &rc, DT_CENTER | DT_VCENTER | DT_WORDBREAK);
            EndPaint(hwnd, &ps);
            return 0;
        }
        break;

    case WM_DESTROY:
        if (st) {
            RemovePropW(hwnd, PROP_STATE);
            if (st->wv) { st->wv->Close(); st->wv->Release(); }
            if (st->ie) { st->ie->Quit(); st->ie->Release(); }
            delete st;
        }
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// --- DLL entry -------------------------------------------------------------

static void InitPaths()
{
    std::wstring dir = ModuleDirectory(g_hInst);
    g_iniPath = dir + L"BSLView.ini";
    g_webRoot = dir + L"web";

    std::wstring viewer = g_webRoot + L"\\viewer.html";
    g_webRootUsable = (GetFileAttributesW(viewer.c_str()) != INVALID_FILE_ATTRIBUTES);
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved)
{
    if (reason == DLL_PROCESS_ATTACH) {
        g_hInst = (HINSTANCE)hModule;
        DisableThreadLibraryCalls(hModule);
        InitPaths();

        WNDCLASSW wc = {};
        wc.lpfnWndProc = WndProc;
        wc.hInstance = g_hInst;
        wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
        wc.lpszClassName = WNDCLASS_NAME;
        g_wndClass = RegisterClassW(&wc);
    } else if (reason == DLL_PROCESS_DETACH) {
        // Total Commander unloads idle plugins. Leaving the class registered
        // would leave a stale WndProc pointer behind for the next load.
        if (!reserved) {
            CWebView2Host::Shutdown();
            if (g_wndClass) UnregisterClassW(WNDCLASS_NAME, g_hInst);
        }
    }
    return TRUE;
}

// --- Shared load path ------------------------------------------------------

static HWND DoListLoad(HWND parentWin, const wchar_t* fileToLoad, int showFlags)
{
    LoadSettings(false);
    if (!IsSupported(fileToLoad)) return NULL;

    TextFile file = ReadTextFile(fileToLoad, g_settings.maxBytes);
    if (!file.ok) return NULL;   // unreadable or over the size limit

    RECT rcParent;
    GetClientRect(parentWin, &rcParent);

    HWND hwnd = CreateWindowExW(0, WNDCLASS_NAME, L"",
                                WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                                0, 0, rcParent.right, rcParent.bottom,
                                parentWin, NULL, g_hInst, NULL);
    if (!hwnd) return NULL;

    WindowState* st = new WindowState();
    st->filePath = fileToLoad;
    st->content  = file.text;
    st->encoding = file.encoding;
    st->language = MonacoLanguageForPath(fileToLoad);
    st->dark     = ResolveDarkMode(showFlags);
    SetPropW(hwnd, PROP_STATE, (HANDLE)st);

    bool wantMonaco = g_settings.useMonaco && g_webRootUsable && CWebView2Host::IsRuntimeAvailable();

    if (wantMonaco) {
        st->wv = CWebView2Host::Acquire(hwnd, g_webRoot);
        st->wv->mFilePath = st->filePath;
        st->wv->mEncoding = st->encoding;

        BslLoadRequest req;
        req.content  = st->content;
        req.language = st->language;
        req.dark     = st->dark;
        req.fontSize = g_settings.fontSize;
        req.readOnly = true;
        st->wv->Load(req);

        // The browser attaches asynchronously; the window is already valid, so
        // Total Commander gets it back without waiting for Chromium to start.
        return hwnd;
    }

    if (ShowInIE(st, hwnd)) return hwnd;

    DestroyWindow(hwnd);
    return NULL;
}

static int DoListLoadNext(HWND pluginWin, const wchar_t* fileToLoad, int showFlags)
{
    LoadSettings(false);
    if (!IsSupported(fileToLoad)) return LISTPLUGIN_ERROR;

    WindowState* st = (WindowState*)GetPropW(pluginWin, PROP_STATE);
    if (!st) return LISTPLUGIN_ERROR;

    TextFile file = ReadTextFile(fileToLoad, g_settings.maxBytes);
    if (!file.ok) return LISTPLUGIN_ERROR;

    st->filePath = fileToLoad;
    st->content  = file.text;
    st->encoding = file.encoding;
    st->language = MonacoLanguageForPath(fileToLoad);
    st->dark     = ResolveDarkMode(showFlags);

    if (st->wv) {
        // Reuse the live browser: swapping the model is essentially free
        // compared with tearing the page down and navigating again.
        st->wv->mFilePath = st->filePath;
        st->wv->mEncoding = st->encoding;

        BslLoadRequest req;
        req.content  = st->content;
        req.language = st->language;
        req.dark     = st->dark;
        req.fontSize = g_settings.fontSize;
        req.readOnly = true;
        st->wv->Load(req);
        return LISTPLUGIN_OK;
    }

    return ShowInIE(st, pluginWin) ? LISTPLUGIN_OK : LISTPLUGIN_ERROR;
}

// --- WLX Exports -----------------------------------------------------------

extern "C" {

__declspec(dllexport)
void __stdcall ListSetDefaultParams(ListDefaultParamStruct* dps)
{
    (void)dps;
    InitPaths();
    LoadSettings(true);
    // Total Commander calls this once at startup. Start the WebView2
    // environment early; the first F3 creates the controller on the real
    // Lister HWND (creating it on the off-screen park first caused black).
    if (g_settings.useMonaco && g_webRootUsable)
        CWebView2Host::WarmUp(g_webRoot, g_settings.keepWarm);
}

__declspec(dllexport)
void __stdcall ListGetDetectString(char* DetectString, int maxlen)
{
    LoadSettings(false);

    std::wstring all = g_settings.bslExts + L";" + g_settings.queryExts + L";" + g_settings.textExts;
    std::string detect;
    size_t pos = 0;
    while (pos <= all.size()) {
        size_t sep = all.find(L';', pos);
        if (sep == std::wstring::npos) sep = all.size();
        if (sep > pos) {
            std::wstring item = all.substr(pos, sep - pos);
            if (!detect.empty()) detect += " | ";
            detect += "EXT=\"";
            for (wchar_t c : item) detect += (char)towupper(c);
            detect += "\"";
        }
        pos = sep + 1;
    }

    strncpy(DetectString, detect.c_str(), maxlen - 1);
    DetectString[maxlen - 1] = 0;
}

__declspec(dllexport)
HWND __stdcall ListLoadW(HWND ParentWin, WCHAR* FileToLoad, int ShowFlags)
{
    return DoListLoad(ParentWin, FileToLoad, ShowFlags);
}

__declspec(dllexport)
HWND __stdcall ListLoad(HWND ParentWin, char* FileToLoad, int ShowFlags)
{
    return DoListLoad(ParentWin, AnsiToWide(FileToLoad).c_str(), ShowFlags);
}

__declspec(dllexport)
int __stdcall ListLoadNextW(HWND ParentWin, HWND PluginWin, WCHAR* FileToLoad, int ShowFlags)
{
    (void)ParentWin;
    return DoListLoadNext(PluginWin, FileToLoad, ShowFlags);
}

__declspec(dllexport)
int __stdcall ListLoadNext(HWND ParentWin, HWND PluginWin, char* FileToLoad, int ShowFlags)
{
    (void)ParentWin;
    return DoListLoadNext(PluginWin, AnsiToWide(FileToLoad).c_str(), ShowFlags);
}

__declspec(dllexport)
void __stdcall ListCloseWindow(HWND ListWin)
{
    // Hand the browser back to the pool while the window is still intact, so
    // the next F3 can reuse it instead of starting Chromium again.
    WindowState* st = (WindowState*)GetPropW(ListWin, PROP_STATE);
    if (st && st->wv) {
        CWebView2Host* wv = st->wv;
        st->wv = NULL;
        wv->Park();
    }
    DestroyWindow(ListWin);
}

__declspec(dllexport)
int __stdcall ListSearchTextW(HWND ListWin, WCHAR* SearchString, int SearchParameter)
{
    WindowState* st = (WindowState*)GetPropW(ListWin, PROP_STATE);
    if (!st || !SearchString) return LISTPLUGIN_ERROR;

    if (st->wv) {
        st->wv->Find(SearchString,
                     (SearchParameter & lcs_matchcase) != 0,
                     (SearchParameter & lcs_wholewords) != 0,
                     (SearchParameter & lcs_backwards) != 0,
                     (SearchParameter & lcs_findfirst) != 0);
        // Monaco reports no result back synchronously; treating the search as
        // handled keeps Total Commander from opening its own search box.
        return LISTPLUGIN_OK;
    }

    if (st->ie) return st->ie->FindText(SearchString, SearchParameter) ? LISTPLUGIN_OK : LISTPLUGIN_ERROR;
    return LISTPLUGIN_ERROR;
}

__declspec(dllexport)
int __stdcall ListSearchText(HWND ListWin, char* SearchString, int SearchParameter)
{
    if (!SearchString) return LISTPLUGIN_ERROR;
    std::wstring ws = AnsiToWide(SearchString);
    return ListSearchTextW(ListWin, &ws[0], SearchParameter);
}

__declspec(dllexport)
int __stdcall ListSendCommand(HWND ListWin, int Command, int Parameter)
{
    (void)Parameter;
    WindowState* st = (WindowState*)GetPropW(ListWin, PROP_STATE);
    if (!st) return LISTPLUGIN_ERROR;

    if (Command == lc_newparams) {
        LoadSettings(true);
        return LISTPLUGIN_OK;
    }

    if (st->wv) {
        if (Command == lc_copy) st->wv->SendCommand(L"copy");
        else if (Command == lc_selectall) st->wv->SendCommand(L"selectAll");
        return LISTPLUGIN_OK;
    }

    if (!st->ie || !st->ie->mWebBrowser) return LISTPLUGIN_ERROR;

    IDispatch* pDisp = NULL;
    st->ie->mWebBrowser->get_Document(&pDisp);
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
