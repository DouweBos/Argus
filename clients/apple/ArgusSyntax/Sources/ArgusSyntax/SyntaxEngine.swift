import Foundation
import SwiftTreeSitter

/// Parses and highlights one document. Not thread-safe: `SyntaxDocument` owns one behind an
/// actor, `SyntaxHighlighter` uses a throwaway one.
final class SyntaxEngine {
  /// Injections nest at most this deep (Markdown → HTML → `<script>`).
  private static let maxInjectionDepth = 3

  let grammar: Grammar
  let assets: GrammarAssets
  private let parser = Parser()
  private(set) var buffer: TextBuffer
  private(set) var tree: MutableTree?
  private var needsParse = true
  private var injectionTrees: [InjectionKey: MutableTree] = [:]

  init?(grammar: Grammar, text: String) {
    guard let assets = GrammarRegistry.assets(for: grammar),
      (try? parser.setLanguage(assets.language)) != nil
    else { return nil }
    self.grammar = grammar
    self.assets = assets
    self.buffer = TextBuffer(text)
  }

  /// Applies an edit; the reparse waits for the next `highlights(in:)`, so a burst of
  /// keystrokes costs one parse. Returns false when the range doesn't fit the text.
  @discardableResult
  func edit(range: NSRange, newText: String) -> Bool {
    guard range.location >= 0, range.length >= 0, NSMaxRange(range) <= buffer.count else {
      return false
    }
    let inputEdit = buffer.replace(range, with: newText)
    tree?.edit(inputEdit)
    needsParse = true
    injectionTrees.removeAll(keepingCapacity: true)
    return true
  }

  func replaceAll(_ text: String) {
    buffer = TextBuffer(text)
    tree = nil
    needsParse = true
    injectionTrees.removeAll()
  }

  func parseIfNeeded() {
    guard needsParse else { return }
    let buffer = buffer
    tree = parser.parse(tree: tree) { byte, _ in
      buffer.chunk(atByte: byte)
    }
    needsParse = false
  }

  func highlights(in range: NSRange) -> [SyntaxRun] {
    parseIfNeeded()
    let range = NSIntersectionRange(range, NSRange(location: 0, length: buffer.count))
    guard range.length > 0, let tree, let root = tree.rootNode else { return [] }
    var painter = Painter(range: range)
    paint(tree: tree, root: root, assets: assets, range: range, depth: 0, into: &painter)
    return painter.runs()
  }

  private func paint(
    tree: MutableTree, root: Node, assets: GrammarAssets, range: NSRange, depth: Int,
    into painter: inout Painter
  ) {
    // No locals tracking: `#is-not? local` patterns (Ruby "every identifier is a method call")
    // stay off rather than misfire.
    let context = Predicate.Context(
      textProvider: { [buffer] range, _ in buffer.string(range) },
      groupMembershipProvider: { _, _, _ in true })
    var spans: [(range: NSRange, pattern: Int, style: Int8)] = []
    let cursor = assets.highlights.execute(node: root, in: tree)
    cursor.setRange(range)
    for match in cursor.resolve(with: context) {
      for capture in match.captures {
        guard capture.index < assets.styles.count, let style = assets.styles[capture.index]
        else { continue }
        spans.append((capture.node.range, match.patternIndex, style))
      }
    }
    // Outer spans first so nested ones paint over them; on the same span the later pattern wins.
    spans.sort { $0.range.length != $1.range.length ? $0.range.length > $1.range.length : $0.pattern < $1.pattern }
    for span in spans { painter.paint(span.range, span.style) }

    guard depth < Self.maxInjectionDepth, let injections = assets.injections else { return }
    let injectionCursor = injections.execute(node: root, in: tree)
    injectionCursor.setRange(range)
    for match in injectionCursor.resolve(with: context) {
      guard let content = match.captures(named: "injection.content").first,
        let name = match.metadata["injection.language"]
          ?? match.captures(named: "injection.language").first.map({ buffer.string($0.range) }),
        let grammar = Grammar(injectionName: name),
        let injectedAssets = GrammarRegistry.assets(for: grammar),
        let injected = injectionTree(grammar: grammar, assets: injectedAssets, node: content.node),
        let injectedRoot = injected.rootNode
      else { continue }
      let overlap = NSIntersectionRange(range, content.range)
      guard overlap.length > 0 else { continue }
      paint(
        tree: injected, root: injectedRoot, assets: injectedAssets, range: overlap,
        depth: depth + 1, into: &painter)
    }
  }

  private func injectionTree(grammar: Grammar, assets: GrammarAssets, node: Node) -> MutableTree? {
    let key = InjectionKey(grammar: grammar, bytes: node.byteRange)
    if let cached = injectionTrees[key] { return cached }
    let parser = Parser()
    guard (try? parser.setLanguage(assets.language)) != nil else { return nil }
    parser.includedRanges = [node.tsRange]
    let buffer = buffer
    let tree = parser.parse(tree: nil as Tree?) { byte, _ in
      buffer.chunk(atByte: byte)
    }
    injectionTrees[key] = tree
    return tree
  }
}

private struct InjectionKey: Hashable {
  let grammar: Grammar
  let bytes: Range<UInt32>
}

/// One style slot per UTF-16 unit of the requested range; later paints win.
struct Painter {
  private let range: NSRange
  private var slots: [Int8]

  init(range: NSRange) {
    self.range = range
    slots = Array(repeating: GrammarAssets.clear, count: range.length)
  }

  mutating func paint(_ span: NSRange, _ style: Int8) {
    let lower = max(span.location, range.location) - range.location
    let upper = min(NSMaxRange(span), NSMaxRange(range)) - range.location
    guard lower < upper else { return }
    slots.withUnsafeMutableBufferPointer { buffer in
      for index in lower..<upper { buffer[index] = style }
    }
  }

  func runs() -> [SyntaxRun] {
    var runs: [SyntaxRun] = []
    var index = 0
    while index < slots.count {
      let style = slots[index]
      var end = index + 1
      while end < slots.count, slots[end] == style { end += 1 }
      if style >= 0 {
        runs.append(
          SyntaxRun(
            range: NSRange(location: range.location + index, length: end - index),
            capture: SyntaxCapture.allCases[Int(style)]))
      }
      index = end
    }
    return runs
  }
}
