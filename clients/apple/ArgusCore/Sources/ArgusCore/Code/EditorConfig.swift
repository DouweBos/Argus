import Foundation

/// One parsed `.editorconfig` file (https://spec.editorconfig.org): the `root` flag and its
/// glob sections in file order.
public struct EditorConfig: Sendable, Equatable {
  public struct Section: Sendable, Equatable {
    public let glob: String
    /// Lowercased keys; values as written (`unset` included).
    public let properties: [String: String]
  }

  public let isRoot: Bool
  public let sections: [Section]

  public init(parsing text: String) {
    var isRoot = false
    var sections: [Section] = []
    var glob: String?
    var properties: [String: String] = [:]
    func flush() {
      if let glob { sections.append(Section(glob: glob, properties: properties)) }
      properties = [:]
    }
    for raw in text.split(omittingEmptySubsequences: true, whereSeparator: \.isNewline) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.isEmpty || line.hasPrefix("#") || line.hasPrefix(";") { continue }
      if line.hasPrefix("["), line.hasSuffix("]") {
        flush()
        glob = String(line.dropFirst().dropLast())
        continue
      }
      guard let equals = line.firstIndex(of: "=") else { continue }
      let key = line[..<equals].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: equals)...].trimmingCharacters(in: .whitespaces)
      if glob == nil {
        if key == "root" { isRoot = value.lowercased() == "true" }
      } else {
        properties[key] = value
      }
    }
    flush()
    self.isRoot = isRoot
    self.sections = sections
  }

  public enum IndentStyle: String, Sendable { case tab, space }
  public enum EndOfLine: String, Sendable { case lf, crlf, cr }

  /// The properties the editor honours. Nil means "not set": fall back to the app setting.
  public struct Properties: Sendable, Equatable {
    public var indentStyle: IndentStyle?
    public var indentSize: Int?
    public var tabWidth: Int?
    public var endOfLine: EndOfLine?
    public var insertFinalNewline: Bool?
    public var trimTrailingWhitespace: Bool?

    public init(
      indentStyle: IndentStyle? = nil, indentSize: Int? = nil, tabWidth: Int? = nil,
      endOfLine: EndOfLine? = nil, insertFinalNewline: Bool? = nil,
      trimTrailingWhitespace: Bool? = nil
    ) {
      self.indentStyle = indentStyle
      self.indentSize = indentSize
      self.tabWidth = tabWidth
      self.endOfLine = endOfLine
      self.insertFinalNewline = insertFinalNewline
      self.trimTrailingWhitespace = trimTrailingWhitespace
    }
  }

  /// Resolves `path` (relative to the worktree) against `.editorconfig` files given nearest
  /// first, each with its directory relative to the worktree (`""` for the root). Stops at the
  /// first `root = true`; nearer files and later sections win.
  public static func resolve(path: String, files: [(directory: String, text: String)])
    -> Properties
  {
    var chain: [(directory: String, config: EditorConfig)] = []
    for file in files {
      let config = EditorConfig(parsing: file.text)
      chain.append((file.directory, config))
      if config.isRoot { break }
    }
    var merged: [String: String] = [:]
    for (directory, config) in chain.reversed() {
      guard let relative = relativePath(path, inside: directory) else { continue }
      for section in config.sections where EditorConfigGlob.matches(section.glob, path: relative) {
        merged.merge(section.properties) { $1 }
      }
    }
    return properties(from: merged)
  }

  private static func relativePath(_ path: String, inside directory: String) -> String? {
    let directory = directory.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let path = path.hasPrefix("/") ? String(path.dropFirst()) : path
    if directory.isEmpty { return path }
    guard path.hasPrefix(directory + "/") else { return nil }
    return String(path.dropFirst(directory.count + 1))
  }

  private static func properties(from raw: [String: String]) -> Properties {
    let values = raw.mapValues { $0.lowercased() }.filter { $0.value != "unset" }
    var result = Properties()
    result.indentStyle = values["indent_style"].flatMap(IndentStyle.init(rawValue:))
    result.tabWidth = values["tab_width"].flatMap { Int($0) }
    if values["indent_size"] == "tab" {
      result.indentSize = result.tabWidth
    } else {
      result.indentSize = values["indent_size"].flatMap { Int($0) }
    }
    if result.tabWidth == nil { result.tabWidth = result.indentSize }
    if result.indentSize == nil, result.indentStyle == .tab { result.indentSize = result.tabWidth }
    result.endOfLine = values["end_of_line"].flatMap(EndOfLine.init(rawValue:))
    result.insertFinalNewline = values["insert_final_newline"].flatMap(bool)
    result.trimTrailingWhitespace = values["trim_trailing_whitespace"].flatMap(bool)
    return result
  }

  private static func bool(_ value: String) -> Bool? {
    switch value {
    case "true": true
    case "false": false
    default: nil
    }
  }
}

/// EditorConfig globs: `*`, `**`, `?`, `[abc]`, `[!abc]`, `{a,b}`, `{1..3}`. A glob without a
/// `/` matches the file name in any directory; with one, it is anchored at the config's directory.
enum EditorConfigGlob {
  static func matches(_ glob: String, path: String) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: pattern(for: glob)) else { return false }
    let range = NSRange(path.startIndex..., in: path)
    return regex.firstMatch(in: path, range: range) != nil
  }

  static func pattern(for glob: String) -> String {
    var glob = glob
    let anchored = glob.contains("/")
    if glob.hasPrefix("/") { glob.removeFirst() }
    var out = anchored ? "^" : "^(?:.*/)?"
    var chars = Array(glob)[...]
    var braceDepth = 0
    while let char = chars.popFirst() {
      switch char {
      case "*":
        if chars.first == "*" {
          chars.removeFirst()
          if chars.first == "/" {
            chars.removeFirst()
            out += "(?:.*/)?"
          } else {
            out += ".*"
          }
        } else {
          out += "[^/]*"
        }
      case "?": out += "[^/]"
      case "[":
        if let close = chars.firstIndex(of: "]") {
          var body = String(chars[chars.startIndex..<close])
          chars = chars[chars.index(after: close)...]
          if body.hasPrefix("!") { body = "^" + body.dropFirst() }
          out += "[" + body.replacingOccurrences(of: "\\", with: "\\\\") + "]"
        } else {
          out += "\\["
        }
      case "{":
        if let close = chars.firstIndex(of: "}"), let range = numericRange(chars[chars.startIndex..<close]) {
          chars = chars[chars.index(after: close)...]
          out += "(?:" + range.map(String.init).joined(separator: "|") + ")"
        } else if chars.contains("}") {
          braceDepth += 1
          out += "(?:"
        } else {
          out += "\\{"
        }
      case "}" where braceDepth > 0:
        braceDepth -= 1
        out += ")"
      case "," where braceDepth > 0: out += "|"
      case "\\":
        if let next = chars.popFirst() { out += NSRegularExpression.escapedPattern(for: String(next)) }
      default: out += NSRegularExpression.escapedPattern(for: String(char))
      }
    }
    return out + "$"
  }

  /// `{3..12}` as a small explicit list; large ranges aren't worth supporting.
  private static func numericRange(_ body: ArraySlice<Character>) -> ClosedRange<Int>? {
    let parts = String(body).components(separatedBy: "..")
    guard parts.count == 2, let low = Int(parts[0]), let high = Int(parts[1]), low <= high,
      high - low <= 1000
    else { return nil }
    return low...high
  }
}
