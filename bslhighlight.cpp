#include "bslhighlight.h"
#include <windows.h>
#include <algorithm>
#include <vector>
#include <unordered_set>
#include <cwctype>
#include <cstring>

// --- Utility ---

static std::string WideToUTF8(const wchar_t* src, size_t len)
{
    if (!src || len == 0) return "";
    int needed = WideCharToMultiByte(CP_UTF8, 0, src, (int)len, NULL, 0, NULL, NULL);
    if (needed <= 0) return "";
    std::string result(needed, '\0');
    WideCharToMultiByte(CP_UTF8, 0, src, (int)len, &result[0], needed, NULL, NULL);
    return result;
}

static std::string HtmlEscape(const wchar_t* src, size_t len)
{
    std::string out;
    out.reserve(len * 2);
    for (size_t i = 0; i < len; i++) {
        wchar_t ch = src[i];
        switch (ch) {
        case L'&':  out += "&amp;"; break;
        case L'<':  out += "&lt;"; break;
        case L'>':  out += "&gt;"; break;
        case L'"':  out += "&quot;"; break;
        default:
            if (ch < 0x80) {
                out += (char)ch;
            } else {
                // Encode as UTF-8
                std::string utf8 = WideToUTF8(&ch, 1);
                out += utf8;
            }
        }
    }
    return out;
}

static std::wstring ToLower(const wchar_t* src, size_t len)
{
    std::wstring s(src, len);
    for (auto& c : s) c = towlower(c);
    return s;
}

// --- Keyword tables ---

static bool IsWordChar(wchar_t c)
{
    if (c >= L'a' && c <= L'z') return true;
    if (c >= L'A' && c <= L'Z') return true;
    if (c >= L'0' && c <= L'9') return true;
    if (c == L'_') return true;
    // Cyrillic range
    if (c >= 0x0400 && c <= 0x04FF) return true;
    return false;
}

struct KeywordSet {
    std::unordered_set<std::wstring> words;
    void Add(const wchar_t* w)
    {
        std::wstring s(w);
        for (auto& c : s) c = towlower(c);
        words.insert(s);
    }
    bool Contains(const std::wstring& lower) const { return words.count(lower) > 0; }
};

static KeywordSet g_keywords;
static KeywordSet g_builtinFunctions;
static KeywordSet g_constants;
static KeywordSet g_types;
static bool g_initialized = false;

