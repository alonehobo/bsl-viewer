#include "webview2host.h"
#include <WebView2.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <functional>

#pragma comment(lib, "shlwapi.lib")

// Simple COM callback helpers
template<typename TInterface, typename TCallback>
class CallbackHandler : public TInterface {
    long mRefCount;
    TCallback mCallback;
public:
    CallbackHandler(TCallback cb) : mRefCount(1), mCallback(cb) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, __uuidof(TInterface))) {
            *ppv = static_cast<TInterface*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRefCount); }
    STDMETHODIMP_(ULONG) Release() {
        long ref = InterlockedDecrement(&mRefCount);
        if (ref == 0) delete this;
        return ref;
    }
    STDMETHODIMP Invoke(HRESULT hr, ICoreWebView2Environment* env) { return mCallback(hr, env); }
    STDMETHODIMP Invoke(HRESULT hr, ICoreWebView2Controller* ctrl) { return mCallback(hr, ctrl); }
};

// Wait for an event with message pumping
static void WaitWithPump(HANDLE hEvent, DWORD timeoutMs = 10000)
{
    DWORD start = GetTickCount();
    while (WaitForSingleObject(hEvent, 0) == WAIT_TIMEOUT) {
        if (GetTickCount() - start > timeoutMs) break;
        MSG msg;
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
        Sleep(1);
    }
}

CWebView2Host::CWebView2Host()
    : mParentWin(NULL), mWebView(NULL), mController(NULL), mEnvironment(NULL),
      mReady(false), mReadyEvent(NULL)
{
}

CWebView2Host::~CWebView2Host()
{
    Close();
}

bool CWebView2Host::Create(HWND hParent)
{
    mParentWin = hParent;
    mReadyEvent = CreateEvent(NULL, TRUE, FALSE, NULL);
    if (!mReadyEvent) return false;

    // Use temp folder for WebView2 user data
    wchar_t tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    std::wstring userDataFolder = std::wstring(tempPath) + L"BSLView_WebView2";

    // Step 1: Create environment
    HANDLE envEvent = CreateEvent(NULL, TRUE, FALSE, NULL);
    CWebView2Host* self = this;

    auto envCallback = new CallbackHandler<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler,
        std::function<HRESULT(HRESULT, ICoreWebView2Environment*)>>(
        [self, envEvent](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
            if (SUCCEEDED(hr) && env) {
                self->mEnvironment = env;
                env->AddRef();
            }
            SetEvent(envEvent);
            return S_OK;
        });

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        NULL, userDataFolder.c_str(), NULL, envCallback);

    if (FAILED(hr)) {
        CloseHandle(envEvent);
        CloseHandle(mReadyEvent);
        mReadyEvent = NULL;
        return false;
    }

    WaitWithPump(envEvent, 15000);
    CloseHandle(envEvent);

    if (!mEnvironment) {
        CloseHandle(mReadyEvent);
        mReadyEvent = NULL;
        return false;
    }

    // Step 2: Create controller
    HANDLE ctrlEvent = CreateEvent(NULL, TRUE, FALSE, NULL);

    auto ctrlCallback = new CallbackHandler<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler,
        std::function<HRESULT(HRESULT, ICoreWebView2Controller*)>>(
        [self, ctrlEvent](HRESULT hr, ICoreWebView2Controller* ctrl) -> HRESULT {
            if (SUCCEEDED(hr) && ctrl) {
                self->mController = ctrl;
                ctrl->AddRef();
                ctrl->get_CoreWebView2(&self->mWebView);

                RECT bounds;
                GetClientRect(self->mParentWin, &bounds);
                ctrl->put_Bounds(bounds);
                ctrl->put_IsVisible(TRUE);

                self->mReady = true;
            }
            SetEvent(ctrlEvent);
            return S_OK;
        });

    hr = mEnvironment->CreateCoreWebView2Controller(mParentWin, ctrlCallback);
    if (FAILED(hr)) {
        CloseHandle(ctrlEvent);
        CloseHandle(mReadyEvent);
        mReadyEvent = NULL;
        return false;
    }

    WaitWithPump(ctrlEvent, 15000);
    CloseHandle(ctrlEvent);

    if (!mReady) {
        CloseHandle(mReadyEvent);
        mReadyEvent = NULL;
        return false;
    }

    SetEvent(mReadyEvent);
    return true;
}

