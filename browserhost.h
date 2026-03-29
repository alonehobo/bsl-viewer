#ifndef BROWSERHOST_H
#define BROWSERHOST_H

#define _CONVERSION_DONT_USE_THREAD_LOCALE
#include <windows.h>
#include <exdisp.h>
#include <mshtml.h>
#include <mshtmhst.h>
#include <string>

class CBrowserHost :
    public IUnknown,
    public IDispatch,
    public IOleClientSite,
    public IOleInPlaceSite,
    public IOleInPlaceFrame,
    public IDocHostUIHandler
{
public:
    HWND mParentWin;
    IWebBrowser2* mWebBrowser;
    IOleObject* mOleObject;
    IOleInPlaceObject* mInPlaceObject;
    int mRefCount;
    bool mAllowScripts;

    CBrowserHost();
    ~CBrowserHost();

    bool CreateBrowser(HWND hParent);
    void Quit();
    void Resize();
    void LoadHTML(const std::string& html);
    bool FindText(const wchar_t* text, int flags);

    // IUnknown
    STDMETHODIMP QueryInterface(REFIID riid, void** ppvObject);
    STDMETHODIMP_(ULONG) AddRef();
    STDMETHODIMP_(ULONG) Release();

    // IOleClientSite
    STDMETHODIMP SaveObject();
    STDMETHODIMP GetMoniker(DWORD dwAssign, DWORD dwWhichMoniker, IMoniker** ppmk);
    STDMETHODIMP GetContainer(IOleContainer** ppContainer);
    STDMETHODIMP ShowObject();
    STDMETHODIMP OnShowWindow(BOOL fShow);
    STDMETHODIMP RequestNewObjectLayout();

    // IOleWindow (base of IOleInPlaceSite)
    STDMETHODIMP GetWindow(HWND* phwnd);
    STDMETHODIMP ContextSensitiveHelp(BOOL fEnterMode);

    // IOleInPlaceSite
    STDMETHODIMP CanInPlaceActivate();
    STDMETHODIMP OnInPlaceActivate();
    STDMETHODIMP OnUIActivate();
    STDMETHODIMP GetWindowContext(IOleInPlaceFrame** ppFrame, IOleInPlaceUIWindow** ppDoc,
                                  LPRECT lprcPosRect, LPRECT lprcClipRect,
                                  LPOLEINPLACEFRAMEINFO lpFrameInfo);
    STDMETHODIMP Scroll(SIZE scrollExtant);
    STDMETHODIMP OnUIDeactivate(BOOL fUndoable);
    STDMETHODIMP OnInPlaceDeactivate();
    STDMETHODIMP DiscardUndoState();
    STDMETHODIMP DeactivateAndUndo();
    STDMETHODIMP OnPosRectChange(LPCRECT lprcPosRect);

    // IOleInPlaceFrame
    STDMETHODIMP InsertMenus(HMENU hmenuShared, LPOLEMENUGROUPWIDTHS lpMenuWidths);
    STDMETHODIMP SetMenu(HMENU hmenuShared, HOLEMENU holemenu, HWND hwndActiveObject);
    STDMETHODIMP RemoveMenus(HMENU hmenuShared);
    STDMETHODIMP SetStatusText(LPCOLESTR pszStatusText);
    STDMETHODIMP EnableModeless(BOOL fEnable);
    STDMETHODIMP TranslateAccelerator(LPMSG lpmsg, WORD wID);
    STDMETHODIMP GetBorder(LPRECT lprectBorder);
    STDMETHODIMP RequestBorderSpace(LPCBORDERWIDTHS pborderwidths);
    STDMETHODIMP SetBorderSpace(LPCBORDERWIDTHS pborderwidths);
    STDMETHODIMP SetActiveObject(IOleInPlaceActiveObject* pActiveObject, LPCOLESTR pszObjName);

    // IDispatch (for ambient properties)
    STDMETHODIMP GetTypeInfoCount(UINT* pctinfo);
    STDMETHODIMP GetTypeInfo(UINT iTInfo, LCID lcid, ITypeInfo** ppTInfo);
    STDMETHODIMP GetIDsOfNames(REFIID riid, LPOLESTR* rgszNames, UINT cNames, LCID lcid, DISPID* rgDispId);
    STDMETHODIMP Invoke(DISPID dispIdMember, REFIID riid, LCID lcid, WORD wFlags,
                        DISPPARAMS* pDispParams, VARIANT* pVarResult,
                        EXCEPINFO* pExcepInfo, UINT* puArgErr);

    // IDocHostUIHandler
    STDMETHODIMP ShowContextMenu(DWORD dwID, POINT* ppt, IUnknown* pcmdtReserved, IDispatch* pdispReserved);
    STDMETHODIMP GetHostInfo(DOCHOSTUIINFO* pInfo);
    STDMETHODIMP ShowUI(DWORD dwID, IOleInPlaceActiveObject* pActiveObject, IOleCommandTarget* pCommandTarget,
                        IOleInPlaceFrame* pFrame, IOleInPlaceUIWindow* pDoc);
    STDMETHODIMP HideUI();
    STDMETHODIMP UpdateUI();
    STDMETHODIMP OnDocWindowActivate(BOOL fActivate);
    STDMETHODIMP OnFrameWindowActivate(BOOL fActivate);
    STDMETHODIMP ResizeBorder(LPCRECT prcBorder, IOleInPlaceUIWindow* pUIWindow, BOOL fRameWindow);
    STDMETHODIMP TranslateAccelerator(LPMSG lpMsg, const GUID* pguidCmdGroup, DWORD nCmdID);
    STDMETHODIMP GetOptionKeyPath(LPOLESTR* pchKey, DWORD dw);
    STDMETHODIMP GetDropTarget(IDropTarget* pDropTarget, IDropTarget** ppDropTarget);
    STDMETHODIMP GetExternal(IDispatch** ppDispatch);
    STDMETHODIMP TranslateUrl(DWORD dwTranslate, LPOLESTR pchURLIn, LPOLESTR* ppchURLOut);
    STDMETHODIMP FilterDataObject(IDataObject* pDO, IDataObject** ppDORet);
};

#endif // BROWSERHOST_H
