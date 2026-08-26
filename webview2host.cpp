#include "webview2host.h"

#include <WebView2.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <commdlg.h>
#include <vector>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "shell32.lib")

static const wchar_t* kViewerOrigin = L"https://" BSLVIEW_VIRTUAL_HOST L"/";

static HRESULT BslCreateController(ICoreWebView2Environment* env, CWebView2Host* host);
static void ConfigureControllerRendering(ICoreWebView2Controller* ctrl, HWND hwnd, bool dark);
static void EnsureEnvironment();

// Minimal ICoreWebView2EnvironmentOptions so we can pass browser flags without
// pulling in WRL. The only one that matters is CalculateNativeWinOcclusion:
// the parked instance lives off-screen, and Chromium would otherwise consider
// it occluded and throttle it, so the first frame after reuse arrives late.
class EnvironmentOptions : public ICoreWebView2EnvironmentOptions {
    long mRef;

    static HRESULT CopyOut(const wchar_t* src, LPWSTR* out) {
        if (!out) return E_POINTER;
        size_t bytes = (wcslen(src) + 1) * sizeof(wchar_t);
        *out = (LPWSTR)CoTaskMemAlloc(bytes);
        if (!*out) return E_OUTOFMEMORY;
        memcpy(*out, src, bytes);
        return S_OK;
    }

public:
    EnvironmentOptions() : mRef(1) {}

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, __uuidof(ICoreWebView2EnvironmentOptions))) {
            *ppv = static_cast<ICoreWebView2EnvironmentOptions*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP get_AdditionalBrowserArguments(LPWSTR* value) {
        // Parked off-screen instance must not be treated as occluded/throttled.
        return CopyOut(L"--disable-features=CalculateNativeWinOcclusion", value);
    }
    STDMETHODIMP put_AdditionalBrowserArguments(LPCWSTR) { return S_OK; }

    STDMETHODIMP get_Language(LPWSTR* value) { return CopyOut(L"", value); }
    STDMETHODIMP put_Language(LPCWSTR) { return S_OK; }

    STDMETHODIMP get_TargetCompatibleBrowserVersion(LPWSTR* value) {
        /* The SDK constant (131.x) is a *minimum*. If the installed Evergreen
         * runtime is older, CreateCoreWebView2Environment fails even though a
         * runtime is present. Prefer the version that is actually installed. */
        LPWSTR ver = NULL;
        if (SUCCEEDED(GetAvailableCoreWebView2BrowserVersionString(NULL, &ver)) && ver && *ver) {
            HRESULT hr = CopyOut(ver, value);
            CoTaskMemFree(ver);
            return hr;
        }
        if (ver) CoTaskMemFree(ver);
        return CopyOut(L"86.0.616.0", value);
    }
    STDMETHODIMP put_TargetCompatibleBrowserVersion(LPCWSTR) { return S_OK; }

    STDMETHODIMP get_AllowSingleSignOnUsingOSPrimaryAccount(BOOL* allow) {
        if (!allow) return E_POINTER;
        *allow = FALSE;
        return S_OK;
    }
    STDMETHODIMP put_AllowSingleSignOnUsingOSPrimaryAccount(BOOL) { return S_OK; }
};

// ---------------------------------------------------------------------------
// Shared environment
//
// Creating an ICoreWebView2Environment is what spawns msedgewebview2.exe. The
// plugin used to build (and tear down) one per opened file, so every F3 paid a
// full browser cold start. One environment is created for the lifetime of the
// module instead, and creation is kicked off as early as possible so it usually
// finishes before the user opens anything.
// ---------------------------------------------------------------------------