static void InitKeywords()
{
    if (g_initialized) return;
    g_initialized = true;

    // Control flow keywords
    const wchar_t* kw[] = {
        // Russian / English pairs
        L"\x0415\x0441\x043B\x0438", L"If",                           // Если / If
        L"\x0422\x043E\x0433\x0434\x0430", L"Then",                   // Тогда / Then
        L"\x0418\x043D\x0430\x0447\x0435\x0415\x0441\x043B\x0438", L"ElsIf",  // ИначеЕсли / ElsIf
        L"\x0418\x043D\x0430\x0447\x0435", L"Else",                   // Иначе / Else
        L"\x041A\x043E\x043D\x0435\x0446\x0415\x0441\x043B\x0438", L"EndIf",  // КонецЕсли / EndIf
        L"\x0414\x043B\x044F", L"For",                                 // Для / For
        L"\x041A\x0430\x0436\x0434\x043E\x0433\x043E", L"Each",       // Каждого / Each
        L"\x0418\x0437", L"In",                                         // Из / In
        L"\x041F\x043E", L"To",                                         // По / To
        L"\x0426\x0438\x043A\x043B", L"Do",                            // Цикл / Do
        L"\x041A\x043E\x043D\x0435\x0446\x0426\x0438\x043A\x043B\x0430", L"EndDo",  // КонецЦикла / EndDo
        L"\x041F\x043E\x043A\x0430", L"While",                         // Пока / While
        L"\x041F\x0440\x043E\x0446\x0435\x0434\x0443\x0440\x0430", L"Procedure",  // Процедура / Procedure
        L"\x041A\x043E\x043D\x0435\x0446\x041F\x0440\x043E\x0446\x0435\x0434\x0443\x0440\x044B", L"EndProcedure",  // КонецПроцедуры
        L"\x0424\x0443\x043D\x043A\x0446\x0438\x044F", L"Function",    // Функция / Function
        L"\x041A\x043E\x043D\x0435\x0446\x0424\x0443\x043D\x043A\x0446\x0438\x0438", L"EndFunction",  // КонецФункции
        L"\x0412\x043E\x0437\x0432\x0440\x0430\x0442", L"Return",      // Возврат / Return
        L"\x041F\x0440\x043E\x0434\x043E\x043B\x0436\x0438\x0442\x044C", L"Continue",  // Продолжить / Continue
        L"\x041F\x0440\x0435\x0440\x0432\x0430\x0442\x044C", L"Break", // Прервать / Break
        L"\x041F\x043E\x043F\x044B\x0442\x043A\x0430", L"Try",        // Попытка / Try
        L"\x0418\x0441\x043A\x043B\x044E\x0447\x0435\x043D\x0438\x0435", L"Except",  // Исключение / Except
        L"\x041A\x043E\x043D\x0435\x0446\x041F\x043E\x043F\x044B\x0442\x043A\x0438", L"EndTry",  // КонецПопытки
        L"\x0412\x044B\x0437\x0432\x0430\x0442\x044C\x0418\x0441\x043A\x043B\x044E\x0447\x0435\x043D\x0438\x0435", L"Raise",  // ВызватьИсключение
        L"\x041F\x0435\x0440\x0435\x043C", L"Var",                     // Перем / Var
        L"\x0417\x043D\x0430\x0447", L"Val",                           // Знач / Val
        L"\x042D\x043A\x0441\x043F\x043E\x0440\x0442", L"Export",      // Экспорт / Export
        L"\x041F\x0435\x0440\x0435\x0439\x0442\x0438", L"Goto",        // Перейти / Goto
        L"\x041D\x043E\x0432\x044B\x0439", L"New",                     // Новый / New
        L"\x0412\x044B\x043F\x043E\x043B\x043D\x0438\x0442\x044C", L"Execute",  // Выполнить / Execute
        L"\x0418", L"And",                                               // И / And
        L"\x0418\x041B\x0418", L"Or",                                   // ИЛИ / Or -- note: Или
        L"\x041D\x0435", L"Not",                                        // Не / Not
        L"\x0418\x043B\x0438",                                          // Или (lowercase и)
        NULL
    };
    for (int i = 0; kw[i]; i++) g_keywords.Add(kw[i]);

    // Built-in constants
    const wchar_t* consts[] = {
        L"\x0418\x0441\x0442\x0438\x043D\x0430", L"True",              // Истина / True
        L"\x041B\x043E\x0436\x044C", L"False",                          // Ложь / False
        L"\x041D\x0435\x043E\x043F\x0440\x0435\x0434\x0435\x043B\x0435\x043D\x043E", L"Undefined",  // Неопределено
        L"NULL",
        NULL
    };
    for (int i = 0; consts[i]; i++) g_constants.Add(consts[i]);

    // Built-in functions (most common subset)
    const wchar_t* funcs[] = {
        // String functions
        L"\x0421\x0442\x0440\x0414\x043B\x0438\x043D\x0430", L"StrLen",
        L"\x0421\x043E\x043A\x0440\x041B", L"TrimL",
        L"\x0421\x043E\x043A\x0440\x041F", L"TrimR",
        L"\x0421\x043E\x043A\x0440\x041B\x041F", L"TrimAll",
        L"\x041B\x0435\x0432", L"Left",
        L"\x041F\x0440\x0430\x0432", L"Right",
        L"\x0421\x0440\x0435\x0434", L"Mid",
        L"\x0421\x0442\x0440\x041D\x0430\x0439\x0442\x0438", L"StrFind",
        // old: Найти / Find
        L"\x041D\x0430\x0439\x0442\x0438", L"Find",
        L"\x0412\x0420\x0435\x0433", L"Upper",
        L"\x041D\x0420\x0435\x0433", L"Lower",
        L"\x0422\x0420\x0435\x0433", L"Title",
        L"\x0421\x0438\x043C\x0432\x043E\x043B", L"Char",
        L"\x041A\x043E\x0434\x0421\x0438\x043C\x0432\x043E\x043B\x0430", L"CharCode",
        L"\x041F\x0443\x0441\x0442\x0430\x044F\x0421\x0442\x0440\x043E\x043A\x0430", L"IsBlankString",
        L"\x0421\x0442\x0440\x0417\x0430\x043C\x0435\x043D\x0438\x0442\x044C", L"StrReplace",
        L"\x0421\x0442\x0440\x0427\x0438\x0441\x043B\x043E\x0412\x0445\x043E\x0436\x0434\x0435\x043D\x0438\x0439", L"StrOccurrenceCount",
        L"\x0421\x0442\x0440\x0427\x0438\x0441\x043B\x043E\x0421\x0442\x0440\x043E\x043A", L"StrLineCount",
        L"\x0421\x0442\x0440\x041F\x043E\x043B\x0443\x0447\x0438\x0442\x044C\x0421\x0442\x0440\x043E\x043A\x0443", L"StrGetLine",
        L"\x0421\x0442\x0440\x041D\x0430\x0447\x0438\x043D\x0430\x0435\x0442\x0441\x044F\x0421", L"StrStartsWith",
        L"\x0421\x0442\x0440\x0417\x0430\x043A\x0430\x043D\x0447\x0438\x0432\x0430\x0435\x0442\x0441\x044F\x041D\x0430", L"StrEndsWith",
        L"\x0421\x0442\x0440\x0420\x0430\x0437\x0434\x0435\x043B\x0438\x0442\x044C", L"StrSplit",
        L"\x0421\x0442\x0440\x0421\x043E\x0435\x0434\x0438\x043D\x0438\x0442\x044C", L"StrConcat",
        L"\x0421\x0442\x0440\x0421\x0440\x0430\x0432\x043D\x0438\x0442\x044C", L"StrCompare",
        // Type conversion
        L"\x0427\x0438\x0441\x043B\x043E", L"Number",
        L"\x0421\x0442\x0440\x043E\x043A\x0430", L"String",
        L"\x0414\x0430\x0442\x0430", L"Date",
        L"\x0411\x0443\x043B\x0435\x0432\x043E", L"Boolean",
        L"\x0422\x0438\x043F", L"Type",
        L"\x0422\x0438\x043F\x0417\x043D\x0447", L"TypeOf",
        // Math
        L"\x041C\x0430\x043A\x0441", L"Max",
        L"\x041C\x0438\x043D", L"Min",
        L"\x041E\x043A\x0440", L"Round",
        L"\x0426\x0435\x043B", L"Int",
        L"\x041B\x043E\x0433", L"Log",
        L"\x041B\x043E\x0433" L"10", L"Log10",
        L"\x0421\x0438\x043D", L"Sin",
        L"\x041A\x043E\x0441", L"Cos",
        L"\x0422\x0430\x043D", L"Tan",
        L"\x0421\x0442\x0435\x043F\x0435\x043D\x044C", L"Pow",
        L"\x0421\x043A\x0432\x0430\x0434\x0440\x0430\x0442", L"Sqrt",
        // Date functions
        L"\x0413\x043E\x0434", L"Year",
        L"\x041C\x0435\x0441\x044F\x0446", L"Month",
        L"\x0414\x0435\x043D\x044C", L"Day",
        L"\x0427\x0430\x0441", L"Hour",
        L"\x041C\x0438\x043D\x0443\x0442\x0430", L"Minute",
        L"\x0421\x0435\x043A\x0443\x043D\x0434\x0430", L"Second",
        L"\x041D\x0430\x0447\x0430\x043B\x043E\x0413\x043E\x0434\x0430", L"BegOfYear",
        L"\x041D\x0430\x0447\x0430\x043B\x043E\x041C\x0435\x0441\x044F\x0446\x0430", L"BegOfMonth",
        L"\x041D\x0430\x0447\x0430\x043B\x043E\x0414\x043D\x044F", L"BegOfDay",
        L"\x041A\x043E\x043D\x0435\x0446\x0413\x043E\x0434\x0430", L"EndOfYear",
        L"\x041A\x043E\x043D\x0435\x0446\x041C\x0435\x0441\x044F\x0446\x0430", L"EndOfMonth",
        L"\x041A\x043E\x043D\x0435\x0446\x0414\x043D\x044F", L"EndOfDay",
        L"\x0422\x0435\x043A\x0443\x0449\x0430\x044F\x0414\x0430\x0442\x0430", L"CurrentDate",
        L"\x0414\x043E\x0431\x0430\x0432\x0438\x0442\x044C\x041C\x0435\x0441\x044F\x0446", L"AddMonth",
        // General
        L"\x0421\x043E\x043E\x0431\x0449\x0438\x0442\x044C", L"Message",
        L"\x041F\x0440\x0435\x0434\x0443\x043F\x0440\x0435\x0436\x0434\x0435\x043D\x0438\x0435", L"DoMessageBox",
        L"\x0412\x043E\x043F\x0440\x043E\x0441", L"DoQueryBox",
        L"\x041E\x043F\x0438\x0441\x0430\x043D\x0438\x0435\x041E\x0448\x0438\x0431\x043A\x0438", L"ErrorDescription",
        L"\x0418\x043D\x0444\x043E\x0440\x043C\x0430\x0446\x0438\x044F\x041E\x0431\x041E\x0448\x0438\x0431\x043A\x0435", L"ErrorInfo",
        L"\x041E\x043F\x0438\x0441\x0430\x043D\x0438\x0435\x0422\x0438\x043F\x0430", L"TypeDescription",
        L"\x041F\x043E\x0434\x0440\x043E\x0431\x043D\x043E\x0435\x041F\x0440\x0435\x0434\x0441\x0442\x0430\x0432\x043B\x0435\x043D\x0438\x0435\x041E\x0448\x0438\x0431\x043A\x0438", L"DetailErrorDescription",
        L"\x041A\x0440\x0430\x0442\x043A\x043E\x0435\x041F\x0440\x0435\x0434\x0441\x0442\x0430\x0432\x043B\x0435\x043D\x0438\x0435\x041E\x0448\x0438\x0431\x043A\x0438", L"BriefErrorDescription",
        L"\x0424\x043E\x0440\x043C\x0430\x0442", L"Format",
        L"\x041D\x0421\x0442\x0440", L"NStr",
        L"\x0417\x043D\x0430\x0447\x0435\x043D\x0438\x0435\x0417\x0430\x043F\x043E\x043B\x043D\x0435\x043D\x043E", L"ValueIsFilled",
        L"\x0417\x043D\x0430\x0447\x0435\x043D\x0438\x0435\x0412\x0421\x0442\x0440\x043E\x043A\x0443\x0412\x043D\x0443\x0442\x0440", L"XMLString",
        L"\x0417\x043D\x0430\x0447\x0435\x043D\x0438\x0435\x0418\x0437\x0421\x0442\x0440\x043E\x043A\x0438\x0412\x043D\x0443\x0442\x0440", L"XMLValue",
        L"\x041C\x0430\x0441\x0441\x0438\x0432", L"Array",
        L"\x0421\x0442\x0440\x0443\x043A\x0442\x0443\x0440\x0430", L"Structure",
        L"\x0421\x043E\x043E\x0442\x0432\x0435\x0442\x0441\x0442\x0432\x0438\x0435", L"Map",
        L"\x0417\x0430\x043F\x0440\x043E\x0441", L"Query",
        L"\x0422\x0430\x0431\x043B\x0438\x0446\x0430\x0417\x043D\x0430\x0447\x0435\x043D\x0438\x0439", L"ValueTable",
        L"\x0421\x043F\x0438\x0441\x043E\x043A\x0417\x043D\x0430\x0447\x0435\x043D\x0438\x0439", L"ValueList",
        L"\x0414\x0435\x0440\x0435\x0432\x043E\x0417\x043D\x0430\x0447\x0435\x043D\x0438\x0439", L"ValueTree",
        L"\x041E\x0431\x0449\x0438\x0439\x041C\x043E\x0434\x0443\x043B\x044C", L"CommonModule",
        L"\x0417\x0430\x043F\x0438\x0441\x044C\x0416\x0443\x0440\x043D\x0430\x043B\x0430\x0420\x0435\x0433\x0438\x0441\x0442\x0440\x0430\x0446\x0438\x0438", L"WriteLogEvent",
        NULL
    };
    for (int i = 0; funcs[i]; i++) g_builtinFunctions.Add(funcs[i]);

    // Type names
    const wchar_t* types[] = {
        L"\x041C\x0430\x0441\x0441\x0438\x0432", L"Array",
        L"\x0421\x0442\x0440\x0443\x043A\x0442\x0443\x0440\x0430", L"Structure",
        L"\x0421\x043E\x043E\x0442\x0432\x0435\x0442\x0441\x0442\x0432\x0438\x0435", L"Map",
        L"\x0422\x0430\x0431\x043B\x0438\x0446\x0430\x0417\x043D\x0430\x0447\x0435\x043D\x0438\x0439", L"ValueTable",
        NULL
    };
    for (int i = 0; types[i]; i++) g_types.Add(types[i]);
}

