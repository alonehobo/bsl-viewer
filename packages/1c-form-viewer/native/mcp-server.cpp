#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <map>
#include <mutex>
#include <optional>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>

/* This build's identity, in one place. The Node server takes its version from
 * package.json; this one cannot, so keep the two constants below the only
 * copies and bump them together with a release. */
#ifndef ONE_C_FORM_VIEWER_VERSION
#define ONE_C_FORM_VIEWER_VERSION "0.2.0"
#endif
#define ONE_C_FORM_VIEWER_VERSION_W L"" ONE_C_FORM_VIEWER_VERSION
#define ONE_C_FORM_VIEWER_NAME "1c-form-viewer-native"

#include <vector>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")

namespace fs = std::filesystem;

namespace {

std::string utf8_from_wide(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}

std::wstring wide_from_utf8(std::string_view value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (!size) return {};
    std::wstring result(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}

std::string json_escape(std::string_view value) {
    std::string result;
    result.reserve(value.size() + 16);
    for (unsigned char character : value) {
        switch (character) {
        case '"': result += "\\\""; break;
        case '\\': result += "\\\\"; break;
        case '\b': result += "\\b"; break;
        case '\f': result += "\\f"; break;
        case '\n': result += "\\n"; break;
        case '\r': result += "\\r"; break;
        case '\t': result += "\\t"; break;
        default:
            if (character < 0x20) {
                std::ostringstream escaped;
                escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(character);
                result += escaped.str();
            } else {
                result += static_cast<char>(character);
            }
        }
    }
    return result;
}

std::string json_string(std::string_view value) {
    return "\"" + json_escape(value) + "\"";
}

struct Json {
    enum class Kind { Null, Bool, Number, String, Object, Array };
    Kind kind = Kind::Null;
    bool boolean = false;
    double number = 0;
    std::string string;
    std::map<std::string, Json> object;
    std::vector<Json> array;

    static Json null() { return {}; }
    static Json booleanValue(bool value) { Json json; json.kind = Kind::Bool; json.boolean = value; return json; }
    static Json numberValue(double value) { Json json; json.kind = Kind::Number; json.number = value; return json; }
    static Json stringValue(std::string value) { Json json; json.kind = Kind::String; json.string = std::move(value); return json; }
    static Json objectValue(std::map<std::string, Json> value) { Json json; json.kind = Kind::Object; json.object = std::move(value); return json; }

    const Json* get(const std::string& key) const {
        if (kind != Kind::Object) return nullptr;
        const auto found = object.find(key);
        return found == object.end() ? nullptr : &found->second;
    }

    std::string asString(const std::string& fallback = {}) const {
        return kind == Kind::String ? string : fallback;
    }

    bool asBool(bool fallback = false) const {
        return kind == Kind::Bool ? boolean : fallback;
    }

    std::string dump() const {
        switch (kind) {
        case Kind::Null: return "null";
        case Kind::Bool: return boolean ? "true" : "false";
        case Kind::Number: {
            std::ostringstream output;
            output << std::setprecision(15) << number;
            return output.str();
        }
        case Kind::String: return json_string(string);
        case Kind::Array: {
            std::string output = "[";
            for (std::size_t i = 0; i < array.size(); ++i) {
                if (i) output += ',';
                output += array[i].dump();
            }
            return output + ']';
        }
        case Kind::Object: {
            std::string output = "{";
            bool first = true;
            for (const auto& [key, value] : object) {
                if (!first) output += ',';
                first = false;
                output += json_string(key) + ':' + value.dump();
            }
            return output + '}';
        }
        }
        return "null";
    }
};

class JsonParser {
public:
    explicit JsonParser(std::string_view input) : input_(input) {}

    Json parse() {
        skipSpace();
        Json result = value();
        skipSpace();
        if (position_ != input_.size()) throw std::runtime_error("Trailing JSON data");
        return result;
    }

private:
    std::string_view input_;
    std::size_t position_ = 0;

    void skipSpace() {
        while (position_ < input_.size() && (input_[position_] == ' ' || input_[position_] == '\t' || input_[position_] == '\r' || input_[position_] == '\n')) ++position_;
    }

    char take() {
        if (position_ >= input_.size()) throw std::runtime_error("Unexpected end of JSON");
        return input_[position_++];
    }

    void expect(char expected) {
        if (take() != expected) throw std::runtime_error("Invalid JSON");
    }

    std::string stringValue() {
        expect('"');
        std::string result;
        while (position_ < input_.size()) {
            const char character = take();
            if (character == '"') return result;
            if (character != '\\') {
                result += character;
                continue;
            }
            const char escape = take();
            switch (escape) {
            case '"': result += '"'; break;
            case '\\': result += '\\'; break;
            case '/': result += '/'; break;
            case 'b': result += '\b'; break;
            case 'f': result += '\f'; break;
            case 'n': result += '\n'; break;
            case 'r': result += '\r'; break;
            case 't': result += '\t'; break;
            case 'u': {
                if (position_ + 4 > input_.size()) throw std::runtime_error("Invalid unicode escape");
                unsigned value = 0;
                for (int i = 0; i < 4; ++i) {
                    const char digit = input_[position_++];
                    value <<= 4;
                    if (digit >= '0' && digit <= '9') value += digit - '0';
                    else if (digit >= 'a' && digit <= 'f') value += digit - 'a' + 10;
                    else if (digit >= 'A' && digit <= 'F') value += digit - 'A' + 10;
                    else throw std::runtime_error("Invalid unicode escape");
                }
                if (value < 0x80) result += static_cast<char>(value);
                else if (value < 0x800) {
                    result += static_cast<char>(0xc0 | (value >> 6));
                    result += static_cast<char>(0x80 | (value & 0x3f));
                } else {
                    result += static_cast<char>(0xe0 | (value >> 12));
                    result += static_cast<char>(0x80 | ((value >> 6) & 0x3f));
                    result += static_cast<char>(0x80 | (value & 0x3f));
                }
                break;
            }
            default: throw std::runtime_error("Invalid JSON escape");
            }
        }
        throw std::runtime_error("Unterminated JSON string");
    }

    Json value() {
        skipSpace();
        if (position_ >= input_.size()) throw std::runtime_error("Missing JSON value");
        switch (input_[position_]) {
        case 'n': if (input_.substr(position_, 4) != "null") throw std::runtime_error("Invalid JSON"); position_ += 4; return Json::null();
        case 't': if (input_.substr(position_, 4) != "true") throw std::runtime_error("Invalid JSON"); position_ += 4; return Json::booleanValue(true);
        case 'f': if (input_.substr(position_, 5) != "false") throw std::runtime_error("Invalid JSON"); position_ += 5; return Json::booleanValue(false);
        case '"': return Json::stringValue(stringValue());
        case '{': return objectValue();
        case '[': return arrayValue();
        default: return numberValue();
        }
    }

    Json objectValue() {
        expect('{');
        std::map<std::string, Json> result;
        skipSpace();
        if (position_ < input_.size() && input_[position_] == '}') { ++position_; return Json::objectValue(std::move(result)); }
        while (true) {
            skipSpace();
            const std::string key = stringValue();
            skipSpace();
            expect(':');
            result.emplace(key, value());
            skipSpace();
            const char separator = take();
            if (separator == '}') break;
            if (separator != ',') throw std::runtime_error("Invalid JSON object");
        }
        return Json::objectValue(std::move(result));
    }

    Json arrayValue() {
        expect('[');
        Json result;
        result.kind = Json::Kind::Array;
        skipSpace();
        if (position_ < input_.size() && input_[position_] == ']') { ++position_; return result; }
        while (true) {
            result.array.push_back(value());
            skipSpace();
            const char separator = take();
            if (separator == ']') break;
            if (separator != ',') throw std::runtime_error("Invalid JSON array");
        }
        return result;
    }

    Json numberValue() {
        const std::size_t start = position_;
        while (position_ < input_.size() && std::string_view("-+0123456789.eE").find(input_[position_]) != std::string_view::npos) ++position_;
        try { return Json::numberValue(std::stod(std::string(input_.substr(start, position_ - start)))); }
        catch (...) { throw std::runtime_error("Invalid JSON number"); }
    }
};

std::string read_text_file(const fs::path& path, std::size_t maxBytes, std::string& encoding) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("File does not exist: " + utf8_from_wide(path.wstring()));
    input.seekg(0, std::ios::end);
    const auto length = input.tellg();
    if (length < 0 || static_cast<std::uintmax_t>(length) > maxBytes) throw std::runtime_error("File is too large: " + utf8_from_wide(path.wstring()));
    input.seekg(0, std::ios::beg);
    std::vector<unsigned char> bytes(static_cast<std::size_t>(length));
    if (!bytes.empty()) input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));

    std::wstring wide;
    if (bytes.size() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf) {
        encoding = "utf8-bom";
        wide = wide_from_utf8(std::string_view(reinterpret_cast<char*>(bytes.data() + 3), bytes.size() - 3));
    } else if (bytes.size() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe) {
        encoding = "utf16le";
        wide.resize((bytes.size() - 2) / 2);
        std::memcpy(wide.data(), bytes.data() + 2, wide.size() * sizeof(wchar_t));
    } else if (bytes.size() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff) {
        encoding = "utf16be";
        wide.resize((bytes.size() - 2) / 2);
        for (std::size_t i = 0; i < wide.size(); ++i) wide[i] = static_cast<wchar_t>((bytes[2 + i * 2] << 8) | bytes[3 + i * 2]);
    } else {
        wide = wide_from_utf8(std::string_view(reinterpret_cast<char*>(bytes.data()), bytes.size()));
        if (!wide.empty() || bytes.empty()) encoding = "utf8";
        else {
            encoding = "windows-1251";
            const int size = MultiByteToWideChar(1251, 0, reinterpret_cast<char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
            wide.resize(size);
            MultiByteToWideChar(1251, 0, reinterpret_cast<char*>(bytes.data()), static_cast<int>(bytes.size()), wide.data(), size);
        }
    }
    return utf8_from_wide(wide);
}

