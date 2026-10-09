import Foundation
import SwiftTreeSitter

/// A foldable region: `hidden` is what collapses, so `{`/`}` or a tag pair stay visible around it.
public struct SyntaxFold: Sendable, Equatable {
  /// The whole construct.
  public var range: NSRange
  public var hidden: NSRange

  public init(range: NSRange, hidden: NSRange) {
    self.range = range
    self.hidden = hidden
  }
}

extension SyntaxEngine {
  private static let closers: [String: String] = ["{": "}", "[": "]", "(": ")"]

  /// Every multi-line bracket pair, plus the language's `folds.scm` captures.
  func folds() -> [SyntaxFold] {
    parseIfNeeded()
    guard let tree, let root = tree.rootNode else { return [] }
    var result: [SyntaxFold] = []
    collectBracketFolds(root, into: &result)
    if let query = assets.folds { collectQueryFolds(query, tree: tree, root: root, into: &result) }
    return result.sorted { ($0.hidden.location, -$0.hidden.length) < ($1.hidden.location, -$1.hidden.length) }
  }

  /// Walks only nodes spanning several lines: nothing on one line can fold.
  private func collectBracketFolds(_ root: Node, into result: inout [SyntaxFold]) {
    var stack = [root]
    while let node = stack.popLast() {
      let count = node.childCount
      guard count > 0, node.pointRange.lowerBound.row < node.pointRange.upperBound.row else { continue }
      if count >= 2, let first = node.child(at: 0), let last = node.child(at: count - 1), !first.isNamed,
        let open = first.nodeType, let close = Self.closers[open], last.nodeType == close, !last.isMissing
      {
        add(node.range, hidden: NSRange(location: NSMaxRange(first.range), length: last.range.location - NSMaxRange(first.range)), to: &result)
      }
      for index in 0..<count {
        if let child = node.child(at: index) { stack.append(child) }
      }
    }
  }

  /// `@fold` is the region; `@fold.open` / `@fold.close` bound what hides, defaulting to the end of
  /// the first line and the end of the node.
  private func collectQueryFolds(_ query: Query, tree: MutableTree, root: Node, into result: inout [SyntaxFold]) {
    let cursor = query.execute(node: root, in: tree)
    for match in cursor {
      guard let node = match.captures(named: "fold").first?.node else { continue }
      let range = node.range
      let start = match.captures(named: "fold.open").first.map { NSMaxRange($0.range) } ?? endOfLine(from: range.location)
      let end = match.captures(named: "fold.close").first?.range.location ?? trimmedEnd(of: range)
      guard end > start else { continue }
      add(range, hidden: NSRange(location: start, length: end - start), to: &result)
    }
  }

  private func add(_ range: NSRange, hidden: NSRange, to result: inout [SyntaxFold]) {
    guard hidden.length > 0, containsNewline(hidden) else { return }
    result.append(SyntaxFold(range: range, hidden: hidden))
  }

  private func endOfLine(from offset: Int) -> Int {
    let units = buffer.units
    var index = offset
    while index < units.count, units[index] != 0x0A, units[index] != 0x0D { index += 1 }
    return index
  }

  /// The node's end without trailing whitespace (Markdown sections end after their blank lines).
  private func trimmedEnd(of range: NSRange) -> Int {
    let units = buffer.units
    var end = min(NSMaxRange(range), units.count)
    while end > range.location, [0x20, 0x09, 0x0A, 0x0D].contains(units[end - 1]) { end -= 1 }
    return end
  }

  private func containsNewline(_ range: NSRange) -> Bool {
    let units = buffer.units
    return units[range.location..<min(NSMaxRange(range), units.count)].contains(0x0A)
  }
}
