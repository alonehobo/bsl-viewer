#ifndef BSLHIGHLIGHT_H
#define BSLHIGHLIGHT_H

#include <string>

struct BSLHighlightOptions {
    bool darkMode;
    bool lineNumbers;
    const char* fontFamily;
    int fontSize;
    int tabSize;
};

// Convert BSL/OS source code to syntax-highlighted HTML
std::string HighlightBSL(const wchar_t* source, size_t length, const BSLHighlightOptions& options);

// Convert SDBL query to syntax-highlighted HTML
std::string HighlightSDBL(const wchar_t* source, size_t length, const BSLHighlightOptions& options);

#endif // BSLHIGHLIGHT_H