std::wstring lower_wide(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
    return value;
}

std::string mime_type(const fs::path& path) {
    const auto extension = lower_wide(path.extension().wstring());
    if (extension == L".html") return "text/html; charset=utf-8";
    if (extension == L".js") return "text/javascript; charset=utf-8";
    if (extension == L".css") return "text/css; charset=utf-8";
    if (extension == L".json") return "application/json; charset=utf-8";
    if (extension == L".svg") return "image/svg+xml";
    return "application/octet-stream";
}

std::string random_token() {
    std::random_device device;
    std::mt19937_64 generator(device());
    std::ostringstream output;
    output << std::hex;
    for (int i = 0; i < 4; ++i) output << generator();
    return output.str();
}

std::string url_decode(std::string value) {
    std::string result;
    for (std::size_t i = 0; i < value.size(); ++i) {
        if (value[i] == '%' && i + 2 < value.size()) {
            const auto hex = [](char c) -> int { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; if (c >= 'A' && c <= 'F') return c - 'A' + 10; return -1; };
            const int high = hex(value[i + 1]);
            const int low = hex(value[i + 2]);
            if (high >= 0 && low >= 0) { result += static_cast<char>((high << 4) | low); i += 2; continue; }
        }
        result += value[i] == '+' ? ' ' : value[i];
    }
    return result;
}

