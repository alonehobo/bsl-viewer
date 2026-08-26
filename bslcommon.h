#ifndef BSLCOMMON_H
#define BSLCOMMON_H

#include <windows.h>
#include <string>

enum TextEncoding {
    ENC_UTF8_BOM,
    ENC_UTF8,
    ENC_UTF16LE,
    ENC_UTF16BE,
    ENC_ANSI      // system OEM/ANSI fallback, in practice Windows-1251 for 1C sources
};

struct TextFile {
    std::wstring text;
    TextEncoding encoding;
    bool         ok;
    TextFile() : encoding(ENC_UTF8_BOM), ok(false) {}
};

// Reads a file and decodes it, remembering the encoding so that a later save
// can write the file back the way it was found.
TextFile ReadTextFile(const wchar_t* path, DWORD maxBytes);

// Writes text back using the encoding reported by ReadTextFile.
bool WriteTextFile(const wchar_t* path, const std::wstring& text, TextEncoding encoding);

// Escapes text for embedding in a JSON string literal. Operates on UTF-16
// throughout, so surrogate pairs survive untouched; control characters are
// escaped rather than dropped.
std::wstring JsonEscape(const std::wstring& src);

// Monaco language id for a file name, or "plaintext".
const char* MonacoLanguageForPath(const wchar_t* path);

// Directory containing the given module, with a trailing backslash.
std::wstring ModuleDirectory(HMODULE module);

std::wstring Utf8ToWide(const char* s, int len);
std::wstring AnsiToWide(const char* s);

#endif // BSLCOMMON_H