namespace {

ICoreWebView2Environment* g_env = NULL;
bool g_envPending = false;
bool g_envFailed  = false;
HRESULT g_lastEnvHr = S_OK;
int g_envAttempts = 0;

std::vector<CWebView2Host*>* g_waiters = NULL;

// A single browser instance is kept alive between openings, parented to an
// off-screen window. Reusing it skips browser startup, page navigation and the
// Monaco parse entirely, which is the bulk of the wait when opening a file.
CWebView2Host* g_parked = NULL;
HWND  g_holder = NULL;
bool  g_keepWarm = false;
std::wstring g_warmWebRoot;

HWND HolderWindow()
{
    if (g_holder) return g_holder;

    static const wchar_t* kClass = L"BSLViewParkingWnd";
    static bool registered = false;
    if (!registered) {
        WNDCLASSW wc = {};
        wc.lpfnWndProc = DefWindowProcW;
        wc.hInstance = GetModuleHandleW(NULL);
        wc.lpszClassName = kClass;
        RegisterClassW(&wc);
        registered = true;
    }
    // Must be WS_VISIBLE: creating / parking WebView2 on a non-visible parent
    // leaves a dead DirectComposition surface that stays solid black after
    // reparent into the Lister. Off-screen coordinates keep it out of the way.
    g_holder = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kClass, L"",
                               WS_POPUP | WS_VISIBLE, -32000, -32000, 800, 600,
                               NULL, NULL, GetModuleHandleW(NULL), NULL);
    if (g_holder) ShowWindow(g_holder, SW_SHOWNOACTIVATE);
    return g_holder;
}

std::wstring UserDataFolder()
{
    wchar_t buf[MAX_PATH];
    DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", buf, MAX_PATH);
    std::wstring base = (n > 0 && n < MAX_PATH) ? std::wstring(buf) : std::wstring();
    if (base.empty()) {
        wchar_t tmp[MAX_PATH];
        GetTempPathW(MAX_PATH, tmp);
        base = tmp;
        if (!base.empty() && base.back() == L'\\') base.pop_back();
    }
    // Isolate by host process so BSLEdit and the TC plugin do not fight over
    // one Chromium profile (that fails with ERROR_INVALID_STATE).
    wchar_t exe[MAX_PATH] = {};
    GetModuleFileNameW(NULL, exe, MAX_PATH);
    const wchar_t* leaf = PathFindFileNameW(exe);
    wchar_t name[MAX_PATH] = {};
    lstrcpynW(name, leaf ? leaf : L"app", MAX_PATH);
    PathRemoveExtensionW(name);
    std::wstring folderName = name;
    if (g_envAttempts > 1)
        folderName += L"-" + std::to_wstring(GetCurrentProcessId());

    return base + L"\\BSLView\\WebView2-" + folderName;
}

} // namespace

// --- COM callback shims ----------------------------------------------------

class EnvCompletedHandler : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
    long mRef;
public:
    EnvCompletedHandler() : mRef(1) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) ||
            IsEqualIID(riid, __uuidof(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler))) {
            *ppv = static_cast<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP Invoke(HRESULT hr, ICoreWebView2Environment* env) {
        g_envPending = false;
        if (SUCCEEDED(hr) && env) {
            g_env = env;
            g_env->AddRef();
        } else {
            g_lastEnvHr = FAILED(hr) ? hr : E_FAIL;
            // First failure is often a user-data folder already taken by
            // another BSLView process (TC plugin vs BSLEdit). Retry once
            // with a process-id folder before giving up.
            if (g_envAttempts < 2) {
                EnsureEnvironment();
                if (g_envPending || g_env) return S_OK;
            }
            g_envFailed = true;
        }

        if (g_waiters) {
            std::vector<CWebView2Host*> waiters;
            waiters.swap(*g_waiters);
            for (size_t i = 0; i < waiters.size(); i++) {
                CWebView2Host* host = waiters[i];
                if (g_env && !host->mClosed) {
                    host->AddRef();   // held by the controller callback
                    if (FAILED(BslCreateController(g_env, host))) {
                        host->Release();
                        PostMessageW(host->mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
                    }
                } else if (!host->mClosed) {
                    PostMessageW(host->mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
                }
                host->Release();      // the waiter-list reference
            }
        }
        return S_OK;
    }
};

class CtrlCompletedHandler : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
    long mRef;
    CWebView2Host* mHost;
public:
    CtrlCompletedHandler(CWebView2Host* host) : mRef(1), mHost(host) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) ||
            IsEqualIID(riid, __uuidof(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler))) {
            *ppv = static_cast<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP Invoke(HRESULT hr, ICoreWebView2Controller* ctrl) {
        mHost->OnControllerCreated(hr, ctrl);
        mHost->Release();   // matches the AddRef taken before creation
        return S_OK;
    }
};

