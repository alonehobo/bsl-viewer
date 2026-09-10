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

// EDT / Configurator dump of a managed form:
//   <ObjectName>/Forms/<FormName>/Ext/Form.xml
// Companion metadata XML (catalog, document, external report/processor, …):
//   sibling  <ObjectName>.xml next to the object folder
//   nested   <ObjectName>/<ObjectName>.xml
struct ObjectMetaPaths {
    std::wstring sibling;
    std::wstring nested;
};

ObjectMetaPaths ObjectMetaCandidates(const wchar_t* formPath);
std::wstring FindObjectMetaFile(const wchar_t* formPath);
std::wstring LoadObjectMetaForForm(const wchar_t* formPath, DWORD maxBytes);

// The reverse direction: a form's own descriptor sits right in Forms/,
// next to the folder holding its rendered layout:
//   Forms/<FormName>.xml            (descriptor - what gets opened)
//   Forms/<FormName>/Ext/Form.xml   (the actual managed-form layout)
// Given the descriptor path, returns the layout path if it exists on disk,
// or an empty string when there is nothing to redirect to.
std::wstring FindFormLayoutForMeta(const wchar_t* metaPath);

#endif // BSLCOMMON_H