std::string make_http_response(int status, std::string_view contentType, std::string_view body) {
    const char* reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Internal Server Error";
    std::ostringstream output;
    output << "HTTP/1.1 " << status << ' ' << reason << "\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: " << contentType << "\r\nContent-Length: " << body.size() << "\r\n\r\n";
    output << body;
    return output.str();
}

struct Document {
    fs::path requestedPath;
    fs::path resolvedPath;
    std::string content;
    std::string objectMeta;
    std::string encoding;
    std::uintmax_t size = 0;
};

class PreviewServer {
public:
    explicit PreviewServer(fs::path assets) : assets_(std::move(assets)), token_(random_token()) {}
    ~PreviewServer() { close(); }

    void start() {
        std::lock_guard lock(mutex_);
        if (socket_ != INVALID_SOCKET) return;
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("Could not initialize Winsock");
        socket_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (socket_ == INVALID_SOCKET) throw std::runtime_error("Could not create preview server socket");
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;
        if (::bind(socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR || ::listen(socket_, 8) == SOCKET_ERROR) {
            closesocket(socket_); socket_ = INVALID_SOCKET; WSACleanup(); throw std::runtime_error("Could not bind preview server");
        }
        int length = sizeof(address);
        getsockname(socket_, reinterpret_cast<sockaddr*>(&address), &length);
        port_ = ntohs(address.sin_port);
        accepting_ = true;
        thread_ = std::thread([this] { acceptLoop(); });
    }

    std::string url() const {
        if (!port_) throw std::runtime_error("Preview server is not running");
        return "http://127.0.0.1:" + std::to_string(port_) + "/" + token_ + "/index.html?internal=1";
    }

    void setDocument(Document document) {
        std::lock_guard lock(mutex_);
        document_ = std::move(document);
        ++revision_;
    }

    std::string stateJson() const {
        std::lock_guard lock(mutex_);
        if (!document_) return "{}";
        return "{\"revision\":" + std::to_string(revision_) + ",\"path\":" + json_string(utf8_from_wide(document_->resolvedPath.wstring())) + ",\"content\":" + json_string(document_->content) + ",\"objectMeta\":" + json_string(document_->objectMeta) + "}";
    }

    std::string metaJson() const {
        std::lock_guard lock(mutex_);
        return "{\"revision\":" + std::to_string(revision_) + ",\"available\":" + (document_ ? "true" : "false") + "}";
    }

    std::string command(const std::string& op, const std::string& args) {
        std::unique_lock lock(mutex_);
        if (!document_) throw std::runtime_error("No preview is open. Call open_preview first.");
        if (pending_) throw std::runtime_error("Another browser command is still running.");
        const std::string id = std::to_string(++commandId_);
        pending_ = Pending{id, op, args, false, {}};
        lock.unlock();
        condition_.notify_all();
        lock.lock();
        const bool completed = condition_.wait_for(lock, std::chrono::seconds(30), [this, &id] { return !pending_ || pending_->id != id; });
        if (!completed) { pending_.reset(); throw std::runtime_error("The external browser did not answer the command in time."); }
        if (!lastResult_ || lastResult_->id != id) throw std::runtime_error("The external browser returned no result.");
        auto result = std::move(lastResult_->value);
        lastResult_.reset();
        return result;
    }

    void close() {
        {
            std::lock_guard lock(mutex_);
            accepting_ = false;
            if (socket_ != INVALID_SOCKET) { shutdown(socket_, SD_BOTH); closesocket(socket_); socket_ = INVALID_SOCKET; }
            pending_.reset();
            condition_.notify_all();
        }
        if (thread_.joinable()) thread_.join();
        if (port_) { WSACleanup(); port_ = 0; }
    }

private:
    struct Pending { std::string id; std::string op; std::string args; bool delivered; std::string result; };
    struct Result { std::string id; std::string value; };

    fs::path assets_;
    std::string token_;
    SOCKET socket_ = INVALID_SOCKET;
    unsigned short port_ = 0;
    std::thread thread_;
    mutable std::mutex mutex_;
    std::condition_variable condition_;
    bool accepting_ = false;
    std::uint64_t revision_ = 0;
    std::uint64_t commandId_ = 0;
    std::optional<Document> document_;
    std::optional<Pending> pending_;
    std::optional<Result> lastResult_;

    void acceptLoop() {
        while (true) {
            SOCKET client = accept(socket_, nullptr, nullptr);
            if (client == INVALID_SOCKET) {
                std::lock_guard lock(mutex_);
                if (!accepting_) break;
                continue;
            }
            std::thread([this, client] { handleClient(client); }).detach();
        }
    }

    static bool receiveRequest(SOCKET client, std::string& request) {
        char buffer[8192];
        request.clear();
        std::size_t expected = 0;
        while (request.size() < 4 * 1024 * 1024) {
            const int count = recv(client, buffer, sizeof(buffer), 0);
            if (count <= 0) return false;
            request.append(buffer, count);
            const auto headers = request.find("\r\n\r\n");
            if (headers == std::string::npos) continue;
            if (!expected) {
                const auto marker = request.find("Content-Length:");
                if (marker != std::string::npos) expected = std::stoull(request.substr(marker + 15, request.find('\r', marker) - marker - 15));
            }
            if (request.size() >= headers + 4 + expected) return true;
        }
        return false;
    }

    void reply(SOCKET client, const std::string& response) {
        std::size_t offset = 0;
        while (offset < response.size()) {
            const int sent = send(client, response.data() + offset, static_cast<int>(std::min<std::size_t>(response.size() - offset, 1 << 20)), 0);
            if (sent <= 0) break;
            offset += sent;
        }
    }

    void handleClient(SOCKET client) {
        std::string request;
        if (!receiveRequest(client, request)) { closesocket(client); return; }
        try {
            const auto firstLineEnd = request.find("\r\n");
            const auto firstLine = request.substr(0, firstLineEnd);
            const auto firstSpace = firstLine.find(' ');
            const auto secondSpace = firstLine.find(' ', firstSpace + 1);
            const std::string method = firstLine.substr(0, firstSpace);
            const std::string target = firstLine.substr(firstSpace + 1, secondSpace - firstSpace - 1);
            const auto bodyStart = request.find("\r\n\r\n") + 4;
            const std::string body = bodyStart <= request.size() ? request.substr(bodyStart) : std::string();
            reply(client, route(method, target, body));
        } catch (...) {
            reply(client, make_http_response(400, "text/plain; charset=utf-8", "Bad request"));
        }
        shutdown(client, SD_BOTH);
        closesocket(client);
    }

    std::string route(const std::string& method, const std::string& rawTarget, const std::string& body) {
        const auto query = rawTarget.find('?');
        const std::string pathPart = rawTarget.substr(0, query);
        const std::string prefix = "/" + token_ + "/";
        if (pathPart.rfind(prefix, 0) != 0) return make_http_response(404, "text/plain", "Not found");
        const std::string relative = url_decode(pathPart.substr(prefix.size()));
        if (method == "GET" && relative == "state-meta.json") return make_http_response(200, "application/json; charset=utf-8", metaJson());
        if (method == "GET" && relative == "state.json") {
            {
                std::lock_guard lock(mutex_);
                if (!document_) return make_http_response(404, "text/plain", "No preview");
            }
            return make_http_response(200, "application/json; charset=utf-8", stateJson());
        }
        if (method == "GET" && relative == "command") {
            std::lock_guard lock(mutex_);
            if (!pending_ || pending_->delivered) return make_http_response(204, "text/plain", "");
            pending_->delivered = true;
            return make_http_response(200, "application/json; charset=utf-8", "{\"id\":" + json_string(pending_->id) + ",\"op\":" + json_string(pending_->op) + ",\"args\":" + pending_->args + "}");
        }
        if (method == "POST" && relative == "result") {
            const Json payload = JsonParser(body).parse();
            const std::string id = payload.get("id") ? payload.get("id")->asString() : std::string();
            std::lock_guard lock(mutex_);
            if (pending_ && pending_->id == id) {
                if (!payload.get("ok") || !payload.get("ok")->asBool()) {
                    const std::string error = payload.get("error") ? payload.get("error")->asString("Browser command failed") : "Browser command failed";
                    lastResult_ = Result{id, "{\"error\":" + json_string(error) + "}"};
                } else {
                    lastResult_ = Result{id, payload.get("value") ? payload.get("value")->dump() : "{}"};
                }
                pending_.reset();
                condition_.notify_all();
            }
            return make_http_response(204, "text/plain", "");
        }
        if (method != "GET") return make_http_response(404, "text/plain", "Not found");
        const fs::path root = fs::weakly_canonical(assets_);
        const fs::path candidate = fs::weakly_canonical(root / fs::path(relative.empty() ? "index.html" : relative));
        if (candidate != root && candidate.native().rfind(root.native() + fs::path::preferred_separator, 0) != 0) return make_http_response(403, "text/plain", "Forbidden");
        std::ifstream input(candidate, std::ios::binary);
        if (!input) return make_http_response(404, "text/plain", "Not found");
        std::ostringstream content;
        content << input.rdbuf();
        return make_http_response(200, mime_type(candidate), content.str());
    }
};

struct Options {
    fs::path base;
    std::vector<fs::path> roots;
    bool allowAnyPath = false;
    std::size_t maxBytes = 64 * 1024 * 1024;
};

bool inside(const fs::path& root, const fs::path& candidate) {
    const auto rootText = lower_wide(fs::weakly_canonical(root).wstring());
    const auto candidateText = lower_wide(fs::weakly_canonical(candidate).wstring());
    return candidateText == rootText || candidateText.rfind(rootText + L'\\', 0) == 0;
}

fs::path resolveDocument(const Options& options, const std::string& input) {
    const std::wstring wide = wide_from_utf8(input);
    if (wide.empty()) throw std::runtime_error("The path must be valid UTF-8.");
    fs::path requested(wide);
    if (requested.is_relative()) requested = fs::current_path() / requested;
    requested = fs::weakly_canonical(requested);
    if (!options.allowAnyPath && !std::any_of(options.roots.begin(), options.roots.end(), [&](const fs::path& root) { return inside(root, requested); })) throw std::runtime_error("Path is outside the allowed roots: " + input);
    if (!fs::is_regular_file(requested)) throw std::runtime_error("File does not exist: " + input);
    if (lower_wide(requested.extension().wstring()) != L".xml" && lower_wide(requested.extension().wstring()) != L".mxl") throw std::runtime_error("Unsupported file extension.");
    if (lower_wide(requested.filename().wstring()) == L".xml" && lower_wide(requested.parent_path().filename().wstring()) == L"forms") {
        const auto form = requested.parent_path() / requested.stem() / L"Ext" / L"Form.xml";
        if (fs::is_regular_file(form)) requested = fs::weakly_canonical(form);
    }
    return requested;
}

Document loadDocument(const Options& options, const std::string& input) {
    Document document;
    document.requestedPath = resolveDocument(options, input);
    document.resolvedPath = document.requestedPath;
    document.content = read_text_file(document.resolvedPath, options.maxBytes, document.encoding);
    document.size = fs::file_size(document.resolvedPath);
    if (lower_wide(document.resolvedPath.filename().wstring()) == L"form.xml"
        && lower_wide(document.resolvedPath.parent_path().filename().wstring()) == L"ext") {
        const auto formDirectory = document.resolvedPath.parent_path().parent_path();
        const auto formsDirectory = formDirectory.parent_path();
        const auto objectDirectory = formsDirectory.parent_path();
        const auto objectName = objectDirectory.filename().wstring();
        const std::vector<fs::path> candidates = {
            objectDirectory.parent_path() / (objectName + L".xml"),
            objectDirectory / (objectName + L".xml"),
        };
        for (const auto& candidate : candidates) {
            if (!fs::is_regular_file(candidate)) continue;
            if (!options.allowAnyPath && !std::any_of(options.roots.begin(), options.roots.end(), [&](const fs::path& root) { return inside(root, candidate); })) continue;
            std::string metadataEncoding;
            const auto metadata = read_text_file(candidate, options.maxBytes, metadataEncoding);
            if (metadata.find("MetaDataObject") != std::string::npos) {
                document.objectMeta = metadata;
                break;
            }
        }
    }
    return document;
}

std::string argsObject(const Json* args) { return args && args->kind == Json::Kind::Object ? args->dump() : "{}"; }
std::string argString(const Json* args, const std::string& name) { const auto* value = args && args->kind == Json::Kind::Object ? args->get(name) : nullptr; return value ? value->asString() : std::string(); }

std::string toolSchemas() {
    return R"JSON([{"name":"open_preview","description":"Open a Form.xml, Template.xml or MXL file in the external browser.","inputSchema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]},"annotations":{"readOnlyHint":true}},{"name":"get_preview_url","description":"Return the localhost URL for the current preview.","inputSchema":{"type":"object","properties":{}},"annotations":{"readOnlyHint":true}},{"name":"reload_preview","description":"Read the active source file again.","inputSchema":{"type":"object","properties":{}},"annotations":{"readOnlyHint":true}},{"name":"inspect_preview","description":"Inspect rendered form elements, tabs and scroll areas.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"visible_only":{"type":"boolean"}}},"annotations":{"readOnlyHint":true}},{"name":"switch_tab","description":"Switch a regular or nested form page by stable model ID.","inputSchema":{"type":"object","properties":{"page_id":{"type":"string"},"pages_id":{"type":"string"}},"required":["page_id"]},"annotations":{"readOnlyHint":true}},{"name":"select_element","description":"Highlight a form element by model ID and scroll it into view.","inputSchema":{"type":"object","properties":{"element_id":{"type":"string"}},"required":["element_id"]},"annotations":{"readOnlyHint":true}},{"name":"scroll_preview","description":"Scroll a preview target.","inputSchema":{"type":"object","properties":{"target":{"type":"string","enum":["document","active-page","table","spreadsheet"]},"element_id":{"type":"string"},"delta_x":{"type":"number"},"delta_y":{"type":"number"},"x":{"type":"number"},"y":{"type":"number"}},"required":["target"]},"annotations":{"readOnlyHint":true}},{"name":"capture_preview","description":"Capture the browser-rendered preview or one element as PNG.","inputSchema":{"type":"object","properties":{"scope":{"type":"string","enum":["viewport","document","element"]},"element_id":{"type":"string"}}},"annotations":{"readOnlyHint":true}},{"name":"close_preview","description":"Stop the local preview server.","inputSchema":{"type":"object","properties":{}},"annotations":{"readOnlyHint":true}}])JSON";
}