class WebMessageHandler : public ICoreWebView2WebMessageReceivedEventHandler {
    long mRef;
    CWebView2Host* mHost;
public:
    WebMessageHandler(CWebView2Host* host) : mRef(1), mHost(host) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) ||
            IsEqualIID(riid, __uuidof(ICoreWebView2WebMessageReceivedEventHandler))) {
            *ppv = static_cast<ICoreWebView2WebMessageReceivedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) {
        LPWSTR raw = NULL;
        if (FAILED(args->get_WebMessageAsJson(&raw)) || !raw) return S_OK;
        std::wstring msg(raw);
        CoTaskMemFree(raw);
        mHost->OnWebMessage(msg);
        return S_OK;
    }
};

class NavigationStartingHandler : public ICoreWebView2NavigationStartingEventHandler {
    long mRef;
public:
    NavigationStartingHandler() : mRef(1) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) ||
            IsEqualIID(riid, __uuidof(ICoreWebView2NavigationStartingEventHandler))) {
            *ppv = static_cast<ICoreWebView2NavigationStartingEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) {
        LPWSTR uri = NULL;
        if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
            // Viewed documents are untrusted input; keep them from navigating
            // the host frame anywhere outside the packaged viewer.
            if (StrCmpNIW(uri, kViewerOrigin, (int)wcslen(kViewerOrigin)) != 0)
                args->put_Cancel(TRUE);
            CoTaskMemFree(uri);
        }
        return S_OK;
    }
};

class NewWindowHandler : public ICoreWebView2NewWindowRequestedEventHandler {
    long mRef;
public:
    NewWindowHandler() : mRef(1) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) ||
            IsEqualIID(riid, __uuidof(ICoreWebView2NewWindowRequestedEventHandler))) {
            *ppv = static_cast<ICoreWebView2NewWindowRequestedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) {
        args->put_Handled(TRUE);
        return S_OK;
    }
};

class ProcessFailedHandler : public ICoreWebView2ProcessFailedEventHandler {
    long mRef;
    CWebView2Host* mHost;
public:
    ProcessFailedHandler(CWebView2Host* host) : mRef(1), mHost(host) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) ||
            IsEqualIID(riid, __uuidof(ICoreWebView2ProcessFailedEventHandler))) {
            *ppv = static_cast<ICoreWebView2ProcessFailedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) {
        mHost->OnProcessFailed();
        return S_OK;
    }
};

class PdfCompletedHandler : public ICoreWebView2PrintToPdfCompletedHandler {
    long mRef;
    CWebView2Host* mHost;
public:
    PdfCompletedHandler(CWebView2Host* host) : mRef(1), mHost(host) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) ||
            IsEqualIID(riid, __uuidof(ICoreWebView2PrintToPdfCompletedHandler))) {
            *ppv = static_cast<ICoreWebView2PrintToPdfCompletedHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP Invoke(HRESULT hr, BOOL ok) {
        if (!mHost->mClosed) {
            std::wstring json = L"{\"cmd\":\"pdfDone\",\"ok\":";
            json += (SUCCEEDED(hr) && ok) ? L"true" : L"false";
            json += L"}";
            mHost->PostJson(json);
        }
        mHost->Release();
        return S_OK;
    }
};

