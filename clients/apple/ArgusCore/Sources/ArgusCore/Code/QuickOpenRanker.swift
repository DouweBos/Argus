import ArgusKit
import Foundation

/// One row of quick open: a file or a symbol, with the UTF-16 offsets of its matched characters
/// (into the path, or into the symbol's name).
public enum QuickOpenResult: Sendable, Identifiable {
  case file(path: String, indices: [Int], boosted: Bool)
  case symbol(ArgusProtocol.CodeSymbol, indices: [Int], boosted: Bool)

  public var id: String {
    switch self {
    case .file(let path, _, _): "f:\(path)"
    case .symbol(let s, _, _): "s:\(s.relativePath):\(s.line):\(s.column):\(s.name)"
    }
  }

  public var path: String {
    switch self {
    case .file(let path, _, _): path
    case .symbol(let s, _, _): s.relativePath
    }
  }
}

/// Merges and ranks quick open's sources. Exact names, then prefixes, then fuzzy matches; within
/// each, changed files (and the symbols in them) first, then by fuzzy score; types before members.
public enum QuickOpenRanker {
  /// The host's index and the language servers' answers as one list, the servers' copy kept
  /// when both name the same definition.
  public static func merge(host: [ArgusProtocol.CodeSymbol], lsp: [ArgusProtocol.CodeSymbol])
    -> [ArgusProtocol.CodeSymbol]
  {
    var seen = Set<String>()
    return (lsp + host).filter { seen.insert("\($0.relativePath)\u{0}\($0.line)\u{0}\($0.name)").inserted }
  }

  public static func rankSymbols(
    _ query: String, _ symbols: [ArgusProtocol.CodeSymbol], changed: Set<String>, limit: Int = 50
  ) -> [QuickOpenResult] {
    sorted(score(query, symbols, changed: changed), limit: limit)
  }

  /// Open Quickly: `files` from the file matcher, ranked together with `symbols`.
  public static func rankMixed(
    _ query: String, files: [String], symbols: [ArgusProtocol.CodeSymbol], changed: Set<String>,
    limit: Int = 50
  ) -> [QuickOpenResult] {
    let needle = query.lowercased()
    var scored: [Scored] = []
    for path in files {
      guard let match = FuzzyFileMatcher.match(query, path: path) else { continue }
      let name = (path as NSString).lastPathComponent.lowercased()
      let stem = (name as NSString).deletingPathExtension
      let boosted = changed.contains(path)
      scored.append(
        Scored(
          tier: max(tier(stem, needle), tier(name, needle)), boosted: boosted, score: match.score,
          result: .file(path: path, indices: match.indices, boosted: boosted)))
    }
    return sorted(scored + score(query, symbols, changed: changed), limit: limit)
  }

  /// `@`: the file's symbols in order, or fuzzy-ranked once there's a query. `grouped` sorts by kind.
  public static func rankFileSymbols(_ query: String, _ symbols: [ArgusProtocol.CodeSymbol], grouped: Bool)
    -> [QuickOpenResult]
  {
    if query.isEmpty {
      let ordered =
        grouped
        ? symbols.enumerated().sorted {
          (kindOrder($0.element.kind), $0.offset) < (kindOrder($1.element.kind), $1.offset)
        }.map(\.element) : symbols
      return ordered.map { .symbol($0, indices: [], boosted: false) }
    }
    return rankSymbols(query, symbols, changed: [], limit: 200)
  }

  // MARK: - Scoring

  private static func score(_ query: String, _ symbols: [ArgusProtocol.CodeSymbol], changed: Set<String>)
    -> [Scored]
  {
    let needle = query.lowercased()
    return symbols.compactMap { symbol in
      guard let match = FuzzyFileMatcher.match(query, path: symbol.name) else { return nil }
      let boosted = changed.contains(symbol.relativePath)
      return Scored(
        tier: tier(symbol.name.lowercased(), needle), boosted: boosted,
        score: match.score + kindBonus(symbol.kind) * 16,
        result: .symbol(symbol, indices: match.indices, boosted: boosted))
    }
  }

  private struct Scored {
    let tier: Int
    let boosted: Bool
    let score: Int
    let result: QuickOpenResult
  }

  private static func sorted(_ scored: [Scored], limit: Int) -> [QuickOpenResult] {
    scored.sorted {
      if $0.tier != $1.tier { return $0.tier > $1.tier }
      if $0.boosted != $1.boosted { return $0.boosted }
      return $0.score > $1.score
    }.prefix(limit).map(\.result)
  }

  /// 3: the whole name, 2: its start, 1: anywhere.
  private static func tier(_ name: String, _ needle: String) -> Int {
    if name == needle { return 3 }
    return name.hasPrefix(needle) ? 2 : 1
  }

  private static func kindBonus(_ kind: ArgusProtocol.CodeSymbolKind) -> Int {
    switch kind {
    case .class, .struct, .enum, .interface, .protocol, .typeAlias: 2
    case .function, .method: 1
    default: 0
    }
  }

  private static let kindOrderList: [ArgusProtocol.CodeSymbolKind] = [
    .class, .struct, .enum, .protocol, .interface, .extension, .typeAlias, .module, .constructor, .method,
    .function, .property, .constant, .variable, .enumMember, .other,
  ]

  private static func kindOrder(_ kind: ArgusProtocol.CodeSymbolKind) -> Int {
    kindOrderList.firstIndex(of: kind) ?? kindOrderList.count
  }
}
