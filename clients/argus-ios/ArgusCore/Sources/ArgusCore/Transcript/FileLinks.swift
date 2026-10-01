import Foundation

/// File paths and URLs in transcript text, ported from `app/lib/filePathLink.ts`
/// so the desktop app and the Mac app link the same tokens. Ranges are UTF-16
/// (`NSRange`), which is what a text view highlights and hit-tests in.
public enum FileLinks {
  public struct FileRef: Hashable, Sendable {
    public var path: String
    public var line: Int?
    public var column: Int?

    public init(path: String, line: Int? = nil, column: Int? = nil) {
      self.path = path
      self.line = line
      self.column = column
    }
  }

  public enum Kind: Hashable, Sendable {
    case file(FileRef)
    case url(String)
  }

  public struct Match: Hashable, Sendable {
    public var range: NSRange
    public var kind: Kind

    public init(range: NSRange, kind: Kind) {
      self.range = range
      self.kind = kind
    }
  }

  public enum Segment: Hashable, Sendable {
    case text(String)
    case link(label: String, ref: FileRef)
    case url(String)
  }

  /// Kept tight so prose like "foo.bar" doesn't light up.
  static let extensions = [
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "html", "md", "mdx",
    "yml", "yaml", "toml", "swift", "m", "mm", "h", "c", "cpp", "rs", "go", "py", "rb",
    "sh", "zsh", "bash", "sql", "xml", "plist", "lock", "env", "gitignore", "dockerfile",
    "pbxproj",
  ]

  // `\w` spelled out as ASCII: ICU's is Unicode, JavaScript's (no `u` flag) is not.
  private static let word = "A-Za-z0-9_"

  private static let filePathRegex: NSRegularExpression = {
    let ext = extensions.joined(separator: "|")
    let core = "(?:/|\\.\\.?/|~/)?[\(word).\\-/@]*[\(word)\\-]\\.(?:\(ext))"
    let pattern = "(?<![\(word)/@-])(\(core))(?::(\\d+))?(?::(\\d+))?(?![\(word)])"
    return try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
  }()

  private static let urlRegex = try! NSRegularExpression(
    pattern: "https?://[^\\s<>\"']+", options: [.caseInsensitive])
  private static let mentionRegex = try! NSRegularExpression(pattern: "(^|\\s)@((?:\\\\\\s|\\S)+)")

  private static let trailing: Set<Character> = [
    ".", ",", ";", ":", "!", "?", ")", "]", "}", ">", "'", "\"",
  ]

  // MARK: Detection

  /// Every URL and file path in `text`, in order, never overlapping. Paths are
  /// only looked for between URLs, so `https://x.dev/a.ts` stays one URL.
  public static func matches(in text: String) -> [Match] {
    let ns = text as NSString
    var result: [Match] = []
    var cursor = 0
    for url in urlRanges(in: text) {
      if url.range.location > cursor {
        result += filePaths(in: ns, range: NSRange(location: cursor, length: url.range.location - cursor))
      }
      result.append(url)
      cursor = NSMaxRange(url.range)
    }
    if cursor < ns.length {
      result += filePaths(in: ns, range: NSRange(location: cursor, length: ns.length - cursor))
    }
    return result
  }

  /// `@mentions` the user typed, which need no extension, plus URLs.
  public static func mentionMatches(in text: String) -> [Match] {
    let ns = text as NSString
    var markers: [Match] = []
    for match in mentionRegex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
      let leading = match.range(at: 1).length
      let token = trimTrailing(ns.substring(with: match.range(at: 2)))
      guard !token.isEmpty else { continue }
      let start = match.range.location + leading
      var ref = parseFileRef(token)
      ref.path = unescapeShellPath(ref.path)
      markers.append(
        Match(range: NSRange(location: start, length: 1 + (token as NSString).length), kind: .file(ref)))
    }
    markers += urlRanges(in: text)
    markers.sort { $0.range.location < $1.range.location }