static HRESULT BslCreateController(ICoreWebView2Environment* env, CWebView2Host* host)
{
    CtrlCompletedHandler* cb = new CtrlCompletedHandler(host);
    HRESULT hr = env->CreateCoreWebView2Controller(host->mParentWin, cb);
    cb->Release();
    return hr;
}

// --- Static environment management -----------------------------------------

bool CWebView2Host::IsRuntimeAvailable()
{
    LPWSTR version = NULL;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(NULL, &version);
    bool available = SUCCEEDED(hr) && version && *version;
    if (version) CoTaskMemFree(version);
    return available;
}

static void EnsureEnvironment()
{
    if (g_env || g_envPending) return;
    if (!CWebView2Host::IsRuntimeAvailable()) {
        g_lastEnvHr = HRESULT_FROM_WIN32(ERROR_PRODUCT_UNINSTALLED);
        g_envFailed = true;
        return;
    }

    g_envFailed = false;
    g_envAttempts++;
    std::wstring folder = UserDataFolder();
    SHCreateDirectoryExW(NULL, folder.c_str(), NULL);

    g_envPending = true;

    EnvironmentOptions* options = new EnvironmentOptions();
    EnvCompletedHandler* cb = new EnvCompletedHandler();
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(NULL, folder.c_str(), options, cb);
    cb->Release();
    options->Release();

    if (FAILED(hr)) {
        g_envPending = false;
        g_lastEnvHr = hr;
        if (g_envAttempts < 2) {
            EnsureEnvironment();
            return;
        }
        g_envFailed = true;
    }
}

HRESULT CWebView2Host::LastError()
{
    return g_lastEnvHr;
}

void CWebView2Host::WarmUp(const std::wstring& webRoot, bool keepWarm)
{
    g_keepWarm = keepWarm;
    if (g_warmWebRoot.empty()) g_warmWebRoot = webRoot;

    // Only spin up the environment here. Creating a parked controller on the
    // off-screen holder *before* the first F3 was the black-screen path: the
    // first ListLoad then reparented a never-on-screen surface into Lister.
    // KeepWarm still parks after ListCloseWindow, so the second F3 stays fast.
    EnsureEnvironment();
}

void CWebView2Host::Shutdown()
{
    if (g_waiters) {
        for (size_t i = 0; i < g_waiters->size(); i++) (*g_waiters)[i]->Release();
        delete g_waiters;
        g_waiters = NULL;
    }
    if (g_parked) {
        CWebView2Host* p = g_parked;
        g_parked = NULL;
        p->mParked = false;
        p->Close();
        p->Release();
    }
    if (g_env) { g_env->Release(); g_env = NULL; }
    if (g_holder) { DestroyWindow(g_holder); g_holder = NULL; }
    g_envPending = false;
    g_envFailed = false;
    g_lastEnvHr = S_OK;
    g_envAttempts = 0;
    g_keepWarm = false;
    g_warmWebRoot.clear();
}

// --- Construction ----------------------------------------------------------

CWebView2Host::CWebView2Host()
    : mParentWin(NULL), mEncoding(ENC_UTF8_BOM), mRefCount(1), mWebView(NULL),
      mController(NULL), mClosed(false), mParked(false), mFailed(false),
      mPageReady(false), mHasPending(false), mDark(false)
{
}

CWebView2Host::~CWebView2Host()
{
    if (mWebView) mWebView->Release();
    if (mController) { mController->Close(); mController->Release(); }
}

