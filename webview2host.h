#ifndef WEBVIEW2HOST_H
#define WEBVIEW2HOST_H

#include <windows.h>
#include <string>

// Forward declarations from WebView2.h
struct ICoreWebView2;
struct ICoreWebView2Controller;
struct ICoreWebView2Environment;

class CWebView2Host {
public:
    HWND mParentWin;
    ICoreWebView2* mWebView;
    ICoreWebView2Controller* mController;
    ICoreWebView2Environment* mEnvironment;
    bool mReady;
    HANDLE mReadyEvent;
    std::wstring mFilePath; // path to the BSL file being viewed/edited

    CWebView2Host();
    ~CWebView2Host();

    bool Create(HWND hParent);
    void Close();
    void Resize();
    bool NavigateToString(const std::wstring& html);
    bool NavigateToFile(const std::wstring& path);
    bool SetupMessageHandler();
};

#endif // WEBVIEW2HOST_H
