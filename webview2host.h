#ifndef WEBVIEW2HOST_H
#define WEBVIEW2HOST_H

#include <windows.h>
#include <string>

#include "bslcommon.h"

struct ICoreWebView2;
struct ICoreWebView2Controller;
struct ICoreWebView2Environment;

// Posted to the host window when WebView2 could not be started, so the caller
// can put up the legacy IE control instead. Delivered asynchronously because
// controller creation does not block.
#define WM_BSLVIEW_WEBVIEW_FAILED (WM_APP + 17)

// Hostname the viewer is served from. Using a virtual host rather than file://
// keeps the document URL stable, which is what lets Chromium reuse its HTTP and
// V8 code caches across openings, and keeps the Monaco workers same-origin.
#define BSLVIEW_VIRTUAL_HOST L"bslview.invalid"

struct BslLoadRequest {
    std::wstring content;
    const char*  language;
    bool         dark;
    int          fontSize;
    bool         readOnly;

    BslLoadRequest() : language("plaintext"), dark(false), fontSize(14), readOnly(true) {}
};

class CWebView2Host {
public:
    // Cheap registry probe; does not start the browser.
    static bool IsRuntimeAvailable();

    // Begins creating the process-wide environment and, when `keepWarm` is set,
    // a parked browser instance with the viewer page already loaded. Returns
    // immediately. Chromium only stays resident while some controller exists,
    // so the parked instance is what makes the next open cheap.
    static void WarmUp(const std::wstring& webRoot, bool keepWarm);

    static void Shutdown();

    // Hands back a host bound to `parent`, reusing the parked instance when one
    // is available. Returns immediately; if nothing was parked the browser is
    // attached later. Never returns NULL unless allocation fails.
    static CWebView2Host* Acquire(HWND parent, const std::wstring& webRoot);

    void AddRef();
    void Release();

    // Detaches from the window. The object stays alive until any in-flight
    // creation callback has run.
    void Close();

    // Detaches from the window but keeps the browser and the loaded viewer page
    // alive for the next open. Falls back to Close() when there is nothing
    // worth keeping or a slot is already taken.
    void Park();

    void Resize();

    // Shows `req` in the editor. Safe to call before the page has loaded; the
    // request is held and delivered once the page reports readiness. Calling it
    // again on a live page swaps the model without re-navigating.
    void Load(const BslLoadRequest& req);

    void Find(const std::wstring& text, bool matchCase, bool wholeWords, bool backwards, bool first);
    void SendCommand(const wchar_t* cmd);

    HWND         mParentWin;
    std::wstring mFilePath;
    TextEncoding mEncoding;

private:
    CWebView2Host();
    ~CWebView2Host();

    void OnControllerCreated(HRESULT hr, ICoreWebView2Controller* ctrl);
    void OnProcessFailed();
    void OnWebMessage(const std::wstring& msg);
    void OnPageReady();
    void ExportPdf();
    void PostJson(const std::wstring& json);
    void ConfigureSettings();
    void Reparent(HWND parent, bool visible);

    friend class EnvCompletedHandler;
    friend class CtrlCompletedHandler;
    friend class WebMessageHandler;
    friend class NavigationStartingHandler;
    friend class NewWindowHandler;
    friend class ProcessFailedHandler;
    friend class PdfCompletedHandler;

    long                      mRefCount;
    ICoreWebView2*            mWebView;
    ICoreWebView2Controller*  mController;
    std::wstring              mWebRoot;
    bool                      mClosed;
    bool                      mParked;
    bool                      mFailed;
    bool                      mPageReady;
    bool                      mHasPending;
    bool                      mDark;
    std::wstring              mPendingJson;
};

#endif // WEBVIEW2HOST_H