// --- Token types ---
enum BSLTokenType {
    TOK_NORMAL,
    TOK_COMMENT,
    TOK_STRING,
    TOK_NUMBER,
    TOK_DATE,
    TOK_KEYWORD,
    TOK_BUILTIN,
    TOK_CONSTANT,
    TOK_PREPROCESSOR,
    TOK_ANNOTATION,
    TOK_OPERATOR
};

static const char* TokenClass(BSLTokenType t)
{
    switch (t) {
    case TOK_COMMENT:      return "cm";
    case TOK_STRING:       return "st";
    case TOK_NUMBER:       return "nm";
    case TOK_DATE:         return "dt";
    case TOK_KEYWORD:      return "kw";
    case TOK_BUILTIN:      return "bf";
    case TOK_CONSTANT:     return "cn";
    case TOK_PREPROCESSOR: return "pp";
    case TOK_ANNOTATION:   return "an";
    case TOK_OPERATOR:     return "op";
    default:               return NULL;
    }
}

// --- Lexer ---

struct BSLToken {
    BSLTokenType type;
    size_t start;
    size_t end;
    BSLToken(BSLTokenType t, size_t s, size_t e) : type(t), start(s), end(e) {}
};

static std::vector<BSLToken> Tokenize(const wchar_t* src, size_t len)
{
    std::vector<BSLToken> tokens;
    size_t i = 0;

    while (i < len) {
        // Skip whitespace (not tokenized)
        if (src[i] == L' ' || src[i] == L'\t' || src[i] == L'\r' || src[i] == L'\n') {
            i++;
            continue;
        }

        // Line comment: //
        if (i + 1 < len && src[i] == L'/' && src[i + 1] == L'/') {
            size_t start = i;
            while (i < len && src[i] != L'\n') i++;
            tokens.push_back(BSLToken(TOK_COMMENT, start, i));
            continue;
        }

        // String: "..."
        if (src[i] == L'"') {
            size_t start = i;
            i++;
            while (i < len) {
                if (src[i] == L'"') {
                    i++;
                    // "" is an escape inside string
                    if (i < len && src[i] == L'"') { i++; continue; }
                    break;
                }
                if (src[i] == L'\n') {
                    // Multi-line string: next line should start with |
                    i++;
                    // Skip whitespace at start of next line
                    while (i < len && (src[i] == L' ' || src[i] == L'\t')) i++;
                    if (i < len && src[i] == L'|') { i++; continue; }
                    // If no |, the string is broken, but we still include it
                    continue;
                }
                i++;
            }
            tokens.push_back(BSLToken(TOK_STRING, start, i));
            continue;
        }

        // Date literal: 'YYYYMMDD...'
        if (src[i] == L'\'') {
            size_t start = i;
            i++;
            while (i < len && src[i] != L'\'' && src[i] != L'\n') i++;
            if (i < len && src[i] == L'\'') i++;
            tokens.push_back(BSLToken(TOK_DATE, start, i));
            continue;
        }

        // Preprocessor: #...
        if (src[i] == L'#') {
            size_t start = i;
            i++;
            while (i < len && IsWordChar(src[i])) i++;
            tokens.push_back(BSLToken(TOK_PREPROCESSOR, start, i));
            continue;
        }

        // Annotation: &...
        if (src[i] == L'&') {
            size_t start = i;
            i++;
            while (i < len && IsWordChar(src[i])) i++;
            tokens.push_back(BSLToken(TOK_ANNOTATION, start, i));
            continue;
        }

        // Number
        if (src[i] >= L'0' && src[i] <= L'9') {
            size_t start = i;
            while (i < len && ((src[i] >= L'0' && src[i] <= L'9') || src[i] == L'.')) i++;
            tokens.push_back(BSLToken(TOK_NUMBER, start, i));
            continue;
        }

        // Operators
        if (src[i] == L'+' || src[i] == L'-' || src[i] == L'*' || src[i] == L'/' ||
            src[i] == L'%' || src[i] == L'=' || src[i] == L'<' || src[i] == L'>' ||
            src[i] == L'(' || src[i] == L')' || src[i] == L'[' || src[i] == L']' ||
            src[i] == L'.' || src[i] == L',' || src[i] == L';' || src[i] == L'?') {
            size_t start = i;
            // Handle <>  <=  >=
            if ((src[i] == L'<' || src[i] == L'>') && i + 1 < len &&
                (src[i + 1] == L'=' || src[i + 1] == L'>'))
                i++;
            i++;
            tokens.push_back(BSLToken(TOK_OPERATOR, start, i));
            continue;
        }

        // Tilde (label marker)
        if (src[i] == L'~') {
            size_t start = i;
            i++;
            while (i < len && IsWordChar(src[i])) i++;
            tokens.push_back(BSLToken(TOK_NORMAL, start, i));
            continue;
        }

        // Word (identifier / keyword / builtin)
        if (IsWordChar(src[i])) {
            size_t start = i;
            while (i < len && IsWordChar(src[i])) i++;
            std::wstring lower = ToLower(src + start, i - start);

            BSLTokenType type = TOK_NORMAL;
            if (g_keywords.Contains(lower))
                type = TOK_KEYWORD;
            else if (g_constants.Contains(lower))
                type = TOK_CONSTANT;
            else if (g_builtinFunctions.Contains(lower))
                type = TOK_BUILTIN;

            tokens.push_back(BSLToken(type, start, i));
            continue;
        }

        // Anything else - just advance
        i++;
    }

    return tokens;
}

