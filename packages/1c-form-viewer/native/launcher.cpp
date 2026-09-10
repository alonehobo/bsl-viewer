#include <windows.h>

#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace {

std::wstring quote_argument(const std::wstring& value) {
    if (value.find_first_of(L" \t\"") == std::wstring::npos) return value;

    std::wstring result = L"\"";
    std::size_t slashes = 0;
    for (wchar_t character : value) {
        if (character == L'\\') {
            ++slashes;
            continue;
        }
        if (character == L'\"') {
            result.append(slashes * 2 + 1, L'\\');
            result += L'\"';
            slashes = 0;
            continue;
        }
        result.append(slashes, L'\\');
        slashes = 0;
        result += character;
    }
    result.append(slashes * 2, L'\\');
    result += L'\"';
    return result;
}

std::filesystem::path executable_directory() {
    std::vector<wchar_t> buffer(MAX_PATH);
    for (;;) {
        const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (!length) return {};
        if (length < buffer.size() - 1) return std::filesystem::path(std::wstring(buffer.data(), length)).parent_path();
        buffer.resize(buffer.size() * 2);
    }
}

std::filesystem::path locate_node(const std::filesystem::path& base) {
    const auto bundled = base / L"runtime" / L"node.exe";
    if (std::filesystem::is_regular_file(bundled)) return bundled;
    const auto legacy = base / L"node.exe";
    if (std::filesystem::is_regular_file(legacy)) return legacy;

    std::vector<wchar_t> buffer(MAX_PATH);
    for (;;) {
        const DWORD length = SearchPathW(nullptr, L"node.exe", nullptr, static_cast<DWORD>(buffer.size()), buffer.data(), nullptr);
        if (!length) return {};
        if (length < buffer.size()) return std::filesystem::path(std::wstring(buffer.data(), length));
        buffer.resize(length + 1);
    }
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    const auto base = executable_directory();
    const auto node = locate_node(base);
    const auto app = base / L"app";
    const auto cli = app / L"dist" / L"cli.js";
    if (base.empty() || node.empty() || !std::filesystem::is_regular_file(cli)) {
        std::wcerr << L"1c-form-viewer: Node.js is not installed. Run install.ps1 next to the launcher.\n";
        return 2;
    }

    SetCurrentDirectoryW(app.c_str());
    std::wstring command = quote_argument(node.wstring()) + L" " + quote_argument(cli.wstring());
    for (int index = 1; index < argc; ++index) command += L" " + quote_argument(argv[index]);
    std::vector<wchar_t> command_line(command.begin(), command.end());
    command_line.push_back(L'\0');

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(
        nullptr,
        command_line.data(),
        nullptr,
        nullptr,
        TRUE,
        CREATE_UNICODE_ENVIRONMENT,
        nullptr,
        app.c_str(),
        &startup,
        &process)) {
        std::wcerr << L"1c-form-viewer: could not start the bundled Node runtime (" << GetLastError() << L").\n";
        return 3;
    }

    CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hProcess);
    return static_cast<int>(exit_code);
}
