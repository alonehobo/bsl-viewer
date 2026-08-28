// Round-trip and escaping checks for bslcommon.cpp.
// Build with tools\run-tests.bat.

#include <windows.h>
#include <stdio.h>
#include <string>
#include <vector>

#include "../bslcommon.h"

static int g_failures = 0;

static void Check(bool cond, const char* what)
{
    printf("%s  %s\n", cond ? "[ ok ]" : "[FAIL]", what);
    if (!cond) g_failures++;
}

static std::wstring TempFilePath(const wchar_t* name)
{
    wchar_t dir[MAX_PATH];
    GetTempPathW(MAX_PATH, dir);
    return std::wstring(dir) + name;
}

static std::vector<BYTE> RawBytes(const std::wstring& path)
{
    std::vector<BYTE> out;
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) return out;
    DWORD size = GetFileSize(h, NULL);
    out.resize(size);
    DWORD got = 0;
    if (size) ReadFile(h, out.data(), size, &got, NULL);
    out.resize(got);
    CloseHandle(h);
    return out;
}

static void WriteRaw(const std::wstring& path, const void* data, size_t len)
{
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    DWORD written = 0;
    if (len) WriteFile(h, data, (DWORD)len, &written, NULL);
    CloseHandle(h);
}

// Reading a file, then saving it unchanged, must reproduce the original bytes.
static void TestRoundTrip(const char* label, const void* bytes, size_t len, TextEncoding expected)
{
    std::wstring path = TempFilePath(L"bslview_test_rt.tmp");
    WriteRaw(path, bytes, len);

    TextFile f = ReadTextFile(path.c_str(), 0);
    char msg[256];

    sprintf_s(msg, "%s: read succeeds", label);
    Check(f.ok, msg);

    sprintf_s(msg, "%s: encoding detected as %d", label, (int)expected);
    Check(f.encoding == expected, msg);

    Check(WriteTextFile(path.c_str(), f.text, f.encoding), "  write back succeeds");

    std::vector<BYTE> after = RawBytes(path);
    bool identical = (after.size() == len) && (len == 0 || memcmp(after.data(), bytes, len) == 0);
    sprintf_s(msg, "%s: bytes unchanged after save (%zu -> %zu)", label, len, after.size());
    Check(identical, msg);

    DeleteFileW(path.c_str());
}

int main()
{
    printf("== encoding round-trip ==\n");

    const char utf8Bom[] = "\xEF\xBB\xBF" "\xD0\x9F\xD1\x80\xD0\xBE\xD1\x86\xD0\xB5\xD0\xB4\xD1\x83\xD1\x80\xD0\xB0\r\n";
    TestRoundTrip("utf-8 bom", utf8Bom, sizeof(utf8Bom) - 1, ENC_UTF8_BOM);

    const char utf8[] = "\xD0\x9F\xD1\x80\xD0\xBE\xD1\x86\xD0\xB5\xD0\xB4\xD1\x83\xD1\x80\xD0\xB0\r\n";
    TestRoundTrip("utf-8 no bom", utf8, sizeof(utf8) - 1, ENC_UTF8);

    // "Процедура" in Windows-1251, which is what 1C Designer writes by default.
    const char cp1251[] = "\xCF\xF0\xEE\xF6\xE5\xE4\xF3\xF0\xE0\r\n";
    TestRoundTrip("windows-1251", cp1251, sizeof(cp1251) - 1, ENC_ANSI);

    const char utf16le[] = "\xFF\xFE" "\x1F\x04\x40\x04\x3E\x04";
    TestRoundTrip("utf-16 le", utf16le, sizeof(utf16le) - 1, ENC_UTF16LE);

    const char utf16be[] = "\xFE\xFF" "\x04\x1F\x04\x40\x04\x3E";
    TestRoundTrip("utf-16 be", utf16be, sizeof(utf16be) - 1, ENC_UTF16BE);

    printf("\n== lossless content ==\n");
    {
        // Form feed and vertical tab used to be silently dropped on the way to
        // the editor, which meant editing a file deleted them permanently.
        const char withControls[] = "\xEF\xBB\xBF" "A\x0C" "B\x0B" "C\r\n";
        TestRoundTrip("control characters", withControls, sizeof(withControls) - 1, ENC_UTF8_BOM);

        // U+1F600, a surrogate pair in UTF-16, used to be re-encoded as CESU-8.
        const char emoji[] = "\xEF\xBB\xBF" "x\xF0\x9F\x98\x80y";
        TestRoundTrip("astral plane (surrogate pair)", emoji, sizeof(emoji) - 1, ENC_UTF8_BOM);
    }

    printf("\n== empty file ==\n");
    {
        std::wstring path = TempFilePath(L"bslview_test_empty.tmp");
        WriteRaw(path, "", 0);
        TextFile f = ReadTextFile(path.c_str(), 0);
        Check(f.ok, "empty file reads as ok (not an error)");
        Check(f.text.empty(), "empty file yields empty text");
        DeleteFileW(path.c_str());
    }

    printf("\n== size limit ==\n");
    {
        std::wstring path = TempFilePath(L"bslview_test_big.tmp");
        std::string big(200000, 'x');
        WriteRaw(path, big.data(), big.size());
        Check(!ReadTextFile(path.c_str(), 1000).ok, "file over the limit is rejected");
        Check(ReadTextFile(path.c_str(), 0).ok, "no limit means no rejection");
        DeleteFileW(path.c_str());
    }

    printf("\n== json escaping ==\n");
    {
        Check(JsonEscape(L"a\"b") == L"a\\\"b", "quote escaped");
        Check(JsonEscape(L"a\\b") == L"a\\\\b", "backslash escaped");
        Check(JsonEscape(L"a\nb") == L"a\\nb", "newline escaped");
        Check(JsonEscape(L"a\tb") == L"a\\tb", "tab escaped");
        Check(JsonEscape(L"a\x0C" L"b") == L"a\\fb", "form feed escaped, not dropped");
        Check(JsonEscape(L"a\x01" L"b") == L"a\\u0001b", "other control chars escaped as \\u");

        std::wstring astral;
        astral += (wchar_t)0xD83D;
        astral += (wchar_t)0xDE00;
        Check(JsonEscape(astral) == astral, "surrogate pair passes through untouched");
    }

    printf("\n== language mapping ==\n");
    {
        Check(!strcmp(MonacoLanguageForPath(L"a\\b\\Module.bsl"), "bsl"), ".bsl -> bsl");
        Check(!strcmp(MonacoLanguageForPath(L"Module.OS"), "bsl"), ".OS is case-insensitive");
        Check(!strcmp(MonacoLanguageForPath(L"query.sdbl"), "bsl"), ".sdbl -> bsl");
        Check(!strcmp(MonacoLanguageForPath(L"readme.md"), "markdown"), ".md -> markdown");
        Check(!strcmp(MonacoLanguageForPath(L"data.json"), "json"), ".json -> json");
        Check(!strcmp(MonacoLanguageForPath(L"meta.XML"), "xml"), ".xml is case-insensitive");
        Check(!strcmp(MonacoLanguageForPath(L"noext"), "plaintext"), "no extension -> plaintext");
        Check(!strcmp(MonacoLanguageForPath(L"weird.zzz"), "plaintext"), "unknown -> plaintext");
    }

    printf("\n%s (%d failure%s)\n", g_failures ? "FAILED" : "PASSED", g_failures, g_failures == 1 ? "" : "s");
    return g_failures ? 1 : 0;
}
