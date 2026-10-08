import Foundation

/// A language Argus can highlight. Every case has a bundled grammar and query.
public enum SyntaxLanguage: String, CaseIterable, Sendable {
  case swift, typescript, tsx, javascript, json, markdown, kotlin, java, objc, yaml, bash, css,
    html, python, ruby, go, rust

  public var displayName: String {
    switch self {
    case .swift: "Swift"
    case .typescript: "TypeScript"
    case .tsx: "TSX"
    case .javascript: "JavaScript"
    case .json: "JSON"
    case .markdown: "Markdown"
    case .kotlin: "Kotlin"
    case .java: "Java"
    case .objc: "Objective-C"
    case .yaml: "YAML"
    case .bash: "Shell"
    case .css: "CSS"
    case .html: "HTML"
    case .python: "Python"
    case .ruby: "Ruby"
    case .go: "Go"
    case .rust: "Rust"
    }
  }

  /// The `language` value telemetry events carry; never a path or file name.
  public var telemetryName: String { rawValue }

  /// The LSP `languageId` for `textDocument/didOpen`.
  public var lspLanguageId: String {
    switch self {
    case .tsx: "typescriptreact"
    case .objc: "objective-c"
    case .bash: "shellscript"
    default: rawValue
    }
  }

  /// Detects a language from a file path (extension or well-known file name) and, failing
  /// that, a `#!` shebang on the first line.
  public static func detect(path: String, firstLine: String?) -> SyntaxLanguage? {
    let name = (path as NSString).lastPathComponent
    if let byName = fileNames[name] { return byName }
    let lower = name.lowercased()
    if let byName = fileNames[lower] { return byName }
    let ext = (lower as NSString).pathExtension
    if !ext.isEmpty, let byExtension = extensions[ext] { return byExtension }
    if let firstLine { return fromShebang(firstLine) }
    return nil
  }

  /// Resolves a loose language name, such as a Markdown fence info string (`ts`, `objective-c`,
  /// `shell {1,3}`) or a chat code block hint.
  public init?(languageName: String) {
    let token = languageName.trimmingCharacters(in: .whitespacesAndNewlines)
      .split(whereSeparator: { $0 == " " || $0 == "{" || $0 == "," || $0 == ":" }).first
      .map { $0.lowercased() } ?? ""
    guard !token.isEmpty else { return nil }
    if let alias = Self.aliases[token] {
      self = alias
    } else if let language = SyntaxLanguage(rawValue: token) ?? Self.extensions[token] {
      self = language
    } else {
      return nil
    }
  }

  private static func fromShebang(_ line: String) -> SyntaxLanguage? {
    guard line.hasPrefix("#!") else { return nil }
    let parts = line.dropFirst(2).split(separator: " ").map(String.init)
    guard var interpreter = parts.first.map({ ($0 as NSString).lastPathComponent }) else {
      return nil
    }
    if interpreter == "env" {
      guard let next = parts.dropFirst().first(where: { !$0.hasPrefix("-") }) else { return nil }
      interpreter = next
    }
    let base = interpreter.trimmingCharacters(in: .decimalDigits.union(["."]))
    return shebangs[base]
  }

  private static let extensions: [String: SyntaxLanguage] = [
    "swift": .swift,
    "ts": .typescript, "mts": .typescript, "cts": .typescript,
    "tsx": .tsx,
    "js": .javascript, "mjs": .javascript, "cjs": .javascript, "jsx": .javascript,
    "json": .json, "jsonc": .json, "json5": .json, "resolved": .json, "webmanifest": .json,
    "md": .markdown, "markdown": .markdown, "mdown": .markdown, "mkd": .markdown,
    "kt": .kotlin, "kts": .kotlin,
    "java": .java,
    "m": .objc, "mm": .objc, "h": .objc,
    "yaml": .yaml, "yml": .yaml,
    "sh": .bash, "bash": .bash, "zsh": .bash, "command": .bash,
    "css": .css,
    "html": .html, "htm": .html, "xhtml": .html,
    "py": .python, "pyi": .python, "pyw": .python,
    "rb": .ruby, "rake": .ruby, "gemspec": .ruby, "podspec": .ruby, "ru": .ruby,
    "go": .go,
    "rs": .rust,
  ]

  private static let fileNames: [String: SyntaxLanguage] = [
    "Podfile": .ruby, "Gemfile": .ruby, "Rakefile": .ruby, "Fastfile": .ruby, "Appfile": .ruby,
    "Matchfile": .ruby, "Pluginfile": .ruby, "Dangerfile": .ruby, "Brewfile": .ruby,
    "Snapfile": .ruby, "Scanfile": .ruby, "Gymfile": .ruby,
    ".bashrc": .bash, ".bash_profile": .bash, ".zshrc": .bash, ".zprofile": .bash,
    ".profile": .bash, ".envrc": .bash,
    ".babelrc": .json, ".eslintrc": .json, ".prettierrc": .json, ".swcrc": .json,
  ]

  private static let shebangs: [String: SyntaxLanguage] = [
    "node": .javascript, "bun": .javascript, "deno": .typescript, "ts-node": .typescript,
    "tsx": .typescript, "python": .python, "ruby": .ruby, "bash": .bash, "sh": .bash,
    "zsh": .bash, "dash": .bash, "ksh": .bash, "swift": .swift,
  ]

  private static let aliases: [String: SyntaxLanguage] = [
    "typescript": .typescript, "javascript": .javascript, "node": .javascript,
    "jsonc": .json, "json5": .json, "kotlin": .kotlin, "objective-c": .objc,
    "objectivec": .objc, "obj-c": .objc, "objc": .objc, "c": .objc, "shell": .bash,
    "shellscript": .bash, "console": .bash, "sh": .bash, "zsh": .bash, "python3": .python,
    "golang": .go, "md": .markdown,
  ]
}
