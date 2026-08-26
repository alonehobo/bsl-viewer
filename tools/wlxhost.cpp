// Minimal Total Commander Lister stand-in, used to time the plugin the way TC
// actually drives it: one ListSetDefaultParams at startup, then ListLoad /
// ListLoadNext against a long-lived process.
//
//   wlxhost.exe <plugin.wlx64> <file1> [file2] [warmupMs] [holdMs]

#include <windows.h>
#include <stdio.h>

typedef struct {
    int size;
    DWORD PluginInterfaceVersionLow;
    DWORD PluginInterfaceVersionHi;
    char DefaultIniName[MAX_PATH];
} ListDefaultParamStruct;

typedef void (__stdcall *PFN_SetDefaultParams)(ListDefaultParamStruct*);
typedef HWND (__stdcall *PFN_ListLoadW)(HWND, WCHAR*, int);
typedef int  (__stdcall *PFN_ListLoadNextW)(HWND, HWND, WCHAR*, int);
typedef void (__stdcall *PFN_ListCloseWindow)(HWND);

static LARGE_INTEGER g_freq;

static double Now()
{
    LARGE_INTEGER t;
    QueryPerformanceCounter(&t);
    return (double)t.QuadPart * 1000.0 / (double)g_freq.QuadPart;
}

static void Pump(double ms)
{
    double until = Now() + ms;
    while (Now() < until) {
        MSG msg;
        while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        Sleep(1);
    }
}

static LRESULT CALLBACK HostProc(HWND h, UINT m, WPARAM w, LPARAM l)
{
    if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(h, m, w, l);
}

int wmain(int argc, wchar_t** argv)
{
    if (argc < 3) {
        wprintf(L"usage: wlxhost <plugin> <file1> [file2] [warmupMs] [holdMs]\n");
        return 2;
    }
    QueryPerformanceFrequency(&g_freq);

    const wchar_t* pluginPath = argv[1];
    wchar_t* file1 = argv[2];
    wchar_t* file2 = (argc > 3) ? argv[3] : NULL;
    double warmupMs = (argc > 4) ? _wtof(argv[4]) : 3000.0;
    double holdMs   = (argc > 5) ? _wtof(argv[5]) : 6000.0;

    HMODULE dll = LoadLibraryW(pluginPath);
    if (!dll) { wprintf(L"LoadLibrary failed: %lu\n", GetLastError()); return 1; }

    PFN_SetDefaultParams setParams = (PFN_SetDefaultParams)GetProcAddress(dll, "ListSetDefaultParams");
    PFN_ListLoadW        listLoad  = (PFN_ListLoadW)GetProcAddress(dll, "ListLoadW");
    PFN_ListLoadNextW    listNext  = (PFN_ListLoadNextW)GetProcAddress(dll, "ListLoadNextW");
    PFN_ListCloseWindow  listClose = (PFN_ListCloseWindow)GetProcAddress(dll, "ListCloseWindow");
    if (!listLoad || !listClose) { wprintf(L"missing exports\n"); return 1; }

    WNDCLASSW wc = {};
    wc.lpfnWndProc = HostProc;
    wc.hInstance = GetModuleHandleW(NULL);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = L"WlxHostWnd";
    RegisterClassW(&wc);

    HWND parent = CreateWindowExW(0, L"WlxHostWnd", L"WLX Host", WS_OVERLAPPEDWINDOW,
                                  CW_USEDEFAULT, CW_USEDEFAULT, 1200, 800,
                                  NULL, NULL, wc.hInstance, NULL);
    ShowWindow(parent, SW_SHOW);
    UpdateWindow(parent);

    if (setParams) {
        ListDefaultParamStruct dps = {};
        dps.size = sizeof(dps);
        double t = Now();
        setParams(&dps);
        wprintf(L"ListSetDefaultParams returned in %.1f ms\n", Now() - t);
    }

    wprintf(L"warming up for %.0f ms (this is what Total Commander idles through)\n", warmupMs);
    Pump(warmupMs);

    double t0 = Now();
    HWND plug = listLoad(parent, file1, 0);
    wprintf(L"ListLoad #1 returned in %.1f ms  (hwnd=%p)\n", Now() - t0, plug);
    if (!plug) { wprintf(L"plugin refused the file\n"); return 1; }

    Pump(holdMs);

    if (file2 && listNext) {
        double t1 = Now();
        int rc = listNext(parent, plug, file2, 0);
        wprintf(L"ListLoadNext returned in %.1f ms  (rc=%d)\n", Now() - t1, rc);
        Pump(holdMs);
    }

    // Close and reopen: this is the path a user takes pressing F3 twice, and
    // the one the warm instance pool is meant to make cheap.
    listClose(plug);
    Pump(500);

    t0 = Now();
    plug = listLoad(parent, file1, 0);
    wprintf(L"ListLoad #2 returned in %.1f ms  (reopen after close)\n", Now() - t0);
    Pump(holdMs);

    if (plug) listClose(plug);
    Pump(300);
    DestroyWindow(parent);
    FreeLibrary(dll);
    return 0;
}