    var result: [Match] = []
    var cursor = 0
    for marker in markers where marker.range.location >= cursor {
      result.append(marker)
      cursor = NSMaxRange(marker.range)
    }
    return result
  }

  /// `path[:line[:col]]` → its parts.
  public static func parseFileRef(_ raw: String) -> FileRef {
    guard let match = raw.firstMatch(of: /^(.*?)(?::(\d+))?(?::(\d+))?$/) else {
      return FileRef(path: raw)
    }
    return FileRef(
      path: String(match.1),
      line: match.2.flatMap { Int($0) },
      column: match.3.flatMap { Int($0) })
  }

  /// `text` cut into plain runs and links, for renderers that build text piecewise.
  public static func split(_ text: String) -> [Segment] {
    segments(text, matches(in: text))
  }

  public static func splitMentions(_ text: String) -> [Segment] {
    segments(text, mentionMatches(in: text))
  }

  // MARK: Resolution

  /// An absolute path for `path`: `~/` against `home`, relative paths against
  /// the session's worktree. Nil when a relative path has nothing to resolve against.
  public static func resolve(_ path: String, worktree: String?, home: String? = nil) -> String? {
    if path.hasPrefix("/") { return (path as NSString).standardizingPath }
    if path.hasPrefix("~/") {
      guard let home else { return nil }
      return ((home as NSString).appendingPathComponent(String(path.dropFirst(2))) as NSString)
        .standardizingPath
    }
    guard let worktree, !worktree.isEmpty else { return nil }
    return ((worktree as NSString).appendingPathComponent(path) as NSString).standardizingPath
  }

  // MARK: Internals

  private static func filePaths(in text: NSString, range: NSRange) -> [Match] {
    filePathRegex.matches(in: text as String, range: range).map { match in
      let line = match.range(at: 2).location == NSNotFound
        ? nil : Int(text.substring(with: match.range(at: 2)))
      let column = match.range(at: 3).location == NSNotFound
        ? nil : Int(text.substring(with: match.range(at: 3)))
      let path = text.substring(with: match.range(at: 1))
      return Match(range: match.range, kind: .file(FileRef(path: path, line: line, column: column)))
    }
  }

  private static func urlRanges(in text: String) -> [Match] {
    let ns = text as NSString
    return urlRegex.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap {
      let url = trimTrailing(ns.substring(with: $0.range))
      guard !url.isEmpty else { return nil }
      return Match(
        range: NSRange(location: $0.range.location, length: (url as NSString).length),
        kind: .url(url))
    }
  }

  /// Drops sentence punctuation, but keeps a closer whose opener is in the
  /// token — `dir (3)` keeps its `)`.
  static func trimTrailing(_ token: String) -> String {
    let pairs: [Character: Character] = [")": "(", "]": "[", "}": "{"]
    var token = token
    while let last = token.last, trailing.contains(last) {
      if let opener = pairs[last] {
        let inner = token.dropLast()
        if inner.count(where: { $0 == opener }) > inner.count(where: { $0 == last }) { break }
      }
      token.removeLast()
    }
    return token
  }

  private static func unescapeShellPath(_ path: String) -> String {
    path.replacing(/\\(\s)/) { String($0.1) }
  }

  private static func segments(_ text: String, _ matches: [Match]) -> [Segment] {
    let ns = text as NSString
    var segments: [Segment] = []
    var cursor = 0
    for match in matches {
      if match.range.location > cursor {
        segments.append(
          .text(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))))
      }
      let label = ns.substring(with: match.range)
      switch match.kind {
      case .file(let ref): segments.append(.link(label: label, ref: ref))
      case .url(let url): segments.append(.url(url))
      }
      cursor = NSMaxRange(match.range)
    }
    if cursor < ns.length {
      segments.append(.text(ns.substring(from: cursor)))
    }
    return segments
  }
}
