import ArgusCore
import ArgusSyntax
import Foundation

/// What the host needs to pick a server for a file, and which Settings toggle governs it.
struct LspDocumentLanguage: Equatable {
  /// LSP `languageId` for `lsp_did_open`.
  let languageId: String
  /// The server that handles it, for `lsp_status` and `lsp_restart`.
  let server: ArgusProtocol.LspLanguage
  /// The `SyntaxLanguage` raw value its Settings toggle is keyed by.
  let settingsKey: String

  /// Characters that open the completion list without a word typed first.
  var triggerCharacters: Set<Character> {
    switch server {
    case .typescript: [".", "\"", "'", "`", "/", "@", "<", "#"]
    case .json: ["\"", ":"]
    case .css: [":", "-", "/"]
    case .html: ["<", "\"", "/", ":"]
    case .yaml: [":"]
    case .c: [".", ">", ":"]
    case .rust, .ruby: [".", ":"]
    default: ["."]
    }
  }
}

/// Maps a file to its language server. The extension wins (it tells TSX from JSX, `.mm` from
/// `.m`, and covers C/C++ and SCSS, which have no grammar); a shebang-detected file falls back
/// to its grammar's language.
enum LspLanguageMap {
  static func resolve(path: String, language: SyntaxLanguage?) -> LspDocumentLanguage? {
    let ext = (path as NSString).pathExtension.lowercased()
    guard let id = extensions[ext] ?? language.flatMap(languageId) else { return nil }
    return document(languageId: id)
  }

  static func document(languageId id: String) -> LspDocumentLanguage? {
    guard let server = servers[id] else { return nil }
    return LspDocumentLanguage(languageId: id, server: server, settingsKey: settingsKeys[id] ?? server.rawValue)
  }

  /// The Settings toggle for a grammar's files: TSX shares TypeScript's.
  static func settingsKey(for language: SyntaxLanguage) -> String {
    language == .tsx ? SyntaxLanguage.typescript.rawValue : language.rawValue
  }

  private static func languageId(_ language: SyntaxLanguage) -> String? {
    switch language {
    case .markdown, .java, .bash: nil
    default: language.lspLanguageId
    }
  }

  private static let extensions: [String: String] = [
    "ts": "typescript", "mts": "typescript", "cts": "typescript", "tsx": "typescriptreact",
    "js": "javascript", "mjs": "javascript", "cjs": "javascript", "jsx": "javascriptreact",
    "json": "json", "jsonc": "jsonc", "resolved": "json", "webmanifest": "json",
    "css": "css", "scss": "scss", "less": "less",
    "html": "html", "htm": "html", "xhtml": "html",
    "yaml": "yaml", "yml": "yaml",
    "swift": "swift",
    "c": "c", "h": "objective-c", "m": "objective-c", "mm": "objective-cpp",
    "cc": "cpp", "cpp": "cpp", "cxx": "cpp", "hpp": "cpp", "hh": "cpp",
    "kt": "kotlin", "kts": "kotlin",
    "py": "python", "pyi": "python",
    "go": "go", "rs": "rust",
    "rb": "ruby", "rake": "ruby", "gemspec": "ruby",
  ]

  /// The host's `LANGUAGE_IDS` table: the languageIds it starts a server for.
  private static let servers: [String: ArgusProtocol.LspLanguage] = [
    "typescript": .typescript, "typescriptreact": .typescript, "javascript": .typescript,
    "javascriptreact": .typescript, "json": .json, "jsonc": .json, "css": .css, "scss": .css,
    "less": .css, "html": .html, "yaml": .yaml, "swift": .swift, "c": .c, "cpp": .c,
    "objective-c": .c, "objective-cpp": .c, "kotlin": .kotlin, "python": .python, "go": .go,
    "rust": .rust, "ruby": .ruby,
  ]

  private static let settingsKeys: [String: String] = [
    "typescript": "typescript", "typescriptreact": "typescript", "javascript": "javascript",
    "javascriptreact": "javascript", "jsonc": "json", "scss": "css", "less": "css", "c": "objc",
    "cpp": "objc", "objective-c": "objc", "objective-cpp": "objc",
  ]

  /// What the status bar calls a server.
  static func displayName(_ server: ArgusProtocol.LspLanguage) -> String {
    switch server {
    case .typescript: "TypeScript"
    case .json: "JSON"
    case .css: "CSS"
    case .html: "HTML"
    case .yaml: "YAML"
    case .swift: "Swift"
    case .c: "C/Objective-C"
    case .kotlin: "Kotlin"
    case .python: "Python"
    case .go: "Go"
    case .rust: "Rust"
    case .ruby: "Ruby"
    default: server.rawValue
    }
  }
}
