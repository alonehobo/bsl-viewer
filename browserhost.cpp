#include "browserhost.h"
#include <objbase.h>
#include <shlwapi.h>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

CBrowserHost::CBrowserHost()
    : mParentWin(NULL)
    , mWebBrowser(NULL)
    , mOleObject(NULL)
    , mInPlaceObject(NULL)
    , mRefCount(1)
    , mAllowScripts(false)
{
}

CBrowserHost::~CBrowserHost()
{
    Quit();
}

bool CBrowserHost::CreateBrowser(HWND hParent)
{
    mParentWin = hParent;

    // Create WebBrowser via CoCreateInstance (standard pattern)
    HRESULT hr = CoCreateInstance(CLSID_WebBrowser, NULL, CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER,
                                  IID_IOleObject, (void**)&mOleObject);
    if (FAILED(hr)) return false;

    hr = mOleObject->SetClientSite(this);
    if (FAILED(hr)) { mOleObject->Release(); mOleObject = NULL; return false; }

    // Mark as contained object (enables in-place activation)
    OleSetContainedObject((IUnknown*)mOleObject, TRUE);

    RECT rect;
    GetClientRect(mParentWin, &rect);

    hr = mOleObject->DoVerb(OLEIVERB_INPLACEACTIVATE, NULL, this, 0, mParentWin, &rect);
    if (FAILED(hr)) { mOleObject->Release(); mOleObject = NULL; return false; }

    hr = mOleObject->QueryInterface(IID_IWebBrowser2, (void**)&mWebBrowser);
    if (FAILED(hr)) { mOleObject->Release(); mOleObject = NULL; return false; }

    mOleObject->QueryInterface(IID_IOleInPlaceObject, (void**)&mInPlaceObject);

    mWebBrowser->put_Silent(VARIANT_TRUE);

    // Navigate to blank page first (needed before LoadHTML)
    VARIANT vEmpty;
    VariantInit(&vEmpty);
    BSTR bstrURL = SysAllocString(L"about:blank");
    hr = mWebBrowser->Navigate(bstrURL, &vEmpty, &vEmpty, &vEmpty, &vEmpty);
    SysFreeString(bstrURL);

    // Wait for navigation to complete
    READYSTATE rs;
    int timeout = 200;
    do {
        MSG msg;
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
        mWebBrowser->get_ReadyState(&rs);
        if (--timeout <= 0) break;
        Sleep(5);
    } while (rs != READYSTATE_COMPLETE);

    return true;
}

void CBrowserHost::Quit()
{
    if (mInPlaceObject) {
        mInPlaceObject->Release();
        mInPlaceObject = NULL;
    }
    if (mWebBrowser) {
        mWebBrowser->Release();
        mWebBrowser = NULL;
    }
    if (mOleObject) {
        mOleObject->Close(OLECLOSE_NOSAVE);
        mOleObject->SetClientSite(NULL);
        mOleObject->Release();
        mOleObject = NULL;
    }
}

void CBrowserHost::Resize()
{
    if (mInPlaceObject) {
        RECT rect;
        GetClientRect(mParentWin, &rect);
        mInPlaceObject->SetObjectRects(&rect, &rect);
    }
}

void CBrowserHost::LoadHTML(const std::string& html)
{
    if (!mWebBrowser) return;

    IDispatch* pDisp = NULL;
    mWebBrowser->get_Document(&pDisp);
    if (!pDisp) return;

    IHTMLDocument2* pDoc = NULL;
    HRESULT hr = pDisp->QueryInterface(IID_IHTMLDocument2, (void**)&pDoc);
    pDisp->Release();
    if (FAILED(hr) || !pDoc) return;

    // Method 1: Try IPersistStreamInit (most reliable)
    IPersistStreamInit* pPersist = NULL;
    hr = pDoc->QueryInterface(IID_IPersistStreamInit, (void**)&pPersist);
    if (SUCCEEDED(hr) && pPersist) {
        IStream* pStream = SHCreateMemStream((const BYTE*)html.c_str(), (UINT)html.size());
        if (pStream) {
            pPersist->InitNew();
            hr = pPersist->Load(pStream);
            pStream->Release();
        }
        pPersist->Release();

        if (SUCCEEDED(hr)) {
            pDoc->Release();
            return;
        }
    }

    // Method 2: Fallback to document.write()
    {
        // Convert UTF-8 HTML to wide string
        int wlen = MultiByteToWideChar(CP_UTF8, 0, html.c_str(), (int)html.size(), NULL, 0);
        if (wlen > 0) {
            BSTR bstrHTML = SysAllocStringLen(NULL, wlen);
            MultiByteToWideChar(CP_UTF8, 0, html.c_str(), (int)html.size(), bstrHTML, wlen);

            SAFEARRAY* psa = SafeArrayCreateVector(VT_VARIANT, 0, 1);
            if (psa) {
                VARIANT* pVar;
                SafeArrayAccessData(psa, (void**)&pVar);
                V_VT(pVar) = VT_BSTR;
                V_BSTR(pVar) = bstrHTML;
                SafeArrayUnaccessData(psa);

                pDoc->write(psa);
                pDoc->close();

                // Don't free bstrHTML - SafeArray owns it now
                SafeArrayDestroy(psa);
            } else {
                SysFreeString(bstrHTML);
            }
        }
    }

    pDoc->Release();
}

