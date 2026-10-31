import ArgusKit
import Foundation

/// The desktop's `@`-mention picker, caret-aware: search mode lists matching
/// directories then files, browse mode lists one directory from the host.
/// Mirrors `app/components/agent/ChatInput/useMentionPicker.ts`.
public enum MentionPicker {
  public static let maxResults = 12
  static let maxDirectories = 6

  /// The `@token` the caret sits in. `start` is the UTF-16 offset of the `@`.
  public struct Context: Equatable, Sendable {
    public var query: String
    public var start: Int
  }

  public struct Item: Equatable, Sendable, Identifiable {
    public var display: String
    /// The parent directory in search mode.
    public var hint: String?
    public var isDirectory: Bool
    /// "Link this directory" — the browsed directory itself.
    public var isLinkAction = false

    public var id: String { "\(isLinkAction)-\(hint ?? "")/\(display)" }
  }

  public static func detect(in text: String, caret: Int) -> Context? {
    let utf16 = Array(text.utf16)
    let caret = min(max(caret, 0), utf16.count)
    guard let at = utf16[..<caret].lastIndex(of: UInt16(UInt8(ascii: "@"))) else { return nil }
    if at > 0, !isWhitespace(utf16[at - 1]) { return nil }
    let query = String(decoding: utf16[(at + 1)..<caret], as: UTF16.self)
    guard !query.contains(where: \.isWhitespace) else { return nil }
    return Context(query: query, start: at)
  }

  /// A query naming a path browses the tree; anything else searches the flat file list.
  public static func isBrowsing(_ query: String) -> Bool {
    query.contains("/") || query.hasPrefix("~") || query.hasPrefix(".")
  }

  /// `src/comp` → (`src/`, `comp`); `~Work` → (`~/`, `work`).
  public static func splitBrowse(_ query: String) -> (directory: String, filter: String) {
    guard let slash = query.lastIndex(of: "/") else {
      if query == "~" || query == "." { return (query, "") }
      if query.hasPrefix("~") { return ("~/", String(query.dropFirst()).lowercased()) }
      return ("./", String(query.dropFirst()).lowercased())
    }
    return (
      String(query[...slash]), String(query[query.index(after: slash)...]).lowercased()
    )
  }

  /// Every ancestor directory of the listed files, sorted.
  public static func directories(of files: [String]) -> [String] {
    var dirs = Set<String>()
    for file in files {
      var path = Substring(file)
      while let slash = path.lastIndex(of: "/") {
        path = path[..<slash]
        if !dirs.insert(String(path)).inserted { break }
      }
    }
    return dirs.sorted()
  }

  public static func search(files: [String], directories: [String], query: String) -> [Item] {
    let needle = query.lowercased()
    func ranked(_ paths: [String]) -> [String] {
      paths.filter { needle.isEmpty || $0.lowercased().contains(needle) }
        .enumerated()
        .sorted {
          let (a, b) = (score(basename($0.element), needle), score(basename($1.element), needle))
          return a != b ? a > b : $0.offset < $1.offset
        }
        .map(\.element)
    }
    let dirs = ranked(directories).prefix(maxDirectories).map {
      Item(display: basename($0), hint: dirname($0), isDirectory: true)
    }
    let files = ranked(files).prefix(maxResults - dirs.count).map {
      Item(display: basename($0), hint: dirname($0), isDirectory: false)
    }
    return dirs + files
  }

  public static func browse(
    directory: String, entries: [(name: String, isDirectory: Bool)], filter: String
  ) -> [Item] {
    let link = Item(display: trimSlashes(directory), isDirectory: true, isLinkAction: true)
    let items = entries.map { Item(display: $0.name, isDirectory: $0.isDirectory) }
    guard !filter.isEmpty else { return [link] + items }
    let matched = items.filter { $0.display.lowercased().contains(filter) }
      .enumerated()
      .sorted {
        let (a, b) = (score($0.element.display, filter), score($1.element.display, filter))
        return a != b ? a > b : $0.offset < $1.offset
      }
      .map(\.element)
    return [link] + matched
  }

  /// The full path an item stands for.
  public static func path(of item: Item, in context: Context) -> String {
    if isBrowsing(context.query) {
      let directory = splitBrowse(context.query).directory
      return item.isLinkAction ? trimSlashes(directory) : directory + item.display
    }
    guard let hint = item.hint, !hint.isEmpty else { return item.display }
    return "\(hint)/\(item.display)"
  }

  /// Picking an item rewrites the token. A directory drills in (`@path/`, picker
  /// stays open); anything else inserts `@path ` and closes it.
  public static func apply(
    _ item: Item, in context: Context, to text: String
  ) -> (text: String, caret: Int) {
    let utf16 = Array(text.utf16)
    let tokenEnd = min(context.start + 1 + context.query.utf16.count, utf16.count)
    let before = String(decoding: utf16[..<context.start], as: UTF16.self)
    let after = String(decoding: utf16[tokenEnd...], as: UTF16.self)
    let fullPath = path(of: item, in: context)
    let insertion =
      item.isDirectory && !item.isLinkAction ? "@\(fullPath)/" : "@\(fullPath) "
    return (before + insertion + after, before.utf16.count + insertion.utf16.count)
  }

  /// Dropped non-image files become mentions, spaces escaped, with a leading
  /// space when glued to a word.
  public static func insertingFileMentions(
    _ paths: [String], into text: String, caret: Int
  ) -> (text: String, caret: Int) {
    let utf16 = Array(text.utf16)
    let caret = min(max(caret, 0), utf16.count)
    let before = String(decoding: utf16[..<caret], as: UTF16.self)
    let after = String(decoding: utf16[caret...], as: UTF16.self)
    let needsSpace = !before.isEmpty && !(before.last?.isWhitespace ?? false)
    let mentions = paths.map { "@" + $0.replacingOccurrences(of: " ", with: "\\ ") }
      .joined(separator: " ")
    let insertion = (needsSpace ? " " : "") + mentions + " "
    return (before + insertion + after, before.utf16.count + insertion.utf16.count)
  }

  public static func header(for context: Context) -> String {
    isBrowsing(context.query) ? splitBrowse(context.query).directory : "Files"
  }

  static func score(_ candidate: String, _ query: String) -> Int {
    guard !query.isEmpty else { return 0 }
    let lower = candidate.lowercased()
    if lower == query { return 3 }
    if lower.hasPrefix(query) { return 2 }
    return lower.contains(query) ? 1 : 0
  }

  static func basename(_ path: String) -> String {
    path.lastIndex(of: "/").map { String(path[path.index(after: $0)...]) } ?? path
  }

  static func dirname(_ path: String) -> String {
    path.lastIndex(of: "/").map { String(path[..<$0]) } ?? ""
  }

  private static func trimSlashes(_ path: String) -> String {
    var trimmed = Substring(path)
    while trimmed.hasSuffix("/") { trimmed = trimmed.dropLast() }
    return trimmed.isEmpty ? "/" : String(trimmed)
  }

  private static func isWhitespace(_ unit: UInt16) -> Bool {
    unit == 0x20 || unit == 0x09 || unit == 0x0A || unit == 0x0D
  }
}
