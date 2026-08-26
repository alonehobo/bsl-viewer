#include "bslcommon.h"

#include <vector>
#include <wchar.h>

namespace {

const UINT CP_WINDOWS_1251 = 1251;

std::wstring DecodeCodePage(UINT cp, const char* p, int len)
{
    if (len <= 0) return std::wstring();
    int wlen = MultiByteToWideChar(cp, 0, p, len, NULL, 0);
    if (wlen <= 0) return std::wstring();
    std::wstring out(wlen, L'\0');
    MultiByteToWideChar(cp, 0, p, len, &out[0], wlen);
    return out;
}

} // namespace

std::wstring Utf8ToWide(const char* s, int len)
{
    return DecodeCodePage(CP_UTF8, s, len);
}

std::wstring AnsiToWide(const char* s)
{
    if (!s) return std::wstring();
    return DecodeCodePage(CP_ACP, s, (int)strlen(s));
}

TextFile ReadTextFile(const wchar_t* path, DWORD maxBytes)
{
    TextFile result;

    HANDLE hFile = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                               NULL, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return result;

    LARGE_INTEGER size = {};
    if (!GetFileSizeEx(hFile, &size)) { CloseHandle(hFile); return result; }
    if (maxBytes && (size.QuadPart > (LONGLONG)maxBytes)) { CloseHandle(hFile); return result; }
    if (size.QuadPart > 0x7FFFFFFF) { CloseHandle(hFile); return result; }

    DWORD fileSize = (DWORD)size.QuadPart;
    std::vector<BYTE> data;
    if (fileSize) {
        try {
            data.resize(fileSize);
        } catch (const std::bad_alloc&) {
            CloseHandle(hFile);
            return result;
        }
        DWORD total = 0;
        while (total < fileSize) {
            DWORD got = 0;
            if (!ReadFile(hFile, data.data() + total, fileSize - total, &got, NULL) || got == 0) break;
            total += got;
        }
        data.resize(total);
    }
    CloseHandle(hFile);

    // An empty file is a valid, successfully read file.
    result.ok = true;

    const BYTE* p = data.data();
    size_t sz = data.size();

    if (sz >= 3 && p[0] == 0xEF && p[1] == 0xBB && p[2] == 0xBF) {
        result.encoding = ENC_UTF8_BOM;
        result.text = Utf8ToWide((const char*)p + 3, (int)(sz - 3));
        return result;
    }
    if (sz >= 2 && p[0] == 0xFF && p[1] == 0xFE) {
        result.encoding = ENC_UTF16LE;
        result.text.assign((const wchar_t*)(p + 2), (sz - 2) / sizeof(wchar_t));
        return result;
    }
    if (sz >= 2 && p[0] == 0xFE && p[1] == 0xFF) {
        result.encoding = ENC_UTF16BE;
        result.text.resize((sz - 2) / sizeof(wchar_t));
        for (size_t i = 0; i < result.text.size(); i++)
            result.text[i] = (wchar_t)((p[2 + i * 2] << 8) | p[2 + i * 2 + 1]);
        return result;
    }
    if (sz == 0) {
        result.encoding = ENC_UTF8;
        return result;
    }

    int wlen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char*)p, (int)sz, NULL, 0);
    if (wlen > 0) {
        result.encoding = ENC_UTF8;
        result.text = Utf8ToWide((const char*)p, (int)sz);
        return result;
    }

    result.encoding = ENC_ANSI;
    result.text = DecodeCodePage(CP_WINDOWS_1251, (const char*)p, (int)sz);
    return result;
}