bool CBrowserHost::FindText(const wchar_t* text, int flags)
{
    if (!mWebBrowser || !text || !text[0]) return false;

    IDispatch* pDisp = NULL;
    mWebBrowser->get_Document(&pDisp);
    if (!pDisp) return false;

    IHTMLDocument2* pDoc = NULL;
    pDisp->QueryInterface(IID_IHTMLDocument2, (void**)&pDoc);
    pDisp->Release();
    if (!pDoc) return false;

    IHTMLElement* pBody = NULL;
    pDoc->get_body(&pBody);
    if (!pBody) { pDoc->Release(); return false; }

    IHTMLBodyElement* pBodyElem = NULL;
    pBody->QueryInterface(IID_IHTMLBodyElement, (void**)&pBodyElem);
    pBody->Release();
    if (!pBodyElem) { pDoc->Release(); return false; }

    IHTMLTxtRange* pRange = NULL;
    pBodyElem->createTextRange(&pRange);
    pBodyElem->Release();
    if (!pRange) { pDoc->Release(); return false; }

    long searchFlags = 0;
    if (flags & 2) searchFlags |= 4; // matchCase
    if (flags & 4) searchFlags |= 2; // wholeWord

    BSTR bstrText = SysAllocString(text);
    VARIANT_BOOL found = VARIANT_FALSE;
    pRange->findText(bstrText, 1000000, searchFlags, &found);
    SysFreeString(bstrText);

    if (found == VARIANT_TRUE) {
        pRange->select();
        pRange->scrollIntoView(VARIANT_TRUE);
    }

    pRange->Release();
    pDoc->Release();
    return found == VARIANT_TRUE;
}

// IUnknown
STDMETHODIMP CBrowserHost::QueryInterface(REFIID riid, void** ppvObject)
{
    if (!ppvObject) return E_POINTER;

    if (IsEqualIID(riid, IID_IUnknown))
        *ppvObject = static_cast<IUnknown*>(static_cast<IOleClientSite*>(this));
    else if (IsEqualIID(riid, IID_IOleClientSite))
        *ppvObject = static_cast<IOleClientSite*>(this);
    else if (IsEqualIID(riid, IID_IOleInPlaceSite))
        *ppvObject = static_cast<IOleInPlaceSite*>(this);
    else if (IsEqualIID(riid, IID_IOleInPlaceFrame))
        *ppvObject = static_cast<IOleInPlaceFrame*>(this);
    else if (IsEqualIID(riid, IID_IDispatch))
        *ppvObject = static_cast<IDispatch*>(this);
    else if (IsEqualIID(riid, IID_IDocHostUIHandler))
        *ppvObject = static_cast<IDocHostUIHandler*>(this);
    else {
        *ppvObject = NULL;
        return E_NOINTERFACE;
    }

    AddRef();
    return S_OK;
}

STDMETHODIMP_(ULONG) CBrowserHost::AddRef() { return ++mRefCount; }
STDMETHODIMP_(ULONG) CBrowserHost::Release()
{
    if (--mRefCount == 0) { delete this; return 0; }
    return mRefCount;
}

// IOleClientSite
STDMETHODIMP CBrowserHost::SaveObject() { return S_OK; }
STDMETHODIMP CBrowserHost::GetMoniker(DWORD, DWORD, IMoniker**) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::GetContainer(IOleContainer** ppContainer) { *ppContainer = NULL; return E_NOINTERFACE; }
STDMETHODIMP CBrowserHost::ShowObject() { return S_OK; }
STDMETHODIMP CBrowserHost::OnShowWindow(BOOL) { return S_OK; }
STDMETHODIMP CBrowserHost::RequestNewObjectLayout() { return E_NOTIMPL; }

// IOleWindow / IOleInPlaceSite
STDMETHODIMP CBrowserHost::GetWindow(HWND* phwnd) { *phwnd = mParentWin; return S_OK; }
STDMETHODIMP CBrowserHost::ContextSensitiveHelp(BOOL) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::CanInPlaceActivate() { return S_OK; }
STDMETHODIMP CBrowserHost::OnInPlaceActivate() { return S_OK; }
STDMETHODIMP CBrowserHost::OnUIActivate() { return S_OK; }

STDMETHODIMP CBrowserHost::GetWindowContext(IOleInPlaceFrame** ppFrame, IOleInPlaceUIWindow** ppDoc,
                                             LPRECT lprcPosRect, LPRECT lprcClipRect,
                                             LPOLEINPLACEFRAMEINFO lpFrameInfo)
{
    *ppFrame = static_cast<IOleInPlaceFrame*>(this);
    AddRef();
    *ppDoc = NULL;
    GetClientRect(mParentWin, lprcPosRect);
    *lprcClipRect = *lprcPosRect;
    lpFrameInfo->fMDIApp = FALSE;
    lpFrameInfo->hwndFrame = mParentWin;
    lpFrameInfo->haccel = NULL;
    lpFrameInfo->cAccelEntries = 0;
    return S_OK;
}

