#ifndef LISTERPLUGIN_H
#define LISTERPLUGIN_H

#include <windows.h>

// ListSendCommand commands
#define lc_copy         1
#define lc_newparams    2
#define lc_selectall    3

// ShowFlags for ListLoad
#define lcp_wraptext    1
#define lcp_fittowindow 2
#define lcp_ansi        4
#define lcp_ascii       8
#define lcp_variable    12
#define lcp_forceshow   16
#define lcp_darkmode    128

// SearchParameter flags for ListSearchText
#define lcs_findfirst   1
#define lcs_matchcase   2
#define lcs_wholewords  4
#define lcs_backwards   8

#define LISTPLUGIN_OK    0
#define LISTPLUGIN_ERROR 1

// ListDefaultParamStruct
typedef struct {
    int size;
    DWORD PluginInterfaceVersionLow;
    DWORD PluginInterfaceVersionHi;
    char DefaultIniName[MAX_PATH];
} ListDefaultParamStruct;

#endif // LISTERPLUGIN_H