bool WriteTextFile(const wchar_t* path, const std::wstring& text, TextEncoding encoding)
{
    std::vector<BYTE> out;

    switch (encoding) {
    case ENC_UTF16LE:
    case ENC_UTF16BE: {
        bool bigEndian = (encoding == ENC_UTF16BE);
        out.reserve((text.size() + 1) * 2);
        out.push_back(bigEndian ? 0xFE : 0xFF);
        out.push_back(bigEndian ? 0xFF : 0xFE);
        for (wchar_t ch : text) {
            BYTE lo = (BYTE)(ch & 0xFF), hi = (BYTE)(ch >> 8);
            if (bigEndian) { out.push_back(hi); out.push_back(lo); }
            else           { out.push_back(lo); out.push_back(hi); }
        }
        break;
    }
    default: {
        UINT cp = (encoding == ENC_ANSI) ? CP_WINDOWS_1251 : CP_UTF8;
        int len = 0;
        if (!text.empty()) {
            len = WideCharToMultiByte(cp, 0, text.c_str(), (int)text.size(), NULL, 0, NULL, NULL);
            if (len < 0) return false;
        }
        size_t offset = 0;
        if (encoding == ENC_UTF8_BOM) {
            out.resize(3 + len);
            out[0] = 0xEF; out[1] = 0xBB; out[2] = 0xBF;
            offset = 3;
        } else {
            out.resize(len);
        }
        if (len)
            WideCharToMultiByte(cp, 0, text.c_str(), (int)text.size(), (char*)out.data() + offset, len, NULL, NULL);
        break;
    }
    }

    HANDLE hFile = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return false;

    bool ok = true;
    size_t written = 0;
    while (written < out.size()) {
        DWORD chunk = 0;
        DWORD want = (DWORD)((out.size() - written > 0x10000000u) ? 0x10000000u : (out.size() - written));
        if (!WriteFile(hFile, out.data() + written, want, &chunk, NULL) || chunk == 0) { ok = false; break; }
        written += chunk;
    }
    CloseHandle(hFile);
    return ok;
}

std::wstring JsonEscape(const std::wstring& src)
{
    static const wchar_t* kHex = L"0123456789abcdef";
    std::wstring out;
    out.reserve(src.size() + src.size() / 8 + 16);
    for (wchar_t ch : src) {
        switch (ch) {
        case L'"':  out += L"\\\""; break;
        case L'\\': out += L"\\\\"; break;
        case L'\b': out += L"\\b";  break;
        case L'\f': out += L"\\f";  break;
        case L'\n': out += L"\\n";  break;
        case L'\r': out += L"\\r";  break;
        case L'\t': out += L"\\t";  break;
        default:
            if (ch < 0x20) {
                out += L"\\u00";
                out += kHex[(ch >> 4) & 0xF];
                out += kHex[ch & 0xF];
            } else {
                out += ch;
            }
        }
    }
    return out;
}

const char* MonacoLanguageForPath(const wchar_t* path)
{
    const wchar_t* dot = wcsrchr(path, L'.');
    if (!dot) return "plaintext";

    wchar_t ext[16];
    size_t n = 0;
    for (const wchar_t* p = dot + 1; *p && n < 15; p++) {
        if (*p >= 0x80) return "plaintext";
        ext[n++] = (wchar_t)towlower(*p);
    }
    ext[n] = 0;

    if (!wcscmp(ext, L"bsl") || !wcscmp(ext, L"os"))       return "bsl";
    if (!wcscmp(ext, L"sdbl") || !wcscmp(ext, L"query"))   return "bsl";
    if (!wcscmp(ext, L"md") || !wcscmp(ext, L"markdown"))  return "markdown";
    if (!wcscmp(ext, L"json"))                             return "json";
    if (!wcscmp(ext, L"xml"))                              return "xml";
    if (!wcscmp(ext, L"ps1") || !wcscmp(ext, L"psm1") || !wcscmp(ext, L"psd1")) return "powershell";
    if (!wcscmp(ext, L"html") || !wcscmp(ext, L"htm"))     return "html";
    return "plaintext";
}

std::wstring ModuleDirectory(HMODULE module)
{
    std::vector<wchar_t> buf(MAX_PATH);
    for (;;) {
        DWORD n = GetModuleFileNameW(module, buf.data(), (DWORD)buf.size());
        if (n == 0) return std::wstring();
        if (n < buf.size() - 1) break;
        if (buf.size() >= 32768) return std::wstring();
        buf.resize(buf.size() * 2);
    }
    std::wstring path(buf.data());
    size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return std::wstring();
    return path.substr(0, slash + 1);
}