STDMETHODIMP CBrowserHost::Scroll(SIZE) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::OnUIDeactivate(BOOL) { return S_OK; }
STDMETHODIMP CBrowserHost::OnInPlaceDeactivate() { return S_OK; }
STDMETHODIMP CBrowserHost::DiscardUndoState() { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::DeactivateAndUndo() { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::OnPosRectChange(LPCRECT) { return S_OK; }

// IOleInPlaceFrame
STDMETHODIMP CBrowserHost::InsertMenus(HMENU, LPOLEMENUGROUPWIDTHS) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::SetMenu(HMENU, HOLEMENU, HWND) { return S_OK; }
STDMETHODIMP CBrowserHost::RemoveMenus(HMENU) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::SetStatusText(LPCOLESTR) { return S_OK; }
STDMETHODIMP CBrowserHost::EnableModeless(BOOL) { return S_OK; }
STDMETHODIMP CBrowserHost::TranslateAccelerator(LPMSG, WORD) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::GetBorder(LPRECT) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::RequestBorderSpace(LPCBORDERWIDTHS) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::SetBorderSpace(LPCBORDERWIDTHS) { return S_OK; }
STDMETHODIMP CBrowserHost::SetActiveObject(IOleInPlaceActiveObject*, LPCOLESTR) { return S_OK; }

// IDispatch (ambient properties)
STDMETHODIMP CBrowserHost::GetTypeInfoCount(UINT* pctinfo) { *pctinfo = 0; return S_OK; }
STDMETHODIMP CBrowserHost::GetTypeInfo(UINT, LCID, ITypeInfo**) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::GetIDsOfNames(REFIID, LPOLESTR*, UINT, LCID, DISPID*) { return E_NOTIMPL; }

STDMETHODIMP CBrowserHost::Invoke(DISPID dispIdMember, REFIID, LCID, WORD, DISPPARAMS*,
                                   VARIANT* pVarResult, EXCEPINFO*, UINT*)
{
    // DISPID_AMBIENT_DLCONTROL
    if (dispIdMember == -5512 && pVarResult) {
        // Disable scripts, Java, ActiveX for security; allow images
        DWORD flags = 0x10 /*DLCTL_NO_JAVA*/ | 0x20 /*DLCTL_NO_DLACTIVEXCTLS*/
                    | 0x200 /*DLCTL_NO_RUNACTIVEXCTLS*/ | 0x100 /*DLCTL_SILENT*/;
        if (!mAllowScripts)
            flags |= 0x80; // DLCTL_NO_SCRIPTS
        V_VT(pVarResult) = VT_I4;
        V_I4(pVarResult) = flags;
        return S_OK;
    }
    return DISP_E_MEMBERNOTFOUND;
}

// IDocHostUIHandler
STDMETHODIMP CBrowserHost::ShowContextMenu(DWORD, POINT*, IUnknown*, IDispatch*)
{
    return S_FALSE; // Let default context menu show
}

STDMETHODIMP CBrowserHost::GetHostInfo(DOCHOSTUIINFO* pInfo)
{
    if (pInfo) {
        pInfo->cbSize = sizeof(DOCHOSTUIINFO);
        pInfo->dwFlags = DOCHOSTUIFLAG_NO3DBORDER | DOCHOSTUIFLAG_THEME;
        pInfo->dwDoubleClick = DOCHOSTUIDBLCLK_DEFAULT;
        pInfo->pchHostCss = NULL;
        pInfo->pchHostNS = NULL;
    }
    return S_OK;
}

STDMETHODIMP CBrowserHost::ShowUI(DWORD, IOleInPlaceActiveObject*, IOleCommandTarget*,
                                   IOleInPlaceFrame*, IOleInPlaceUIWindow*) { return S_FALSE; }
STDMETHODIMP CBrowserHost::HideUI() { return S_OK; }
STDMETHODIMP CBrowserHost::UpdateUI() { return S_OK; }
STDMETHODIMP CBrowserHost::OnDocWindowActivate(BOOL) { return S_OK; }
STDMETHODIMP CBrowserHost::OnFrameWindowActivate(BOOL) { return S_OK; }
STDMETHODIMP CBrowserHost::ResizeBorder(LPCRECT, IOleInPlaceUIWindow*, BOOL) { return S_OK; }
STDMETHODIMP CBrowserHost::TranslateAccelerator(LPMSG, const GUID*, DWORD) { return S_FALSE; }
STDMETHODIMP CBrowserHost::GetOptionKeyPath(LPOLESTR*, DWORD) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::GetDropTarget(IDropTarget*, IDropTarget**) { return E_NOTIMPL; }
STDMETHODIMP CBrowserHost::GetExternal(IDispatch** ppDispatch) { *ppDispatch = NULL; return S_FALSE; }
STDMETHODIMP CBrowserHost::TranslateUrl(DWORD, LPOLESTR, LPOLESTR*) { return S_FALSE; }
STDMETHODIMP CBrowserHost::FilterDataObject(IDataObject*, IDataObject**) { return S_FALSE; }