CWebView2Host* CWebView2Host::Acquire(HWND parent, const std::wstring& webRoot)
{
    // Reuse the parked instance if there is one: it already has a browser, a
    // loaded page and a warm Monaco, so showing a file is just a postMessage.
    if (g_parked && parent != g_holder) {
        CWebView2Host* host = g_parked;
        g_parked = NULL;
        host->mParked = false;
        host->Reparent(parent, true);
        return host;
    }

    CWebView2Host* host = new CWebView2Host();
    host->mParentWin = parent;
    host->mWebRoot = webRoot;

    EnsureEnvironment();

    if (g_envFailed) {
        PostMessageW(parent, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
        return host;
    }

    if (g_env) {
        host->AddRef();
        if (FAILED(BslCreateController(g_env, host))) {
            host->Release();
            PostMessageW(parent, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
        }
        return host;
    }

    // Environment still being created; pick the work up in its callback.
    if (!g_waiters) g_waiters = new std::vector<CWebView2Host*>();
    host->AddRef();
    g_waiters->push_back(host);
    return host;
}

void CWebView2Host::AddRef()
{
    InterlockedIncrement(&mRefCount);
}

void CWebView2Host::Release()
{
    if (InterlockedDecrement(&mRefCount) == 0) delete this;
}

void CWebView2Host::Close()
{
    mClosed = true;
    mPageReady = false;
    if (mController) {
        mController->put_IsVisible(FALSE);
        mController->Close();
        mController->Release();
        mController = NULL;
    }
    if (mWebView) { mWebView->Release(); mWebView = NULL; }
}

void CWebView2Host::OnProcessFailed()
{
    mFailed = true;
    mPageReady = false;

    // A dead instance must never go back into the pool, or every later open
    // would be handed the same broken browser.
    if (mParked && g_parked == this) {
        g_parked = NULL;
        mParked = false;
        Close();
        Release();
        return;
    }
    if (!mClosed && mParentWin) PostMessageW(mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, 0, 0);
}

void CWebView2Host::Reparent(HWND parent, bool visible)
{
    mParentWin = parent;
    if (!mController) return;
    // Move first, then size, then reveal: showing before the bounds are right
    // costs an extra composite of the old geometry.
    mController->put_ParentWindow(parent);
    ConfigureControllerRendering(mController, parent, mDark);
    Resize();
    // Required after put_ParentWindow / moving between HWNDs; without it
    // WebView2 can keep compositing into a stale (often black) surface.
    mController->NotifyParentWindowPositionChanged();
    mController->put_IsVisible(visible ? TRUE : FALSE);
}

void CWebView2Host::Park()
{
    // Only a fully-live instance is worth keeping, and only one at a time.
    if (!g_keepWarm || g_parked || mClosed || mFailed || !mController || !mPageReady) {
        Close();
        Release();
        return;
    }

    HWND holder = HolderWindow();
    if (!holder) {
        Close();
        Release();
        return;
    }

    mFilePath.clear();
    SendCommand(L"park");
    Reparent(holder, true);
    mParked = true;
    g_parked = this;
}

// --- Wiring ----------------------------------------------------------------

void CWebView2Host::ConfigureSettings()
{
    ICoreWebView2Settings* settings = NULL;
    if (SUCCEEDED(mWebView->get_Settings(&settings)) && settings) {
        settings->put_AreDefaultContextMenusEnabled(TRUE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_IsBuiltInErrorPageEnabled(FALSE);
        settings->Release();
    }
}

// Total Commander is system-DPI aware (dpiAware=true, not Per-Monitor V2).
// WebView2's default monitor-scale tracking then drifts from the HWND's
// coordinate space — especially on a secondary display — so Monaco's
// scrollTop and painted view-lines disagree: scrolling down leaves a growing
// blank band until the view is empty. Lock rasterization to the host DPI.
static double HostRasterizationScale(HWND hwnd)
{
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    auto getCtx = (DPI_AWARENESS_CONTEXT (WINAPI*)())GetProcAddress(user32, "GetThreadDpiAwarenessContext");
    auto fromCtx = (DPI_AWARENESS (WINAPI*)(DPI_AWARENESS_CONTEXT))GetProcAddress(user32, "GetAwarenessFromDpiAwarenessContext");
    if (getCtx && fromCtx && fromCtx(getCtx()) == DPI_AWARENESS_UNAWARE)
        return 1.0;

    auto getDpiWnd = (UINT (WINAPI*)(HWND))GetProcAddress(user32, "GetDpiForWindow");
    if (getDpiWnd && hwnd) {
        UINT dpi = getDpiWnd(hwnd);
        if (dpi > 0) return (double)dpi / 96.0;
    }
    auto getDpiSys = (UINT (WINAPI*)())GetProcAddress(user32, "GetDpiForSystem");
    if (getDpiSys) {
        UINT dpi = getDpiSys();
        if (dpi > 0) return (double)dpi / 96.0;
    }
    return 1.0;
}

static void ConfigureControllerRendering(ICoreWebView2Controller* ctrl, HWND hwnd, bool dark)
{
    if (!ctrl) return;
    (void)dark;   // visible colour comes from the page; keep the surface white

    ctrl->put_ZoomFactor(1.0);

    ICoreWebView2Controller2* c2 = NULL;
    if (SUCCEEDED(ctrl->QueryInterface(__uuidof(ICoreWebView2Controller2), (void**)&c2)) && c2) {
        /* A dark DefaultBackgroundColor behind a still-loading document shows
         * up as a solid black first frame. The page sets its own background. */
        COREWEBVIEW2_COLOR bg = { 255, 255, 255, 255 };
        c2->put_DefaultBackgroundColor(bg);
        c2->Release();
    }

    ICoreWebView2Controller3* c3 = NULL;
    if (SUCCEEDED(ctrl->QueryInterface(__uuidof(ICoreWebView2Controller3), (void**)&c3)) && c3) {
        c3->put_ShouldDetectMonitorScaleChanges(FALSE);
        c3->put_RasterizationScale(HostRasterizationScale(hwnd));
        c3->Release();
    }
}

void CWebView2Host::OnControllerCreated(HRESULT hr, ICoreWebView2Controller* ctrl)
{
    if (mClosed) return;

    if (FAILED(hr) || !ctrl) {
        g_lastEnvHr = FAILED(hr) ? hr : E_FAIL;
        PostMessageW(mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
        return;
    }

    mController = ctrl;
    mController->AddRef();
    if (FAILED(mController->get_CoreWebView2(&mWebView)) || !mWebView) {
        PostMessageW(mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, 0, 0);
        return;
    }

    ConfigureSettings();
    ConfigureControllerRendering(mController, mParentWin, mDark);

    ICoreWebView2_3* wv3 = NULL;
    if (SUCCEEDED(mWebView->QueryInterface(__uuidof(ICoreWebView2_3), (void**)&wv3)) && wv3) {
        wv3->SetVirtualHostNameToFolderMapping(
            BSLVIEW_VIRTUAL_HOST, mWebRoot.c_str(),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
        wv3->Release();
    }

    EventRegistrationToken token;
    WebMessageHandler* wm = new WebMessageHandler(this);
    mWebView->add_WebMessageReceived(wm, &token);
    wm->Release();

    NavigationStartingHandler* nav = new NavigationStartingHandler();
    mWebView->add_NavigationStarting(nav, &token);
    nav->Release();

    NewWindowHandler* nw = new NewWindowHandler();
    mWebView->add_NewWindowRequested(nw, &token);
    nw->Release();

    ProcessFailedHandler* pf = new ProcessFailedHandler(this);
    mWebView->add_ProcessFailed(pf, &token);
    pf->Release();

    Resize();
    mController->put_IsVisible(TRUE);

    mWebView->Navigate(L"https://" BSLVIEW_VIRTUAL_HOST L"/viewer.html");
}

void CWebView2Host::Resize()
{
    if (!mController || !mParentWin) return;
    ConfigureControllerRendering(mController, mParentWin, mDark);
    RECT bounds;
    GetClientRect(mParentWin, &bounds);
    mController->put_Bounds(bounds);
}

// --- Messaging -------------------------------------------------------------

void CWebView2Host::PostJson(const std::wstring& json)
{
    if (mWebView) mWebView->PostWebMessageAsJson(json.c_str());
}

void CWebView2Host::Load(const BslLoadRequest& req)
{
    mDark = req.dark;
    if (mController) ConfigureControllerRendering(mController, mParentWin, mDark);

    std::wstring json;
    json.reserve(req.content.size() + 256);
    json += L"{\"cmd\":\"load\",\"language\":\"";
    for (const char* p = req.language; *p; p++) json += (wchar_t)*p;
    json += L"\",\"theme\":\"";
    json += req.dark ? L"dark" : L"light";
    json += L"\",\"fontSize\":";
    json += std::to_wstring(req.fontSize > 0 ? req.fontSize : 14);
    json += L",\"readOnly\":";
    json += req.readOnly ? L"true" : L"false";
    json += L",\"content\":\"";
    json += JsonEscape(req.content);
    json += L"\"}";

    if (mPageReady) {
        PostJson(json);
    } else {
        mPendingJson.swap(json);
        mHasPending = true;
    }
}

void CWebView2Host::OnPageReady()
{
    mPageReady = true;
    if (mHasPending) {
        mHasPending = false;
        PostJson(mPendingJson);
        mPendingJson.clear();
        mPendingJson.shrink_to_fit();
    }
}

void CWebView2Host::SendCommand(const wchar_t* cmd)
{
    if (!mPageReady) return;
    std::wstring json = L"{\"cmd\":\"";
    json += cmd;
    json += L"\"}";
    PostJson(json);
}

void CWebView2Host::Find(const std::wstring& text, bool matchCase, bool wholeWords, bool backwards, bool first)
{
    if (!mPageReady) return;
    std::wstring json = L"{\"cmd\":\"find\",\"text\":\"";
    json += JsonEscape(text);
    json += L"\",\"matchCase\":";  json += matchCase ? L"true" : L"false";
    json += L",\"wholeWords\":";   json += wholeWords ? L"true" : L"false";
    json += L",\"backwards\":";    json += backwards ? L"true" : L"false";
    json += L",\"first\":";        json += first ? L"true" : L"false";
    json += L"}";
    PostJson(json);
}

// Minimal extraction of a JSON string field; the viewer is the only producer of
// these messages, so a full parser would be overkill.
static bool JsonFieldEquals(const std::wstring& json, const wchar_t* key, const wchar_t* value)
{
    std::wstring pat = L"\"";
    pat += key;
    pat += L"\":\"";
    size_t at = json.find(pat);
    if (at == std::wstring::npos) return false;
    at += pat.size();
    size_t end = json.find(L'"', at);
    if (end == std::wstring::npos) return false;
    return json.compare(at, end - at, value) == 0;
}

static bool JsonUnescapeField(const std::wstring& json, const wchar_t* key, std::wstring& out)
{
    std::wstring pat = L"\"";
    pat += key;
    pat += L"\":\"";
    size_t at = json.find(pat);
    if (at == std::wstring::npos) return false;
    at += pat.size();

    out.clear();
    out.reserve(json.size() - at);
    for (size_t i = at; i < json.size(); i++) {
        wchar_t ch = json[i];
        if (ch == L'"') return true;
        if (ch != L'\\') { out += ch; continue; }
        if (++i >= json.size()) return false;
        switch (json[i]) {
        case L'"':  out += L'"';  break;
        case L'\\': out += L'\\'; break;
        case L'/':  out += L'/';  break;
        case L'b':  out += L'\b'; break;
        case L'f':  out += L'\f'; break;
        case L'n':  out += L'\n'; break;
        case L'r':  out += L'\r'; break;
        case L't':  out += L'\t'; break;
        case L'u': {
            if (i + 4 >= json.size()) return false;
            wchar_t code = 0;
            for (int k = 1; k <= 4; k++) {
                wchar_t d = json[i + k];
                code <<= 4;
                if (d >= L'0' && d <= L'9') code |= (d - L'0');
                else if (d >= L'a' && d <= L'f') code |= (d - L'a' + 10);
                else if (d >= L'A' && d <= L'F') code |= (d - L'A' + 10);
                else return false;
            }
            out += code;
            i += 4;
            break;
        }
        default: return false;
        }
    }
    return false;
}

void CWebView2Host::OnWebMessage(const std::wstring& msg)
{
    if (mClosed) return;

    if (JsonFieldEquals(msg, L"cmd", L"ready")) {
        OnPageReady();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"painted")) {
        // Force a fresh DirectComposition surface after the page has real
        // content: hide → bounds nudge → show. Needed especially after
        // reparent from the parking window into Lister.
        if (mController && !mParked && mParentWin) {
            RECT bounds;
            GetClientRect(mParentWin, &bounds);
            mController->put_IsVisible(FALSE);
            if (bounds.right > 1 && bounds.bottom > 1) {
                RECT nudge = bounds;
                nudge.right -= 1;
                nudge.bottom -= 1;
                mController->put_Bounds(nudge);
            }
            Resize();
            mController->NotifyParentWindowPositionChanged();
            mController->put_IsVisible(TRUE);
        }
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"theme")) {
        mDark = msg.find(L"\"dark\":true") != std::wstring::npos;
        if (mController) ConfigureControllerRendering(mController, mParentWin, mDark);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"save")) {
        std::wstring content;
        bool ok = false;
        if (!mFilePath.empty() && JsonUnescapeField(msg, L"content", content))
            ok = WriteTextFile(mFilePath.c_str(), content, mEncoding);
        std::wstring reply = L"{\"cmd\":\"saved\",\"ok\":";
        reply += ok ? L"true" : L"false";
        reply += L"}";
        PostJson(reply);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"pdf")) {
        ExportPdf();
        return;
    }
}

void CWebView2Host::ExportPdf()
{
    ICoreWebView2_7* wv7 = NULL;
    if (!mWebView || FAILED(mWebView->QueryInterface(__uuidof(ICoreWebView2_7), (void**)&wv7)) || !wv7) {
        PostJson(L"{\"cmd\":\"pdfDone\",\"ok\":false}");
        return;
    }

    std::wstring defName = L"export.pdf";
    if (!mFilePath.empty()) {
        size_t slash = mFilePath.find_last_of(L"\\/");
        defName = (slash == std::wstring::npos) ? mFilePath : mFilePath.substr(slash + 1);
        size_t dot = defName.rfind(L'.');
        if (dot != std::wstring::npos) defName.erase(dot);
        defName += L".pdf";
    }

    wchar_t filePath[MAX_PATH] = {};
    wcsncpy_s(filePath, defName.c_str(), _TRUNCATE);

    OPENFILENAMEW ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = mParentWin;
    ofn.lpstrFilter = L"PDF files (*.pdf)\0*.pdf\0All files (*.*)\0*.*\0";
    ofn.lpstrFile = filePath;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrDefExt = L"pdf";
    ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    ofn.lpstrTitle = L"Экспорт в PDF";

    if (!GetSaveFileNameW(&ofn)) {
        wv7->Release();
        PostJson(L"{\"cmd\":\"pdfDone\",\"ok\":false}");
        return;
    }

    AddRef();   // released by the completion handler
    PdfCompletedHandler* cb = new PdfCompletedHandler(this);
    HRESULT hr = wv7->PrintToPdf(filePath, NULL, cb);
    cb->Release();
    wv7->Release();

    if (FAILED(hr)) {
        Release();
        PostJson(L"{\"cmd\":\"pdfDone\",\"ok\":false}");
    }
}
