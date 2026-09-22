import Foundation

/// The `@`-mention picker's pure logic: where a mention starts, whether it
/// names a path, and how candidates rank.
public enum MentionQuery {
  public static let maxResults = 12

  /// The mention being typed, or nil.
  ///
  /// A mention starts at the last `@` that begins a word, and ends at the
  /// first whitespace — so `foo@bar` and `@src/ lib` are not mentions.
  public static func detect(in text: String) -> String? {
    guard let at = text.lastIndex(of: "@") else { return nil }
    if at != text.startIndex {
      let before = text[text.index(before: at)]
      guard before == " " || before == "\n" else { return nil }
    }
    let query = String(text[text.index(after: at)...])
    return query.contains(" ") || query.contains("\n") ? nil : query
  }

  /// A query naming a path browses the tree; anything else searches the flat
  /// file list. Typing a `/` is what switches modes.
  public static func isBrowsing(_ query: String) -> Bool {
    query.contains("/") || query.hasPrefix("~") || query.hasPrefix(".")
  }

  /// Exact, then prefix, then contains — the ranking the other clients use.
  public static func score(_ candidate: String, query: String) -> Int {
    let lower = candidate.lowercased()
    if lower == query { return 3 }
    if lower.hasPrefix(query) { return 2 }
    return 1
  }

  public static func search(_ files: [String], query: String) -> [String] {
    let needle = query.lowercased()
    guard !needle.isEmpty else { return Array(files.prefix(maxResults)) }
    return
      files
      .filter { $0.lowercased().contains(needle) }
      .sorted { score($0, query: needle) > score($1, query: needle) }
      .prefix(maxResults)
      .map { $0 }
  }

  public static func childPath(_ directory: String, _ name: String) -> String {
    directory.hasSuffix("/") ? directory + name : "\(directory)/\(name)"
  }

  /// Replace the mention under the caret. A directory keeps the picker open
  /// by leaving a trailing slash; anything else closes it with a space.
  public static func replacing(
    in text: String, with path: String, isDirectory: Bool
  ) -> String {
    guard let at = text.lastIndex(of: "@") else { return text }
    let head = String(text[..<at])
    if isDirectory {
      return head + "@" + (path.hasSuffix("/") ? path : path + "/")
    }
    return head + "@\(path) "
  }
}