// --- CSS themes ---

static const char* CSS_LIGHT = R"(
body { margin:0; padding:0; background:#ffffff; direction:ltr; text-align:left; }
.code-container { padding:8px 0; }
pre.code { margin:0; padding:0; font-family:%FONT%; font-size:%SIZE%px; line-height:0.5; color:#333; }
pre.code .line { display:block; white-space:pre; padding:0 8px 0 0; }
pre.code .ln { display:inline-block; width:40px; text-align:right; color:#999; border-right:1px solid #e0e0e0; padding-right:6px; margin-right:10px; -ms-user-select:none; user-select:none; }
.toolbar { position:fixed; top:0; left:0; right:0; z-index:100; background:#f3f3f3; border-bottom:1px solid #ccc; padding:3px 8px; font-family:Segoe UI,Tahoma,sans-serif; font-size:12px; display:flex; align-items:center; gap:8px; }
.toolbar select { font-size:12px; max-width:50%; padding:2px 4px; }
.toolbar input { font-size:12px; width:60px; padding:2px 4px; }
.toolbar button { font-size:11px; padding:2px 8px; cursor:pointer; }
.toolbar .sep { color:#ccc; }
.code-container { padding-top:28px; }
.highlight-line { background:#fff3cd !important; }
.cm { color:#6a9955; font-style:italic; }
.st { color:#a31515; }
.nm { color:#098658; }
.dt { color:#098658; font-weight:bold; }
.kw { color:#0000ff; font-weight:bold; }
.bf { color:#795e26; }
.cn { color:#0070c1; font-weight:bold; }
.pp { color:#8b008b; font-weight:bold; }
.an { color:#808000; }
.op { color:#333; }
)";

static const char* CSS_DARK = R"(
body { margin:0; padding:0; background:#1e1e1e; direction:ltr; text-align:left; }
.code-container { padding:8px 0; }
pre.code { margin:0; padding:0; font-family:%FONT%; font-size:%SIZE%px; line-height:0.5; color:#d4d4d4; }
pre.code .line { display:block; white-space:pre; padding:0 8px 0 0; }
pre.code .ln { display:inline-block; width:40px; text-align:right; color:#858585; border-right:1px solid #404040; padding-right:6px; margin-right:10px; -ms-user-select:none; user-select:none; }
.toolbar { position:fixed; top:0; left:0; right:0; z-index:100; background:#2d2d2d; border-bottom:1px solid #555; padding:3px 8px; font-family:Segoe UI,Tahoma,sans-serif; font-size:12px; display:flex; align-items:center; gap:8px; color:#ccc; }
.toolbar select { font-size:12px; max-width:50%; padding:2px 4px; background:#3c3c3c; color:#ccc; border:1px solid #555; }
.toolbar input { font-size:12px; width:60px; padding:2px 4px; background:#3c3c3c; color:#ccc; border:1px solid #555; }
.toolbar button { font-size:11px; padding:2px 8px; cursor:pointer; background:#0e639c; color:#fff; border:1px solid #1177bb; }
.toolbar .sep { color:#555; }
.code-container { padding-top:28px; }
.highlight-line { background:#264f78 !important; }
.cm { color:#6a9955; font-style:italic; }
.st { color:#ce9178; }
.nm { color:#b5cea8; }
.dt { color:#b5cea8; font-weight:bold; }
.kw { color:#569cd6; font-weight:bold; }
.bf { color:#dcdcaa; }
.cn { color:#4fc1ff; font-weight:bold; }
.pp { color:#c586c0; font-weight:bold; }
.an { color:#d7ba7d; }
.op { color:#d4d4d4; }
)";

// --- Procedure/Function parser ---

struct ProcInfo {
    int line;            // 1-based line number
    bool isFunction;     // true = Function, false = Procedure
    std::string name;    // UTF-8 name
    ProcInfo(int l, bool f, const std::string& n) : line(l), isFunction(f), name(n) {}
};

static std::vector<ProcInfo> FindProcedures(const wchar_t* source, size_t length,
                                             const std::vector<size_t>& lineStarts)
{
    std::vector<ProcInfo> procs;

    for (size_t line = 0; line + 1 < lineStarts.size(); line++) {
        size_t ls = lineStarts[line];
        size_t le = lineStarts[line + 1];
        while (le > ls && (source[le - 1] == L'\r' || source[le - 1] == L'\n')) le--;

        // Skip leading whitespace
        size_t p = ls;
        while (p < le && (source[p] == L' ' || source[p] == L'\t')) p++;
        if (p >= le) continue;

        // Check for Процедура/Procedure/Функция/Function
        size_t wordStart = p;
        while (p < le && IsWordChar(source[p])) p++;
        size_t wordLen = p - wordStart;
        if (wordLen == 0) continue;

        std::wstring kw = ToLower(source + wordStart, wordLen);
        bool isFunc = false;
        bool isProc = false;

        // Процедура
        if (kw == L"\x043f\x0440\x043e\x0446\x0435\x0434\x0443\x0440\x0430" || kw == L"procedure")
            isProc = true;
        // Функция
        else if (kw == L"\x0444\x0443\x043d\x043a\x0446\x0438\x044f" || kw == L"function")
            isFunc = true;

        if (!isProc && !isFunc) continue;

        // Skip whitespace after keyword
        while (p < le && (source[p] == L' ' || source[p] == L'\t')) p++;

        // Read procedure/function name
        size_t nameStart = p;
        while (p < le && IsWordChar(source[p])) p++;
        if (p == nameStart) continue;

        std::string name = WideToUTF8(source + nameStart, p - nameStart);
        procs.push_back(ProcInfo((int)(line + 1), isFunc, name));
    }

    return procs;
}

// --- HTML generation ---

static std::string ReplaceAll(std::string str, const std::string& from, const std::string& to)
{
    size_t pos = 0;
    while ((pos = str.find(from, pos)) != std::string::npos) {
        str.replace(pos, from.length(), to);
        pos += to.length();
    }
    return str;
}

static std::string GenerateHTML(const wchar_t* source, size_t length,
                                const std::vector<BSLToken>& tokens,
                                const BSLHighlightOptions& opts)
{
    std::string css = opts.darkMode ? CSS_DARK : CSS_LIGHT;
    css = ReplaceAll(css, "%FONT%", opts.fontFamily ? opts.fontFamily : "Consolas, Courier New, monospace");
    css = ReplaceAll(css, "%SIZE%", std::to_string(opts.fontSize > 0 ? opts.fontSize : 14));

    std::string html;
    html.reserve(length * 3);
    html += "<html>\n<head>\n<meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\">\n";
    html += "<meta charset=\"utf-8\">\n<style>\n";
    html += css;
    html += "\n</style>\n</head>\n<body>\n";

    size_t tokenIdx = 0;

    // Build line starts
    std::vector<size_t> lineStarts;
    lineStarts.push_back(0);
    for (size_t i = 0; i < length; i++) {
        if (source[i] == L'\n') {
            lineStarts.push_back(i + 1);
        }
    }
    lineStarts.push_back(length); // sentinel

    // Find procedures/functions
    auto procs = FindProcedures(source, length, lineStarts);

    // --- Toolbar ---
    html += "<div class=\"toolbar\">";
    html += "<select id=\"procList\" onchange=\"goToProc(this.value)\">";
    if (procs.empty()) {
        html += "<option value=\"\">\xD0\x9D\xD0\xB5\xD1\x82 \xD0\xBF\xD1\x80\xD0\xBE\xD1\x86\xD0\xB5\xD0\xB4\xD1\x83\xD1\x80</option>";  // "Нет процедур"
    } else {
        html += "<option value=\"\">\xD0\x9F\xD1\x80\xD0\xBE\xD1\x86\xD0\xB5\xD0\xB4\xD1\x83\xD1\x80\xD1\x8B \xD0\xB8 \xD1\x84\xD1\x83\xD0\xBD\xD0\xBA\xD1\x86\xD0\xB8\xD0\xB8 (";  // "Процедуры и функции ("
        html += std::to_string(procs.size());
        html += ")</option>";
        for (size_t i = 0; i < procs.size(); i++) {
            html += "<option value=\"L";
            html += std::to_string(procs[i].line);
            html += "\">";
            html += procs[i].isFunction ? "\xD0\xA4\xD1\x83\xD0\xBD\xD0\xBA\xD1\x86\xD0\xB8\xD1\x8F " : "\xD0\x9F\xD1\x80\xD0\xBE\xD1\x86\xD0\xB5\xD0\xB4\xD1\x83\xD1\x80\xD0\xB0 ";  // "Функция " / "Процедура "
            html += procs[i].name;
            html += " : ";
            html += std::to_string(procs[i].line);
            html += "</option>";
        }
    }
    html += "</select>";
    html += "<span class=\"sep\">|</span>";
    html += "<input id=\"lineNum\" type=\"text\" placeholder=\"\xD0\xA1\xD1\x82\xD1\x80\xD0\xBE\xD0\xBA\xD0\xB0...\" onkeydown=\"if(event.keyCode==13)goToLine()\">";  // "Строка..."
    html += "<button onclick=\"goToLine()\">\xE2\x86\x92</button>";  // →
    html += "</div>\n";

    // --- Code ---
    html += "<div class=\"code-container\">\n<pre class=\"code\">";

    // Calculate line number width
    int totalLines = (int)(lineStarts.size() - 1);
    int lnWidth = 1;
    { int tmp = totalLines; while (tmp >= 10) { lnWidth++; tmp /= 10; } }

    for (size_t line = 0; line + 1 < lineStarts.size(); line++) {
        size_t ls = lineStarts[line];
        size_t le = lineStarts[line + 1];
        // Remove trailing \r\n
        while (le > ls && (source[le - 1] == L'\r' || source[le - 1] == L'\n')) le--;

        html += "<span class=\"line\" id=\"L";
        html += std::to_string(line + 1);
        html += "\">";

        if (opts.lineNumbers) {
            html += "<span class=\"ln\">";
            std::string num = std::to_string(line + 1);
            // Right-pad with spaces for alignment
            for (int p = (int)num.size(); p < lnWidth; p++) html += ' ';
            html += num;
            html += "</span>";
        }

        // Emit this line's content with syntax highlighting
        size_t pos = ls;
        while (pos < le) {
            // Find next token that overlaps with [pos, le)
            while (tokenIdx < tokens.size() && tokens[tokenIdx].end <= pos) tokenIdx++;

            if (tokenIdx < tokens.size() && tokens[tokenIdx].start <= pos) {
                // We're inside a token
                const BSLToken& tok = tokens[tokenIdx];
                size_t tokEnd = (tok.end < le) ? tok.end : le;

                const char* cls = TokenClass(tok.type);
                if (cls) {
                    html += "<span class=\"";
                    html += cls;
                    html += "\">";
                }

                for (size_t j = pos; j < tokEnd; j++) {
                    if (source[j] == L'\t') {
                        for (int t = 0; t < opts.tabSize; t++) html += ' ';
                    } else if (source[j] == L'\r') {
                        // skip
                    } else {
                        html += HtmlEscape(&source[j], 1);
                    }
                }

                if (cls) html += "</span>";
                pos = tokEnd;
            } else {
                // Normal text before next token
                size_t nextTokStart = le;
                if (tokenIdx < tokens.size() && tokens[tokenIdx].start < le)
                    nextTokStart = tokens[tokenIdx].start;

                for (size_t j = pos; j < nextTokStart; j++) {
                    if (source[j] == L'\t') {
                        for (int t = 0; t < opts.tabSize; t++) html += ' ';
                    } else if (source[j] == L'\r') {
                        // skip
                    } else {
                        html += HtmlEscape(&source[j], 1);
                    }
                }
                pos = nextTokStart;
            }
        }

        html += "</span>\n";
    }

    html += "</pre>\n</div>\n";

    // JavaScript for navigation
    html += "<script>\n";
    html += "var _prev=null;\n";
    html += "function goToProc(id){\n";
    html += "  if(!id)return;\n";
    html += "  var el=document.getElementById(id);\n";
    html += "  if(el){if(_prev)_prev.className='line';el.className='line highlight-line';_prev=el;el.scrollIntoView();}\n";
    html += "}\n";
    html += "function goToLine(){\n";
    html += "  var n=document.getElementById('lineNum').value;\n";
    html += "  if(!n)return;\n";
    html += "  var el=document.getElementById('L'+n);\n";
    html += "  if(el){if(_prev)_prev.className='line';el.className='line highlight-line';_prev=el;el.scrollIntoView();}\n";
    html += "  else{alert('\\u0421\\u0442\\u0440\\u043e\\u043a\\u0430 '+n+' \\u043d\\u0435 \\u043d\\u0430\\u0439\\u0434\\u0435\\u043d\\u0430');}\n";  // "Строка N не найдена"
    html += "}\n";
    html += "</script>\n";

    html += "</body>\n</html>";
    return html;
}

// --- Public API ---

std::string HighlightBSL(const wchar_t* source, size_t length, const BSLHighlightOptions& options)
{
    InitKeywords();
    auto tokens = Tokenize(source, length);
    return GenerateHTML(source, length, tokens, options);
}

std::string HighlightSDBL(const wchar_t* source, size_t length, const BSLHighlightOptions& options)
{
    // For now, reuse BSL highlighter for SDBL
    // TODO: add SDBL-specific keywords (ВЫБРАТЬ/SELECT, ИЗ/FROM, etc.)
    InitKeywords();
    auto tokens = Tokenize(source, length);
    return GenerateHTML(source, length, tokens, options);
}