void CWebView2Host::Close()
{
    if (mWebView) {
        mWebView->Release();
        mWebView = NULL;
    }
    if (mController) {
        mController->Close();
        mController->Release();
        mController = NULL;
    }
    if (mEnvironment) {
        mEnvironment->Release();
        mEnvironment = NULL;
    }
    if (mReadyEvent) {
        CloseHandle(mReadyEvent);
        mReadyEvent = NULL;
    }
    mReady = false;
}

void CWebView2Host::Resize()
{
    if (mController) {
        RECT bounds;
        GetClientRect(mParentWin, &bounds);
        mController->put_Bounds(bounds);
    }
}

bool CWebView2Host::NavigateToString(const std::wstring& html)
{
    if (!mWebView) return false;
    return SUCCEEDED(mWebView->NavigateToString(html.c_str()));
}

bool CWebView2Host::NavigateToFile(const std::wstring& path)
{
    if (!mWebView) return false;
    std::wstring url = L"file:///" + path;
    // Replace backslashes with forward slashes
    for (auto& c : url) if (c == L'\\') c = L'/';
    return SUCCEEDED(mWebView->Navigate(url.c_str()));
}

// Save UTF-8 content to file (with BOM)
static bool SaveUTF8File(const std::wstring& path, const std::wstring& content)
{
    HANDLE hFile = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return false;

    // UTF-8 BOM
    BYTE bom[] = {0xEF, 0xBB, 0xBF};
    DWORD written;
    WriteFile(hFile, bom, 3, &written, NULL);

    // Convert wstring to UTF-8
    int utf8len = WideCharToMultiByte(CP_UTF8, 0, content.c_str(), (int)content.size(), NULL, 0, NULL, NULL);
    if (utf8len > 0) {
        std::string utf8(utf8len, 0);
        WideCharToMultiByte(CP_UTF8, 0, content.c_str(), (int)content.size(), &utf8[0], utf8len, NULL, NULL);
        WriteFile(hFile, utf8.c_str(), (DWORD)utf8.size(), &written, NULL);
    }
    CloseHandle(hFile);
    return true;
}

// WebMessage callback handler
class WebMessageHandler : public ICoreWebView2WebMessageReceivedEventHandler {
    long mRefCount;
    CWebView2Host* mHost;
public:
    WebMessageHandler(CWebView2Host* host) : mRefCount(1), mHost(host) {}
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, __uuidof(ICoreWebView2WebMessageReceivedEventHandler))) {
            *ppv = static_cast<ICoreWebView2WebMessageReceivedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRefCount); }
    STDMETHODIMP_(ULONG) Release() {
        long ref = InterlockedDecrement(&mRefCount);
        if (ref == 0) delete this;
        return ref;
    }
    STDMETHODIMP Invoke(ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) {
        wchar_t* msgRaw = NULL;
        args->TryGetWebMessageAsString(&msgRaw);
        if (!msgRaw) return S_OK;

        std::wstring msg(msgRaw);
        CoTaskMemFree(msgRaw);

        // Protocol: "SAVE:<content>"
        if (msg.substr(0, 5) == L"SAVE:") {
            std::wstring content = msg.substr(5);
            if (!mHost->mFilePath.empty()) {
                bool ok = SaveUTF8File(mHost->mFilePath, content);
                // Notify JS of result
                std::wstring response = ok ? L"SAVED:OK" : L"SAVED:ERROR";
                sender->PostWebMessageAsString(response.c_str());
            }
        }
        return S_OK;
    }
};

bool CWebView2Host::SetupMessageHandler()
{
    if (!mWebView) return false;
    EventRegistrationToken token;
    auto handler = new WebMessageHandler(this);
    HRESULT hr = mWebView->add_WebMessageReceived(handler, &token);
    handler->Release();
    return SUCCEEDED(hr);
}