std::string success(std::string_view id, std::string value, std::string image = {}) {
    std::string output = "{\"jsonrpc\":\"2.0\",\"id\":" + std::string(id) + ",\"result\":{\"content\":[{\"type\":\"text\",\"text\":" + json_string(value) + "}";
    if (!image.empty()) output += ", {\"type\":\"image\",\"data\":" + json_string(image) + ",\"mimeType\":\"image/png\"}";
    output += "],\"structuredContent\":" + (value.empty() ? "{}" : value) + "}}}";
    return output;
}

std::string failure(std::string_view id, const std::string& message) {
    return "{\"jsonrpc\":\"2.0\",\"id\":" + std::string(id) + ",\"result\":{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":" + json_string(message) + "}]}}";
}

class McpApp {
public:
    explicit McpApp(Options options) : options_(std::move(options)), preview_(options_.base / L"app" / L"web") {}

    std::string request(const Json& request) {
        const auto* id = request.get("id");
        const std::string idRaw = id ? id->dump() : "null";
        const std::string method = request.get("method") ? request.get("method")->asString() : std::string();
        if (!id && method.rfind("notifications/", 0) == 0) return {};
        try {
            if (method == "initialize") return "{\"jsonrpc\":\"2.0\",\"id\":" + idRaw + ",\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"" ONE_C_FORM_VIEWER_NAME "\",\"version\":\"" ONE_C_FORM_VIEWER_VERSION "\"}}}";
            if (method == "ping") return "{\"jsonrpc\":\"2.0\",\"id\":" + idRaw + ",\"result\":{}}";
            if (method == "tools/list") return "{\"jsonrpc\":\"2.0\",\"id\":" + idRaw + ",\"result\":{\"tools\":" + toolSchemas() + "}}";
            if (method != "tools/call") return failure(idRaw, "Unknown MCP method: " + method);
            const auto* params = request.get("params");
            const std::string name = params && params->get("name") ? params->get("name")->asString() : std::string();
            const Json* arguments = params ? params->get("arguments") : nullptr;
            if (name == "open_preview") {
                const std::string input = argString(arguments, "path");
                if (input.empty()) throw std::runtime_error("path is required");
                Document document = loadDocument(options_, input);
                preview_.start();
                preview_.setDocument(document);
                const std::string url = preview_.url();
                ShellExecuteW(nullptr, L"open", wide_from_utf8(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                const std::string value = "{\"path\":" + json_string(utf8_from_wide(document.resolvedPath.wstring())) + ",\"size\":" + std::to_string(document.size) + ",\"encoding\":" + json_string(document.encoding) + ",\"previewUrl\":" + json_string(url) + "}";
                return success(idRaw, value);
            }
            if (name == "get_preview_url") return success(idRaw, "{\"previewUrl\":" + json_string(preview_.url()) + ",\"externalBrowser\":true}");
            if (name == "reload_preview") {
                if (!lastInput_.empty()) {
                    Document document = loadDocument(options_, lastInput_);
                    preview_.setDocument(document);
                } else throw std::runtime_error("No preview is open. Call open_preview first.");
                const auto result = preview_.command("state", "{}");
                return success(idRaw, result);
            }
            if (name == "inspect_preview") {
                std::string args = "{\"query\":" + json_string(argString(arguments, "query")) + ",\"visibleOnly\":" + ((arguments && arguments->get("visible_only") && arguments->get("visible_only")->asBool()) ? "true" : "false") + "}";
                return success(idRaw, preview_.command("inspect", args));
            }
            if (name == "switch_tab") return success(idRaw, preview_.command("switchTab", "{\"pageId\":" + json_string(argString(arguments, "page_id")) + ",\"pagesId\":" + json_string(argString(arguments, "pages_id")) + "}"));
            if (name == "select_element") return success(idRaw, preview_.command("select", "{\"elementId\":" + json_string(argString(arguments, "element_id")) + "}"));
            if (name == "scroll_preview") {
                std::string args = argsObject(arguments);
                std::map<std::string, std::string> replacements{{"target", "target"}, {"element_id", "elementId"}, {"delta_x", "deltaX"}, {"delta_y", "deltaY"}};
                for (const auto& [from, to] : replacements) {
                    const std::string needle = json_string(from);
                    std::size_t position = 0;
                    while ((position = args.find(needle, position)) != std::string::npos) { args.replace(position, needle.size(), json_string(to)); position += to.size() + 2; }
                }
                return success(idRaw, preview_.command("scroll", args));
            }
            if (name == "capture_preview") {
                const std::string scope = argString(arguments, "scope").empty() ? "viewport" : argString(arguments, "scope");
                const std::string result = preview_.command("capture", "{\"scope\":" + json_string(scope) + ",\"elementId\":" + json_string(argString(arguments, "element_id")) + "}");
                const Json payload = JsonParser(result).parse();
                const auto* data = payload.get("data");
                const auto* mime = payload.get("mimeType");
                if (!data || !mime) throw std::runtime_error("The browser returned no image.");
                return success(idRaw, "{\"scope\":" + json_string(scope) + "}", data->asString());
            }
            if (name == "close_preview") { preview_.close(); return success(idRaw, "{\"closed\":true}"); }
            throw std::runtime_error("Unknown tool: " + name);
        } catch (const std::exception& error) {
            return failure(idRaw, error.what());
        }
    }

    void rememberInput(std::string input) { lastInput_ = std::move(input); }

private:
    Options options_;
    PreviewServer preview_;
    std::string lastInput_;
};

fs::path executableDirectory() {
    std::vector<wchar_t> buffer(MAX_PATH);
    for (;;) {
        const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (!length) return {};
        if (length < buffer.size() - 1) return fs::path(std::wstring(buffer.data(), length)).parent_path();
        buffer.resize(buffer.size() * 2);
    }
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    Options options;
    options.base = executableDirectory();
    options.roots.push_back(fs::current_path());
    std::string firstInput;
    for (int index = 1; index < argc; ++index) {
        const std::wstring argument = argv[index];
        if (argument == L"--root" && index + 1 < argc) options.roots.push_back(fs::weakly_canonical(argv[++index]));
        else if (argument == L"--allow-any-path") options.allowAnyPath = true;
        else if (argument == L"--max-bytes" && index + 1 < argc) options.maxBytes = std::stoull(argv[++index]);
        else if (argument == L"--stdio") continue;
        else if (argument == L"--help" || argument == L"-h") {
            std::wcout << L"1c-form-viewer-native --stdio [--root PATH ... | --allow-any-path]\n";
            return 0;
        } else if (argument == L"--version" || argument == L"-v") { std::wcout << ONE_C_FORM_VIEWER_VERSION_W << std::endl; return 0; }
        else if (argument.rfind(L"--", 0) == 0) { std::wcerr << L"Unknown option: " << argument << L"\n"; return 2; }
    }

    McpApp app(options);
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        try {
            Json request = JsonParser(line).parse();
            if (request.get("method") && request.get("method")->asString() == "tools/call") {
                const auto* params = request.get("params");
                if (params && params->get("name") && params->get("name")->asString() == "open_preview") {
                    const auto* args = params->get("arguments");
                    app.rememberInput(argString(args, "path"));
                }
            }
            const std::string response = app.request(request);
            if (!response.empty()) std::cout << response << std::endl;
        } catch (const std::exception& error) {
            std::cerr << "1c-form-viewer-native: " << error.what() << '\n';
        }
    }
    return 0;
}
