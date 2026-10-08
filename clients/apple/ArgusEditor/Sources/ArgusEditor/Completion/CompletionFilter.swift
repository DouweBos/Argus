import Foundation

/// Narrows and orders completion items by what's been typed since the list opened.
enum CompletionFilter {
  static func filter(_ items: [EditorCompletionItem], prefix: String) -> [EditorCompletionItem] {
    guard !prefix.isEmpty else { return items.sorted(by: order) }
    let needle = prefix.lowercased()
    var scored: [(item: EditorCompletionItem, score: Int)] = []
    for item in items {
      let haystack = (item.filterText ?? item.label).lowercased()
      guard let score = score(haystack, needle: needle) else { continue }
      scored.append((item, score))
    }
    return scored.sorted { a, b in
      a.score != b.score ? a.score > b.score : order(a.item, b.item)
    }.map(\.item)
  }

  /// Prefix beats substring beats subsequence; nil when the letters aren't all there in order.
  static func score(_ haystack: String, needle: String) -> Int? {
    if haystack.hasPrefix(needle) { return 3 }
    if haystack.contains(needle) { return 2 }
    var remaining = needle[...]
    for character in haystack where character == remaining.first {
      remaining = remaining.dropFirst()
      if remaining.isEmpty { return 1 }
    }
    return nil
  }

  private static func order(_ a: EditorCompletionItem, _ b: EditorCompletionItem) -> Bool {
    (a.sortText ?? a.label) < (b.sortText ?? b.label)
  }

  /// LSP snippet syntax reduced to plain text: `${1:name}` keeps `name`, `$0`/`$1` vanish.
  static func plainText(fromSnippet snippet: String) -> String {
    var result = snippet
    if let placeholder = try? NSRegularExpression(pattern: "\\$\\{\\d+:([^}]*)\\}") {
      result = placeholder.stringByReplacingMatches(
        in: result, range: NSRange(location: 0, length: (result as NSString).length), withTemplate: "$1")
    }
    if let tabstop = try? NSRegularExpression(pattern: "\\$\\{?\\d+\\}?") {
      result = tabstop.stringByReplacingMatches(
        in: result, range: NSRange(location: 0, length: (result as NSString).length), withTemplate: "")
    }
    return result
  }
}
