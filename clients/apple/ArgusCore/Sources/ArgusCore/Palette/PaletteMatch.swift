import Foundation

/// Fuzzy matching for the command palette: every query character must appear
/// in order. Word starts and runs score higher, so "ns" ranks "New Session"
/// above "Agents" and "set" ranks "Settings" above "Show Terminal".
public enum PaletteMatch {
  /// Nil when the query doesn't match; higher is better.
  public static func score(_ query: String, in text: String) -> Int? {
    let needle = Array(query.lowercased().filter { !$0.isWhitespace })
    guard !needle.isEmpty else { return 0 }
    let haystack = Array(text.lowercased())
    var score = 0
    var index = 0
    var previous: Int?
    for char in needle {
      guard let found = haystack[index...].firstIndex(of: char) else { return nil }
      let atWordStart = found == 0 || !haystack[found - 1].isLetter && !haystack[found - 1].isNumber
      score += atWordStart ? 10 : 1
      if let previous, previous + 1 == found { score += 5 }
      previous = found
      index = found + 1
    }
    // Typed as one run of the text — above all at a word start — beats the
    // same letters scattered across words.
    let text = String(haystack)
    if let start = text.range(of: String(needle))?.lowerBound {
      let atWord = start == text.startIndex || !text[text.index(before: start)].isLetter
      score += atWord ? 60 : 30
    }
    // Shorter titles win ties: the match covers more of them.
    return score * 100 - haystack.count
  }

  /// `items` ranked by their best-scoring text, unmatched ones dropped. An empty
  /// query keeps the original order.
  public static func rank<Item>(
    _ items: [Item], query: String, texts: (Item) -> [String]
  ) -> [Item] {
    guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return items }
    return items.enumerated()
      .compactMap { offset, item -> (Item, Int, Int)? in
        let best = texts(item).compactMap { score(query, in: $0) }.max()
        return best.map { (item, $0, offset) }
      }
      .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.2 < $1.2 }
      .map(\.0)
  }

  /// `items` in runs by section, each run keeping the items' own order. Sections
  /// listed in `order` come first, in that order; the rest follow as they appear.
  public static func grouped<Item>(
    _ items: [Item], order: [String] = [], section: (Item) -> String
  ) -> [(section: String, items: [Item])] {
    var runs: [(section: String, items: [Item])] = []
    var index: [String: Int] = [:]
    for item in items {
      let name = section(item)
      if let at = index[name] {
        runs[at].items.append(item)
      } else {
        index[name] = runs.count
        runs.append((name, [item]))
      }
    }
    let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
    return runs.enumerated()
      .sorted { lhs, rhs in
        let left = rank[lhs.element.section] ?? order.count + lhs.offset
        let right = rank[rhs.element.section] ?? order.count + rhs.offset
        return left < right
      }
      .map(\.element)
  }
}
