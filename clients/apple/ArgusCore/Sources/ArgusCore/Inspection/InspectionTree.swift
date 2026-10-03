import Foundation

/// Tree walks, search and hit-testing over a capture — the renderer's
/// `resolveNodeVisual.ts`.
extension Inspection.Node {
  /// Leaves draw their own pixels; containers draw as outlines.
  public var isLeaf: Bool { children.isEmpty }

  /// The visible string a row quotes after its class.
  public var label: String? { text ?? title ?? accessibilityLabel }

  /// A short tag that tells otherwise-identical classes apart: text, an
  /// identifier, an image asset, or a non-transparent fill.
  public func hint(maxLength: Int = 32) -> String? {
    if let text = label?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
      return "\"\(Inspection.truncate(text, maxLength))\""
    }
    if let id = accessibilityIdentifier ?? rn?.testID ?? rn?.nativeID {
      return "#\(Inspection.truncate(id, maxLength))"
    }
    if let name = image?.name { return "img:\(Inspection.truncate(name, maxLength))" }
    // A fully transparent fill tells you nothing.
    if let bg = backgroundColor, !bg.uppercased().hasSuffix("00") { return bg }
    return nil
  }

  /// Depth-first, the order the overlay draws in.
  public func flattened() -> [Inspection.Node] {
    var out: [Inspection.Node] = []
    walk { out.append($0) }
    return out
  }

  public func walk(_ visit: (Inspection.Node) -> Void) {
    visit(self)
    for child in children { child.walk(visit) }
  }

  public func find(_ id: String) -> Inspection.Node? {
    if self.id == id { return self }
    for child in children {
      if let hit = child.find(id) { return hit }
    }
    return nil
  }

  /// Root down to `id`, inclusive; empty when it isn't in the tree.
  public func path(to id: String) -> [Inspection.Node] {
    if self.id == id { return [self] }
    for child in children {
      let sub = child.path(to: id)
      if !sub.isEmpty { return [self] + sub }
    }
    return []
  }

  /// child id → parent id. Ids are opaque pointers, so ancestry comes from the walk.
  public func parentMap() -> [String: String] {
    var parents: [String: String] = [:]
    func visit(_ node: Inspection.Node) {
      for child in node.children {
        parents[child.id] = node.id
        visit(child)
      }
    }
    visit(self)
    return parents
  }

  /// Case-insensitive match on class, text and identifiers; blank queries match nothing.
  public func matches(_ query: String) -> Bool {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    guard !q.isEmpty else { return false }
    let fields = [
      className, text, title, placeholder, accessibilityLabel, accessibilityIdentifier,
      rn?.testID, rn?.nativeID,
    ]
    return fields.contains { $0?.lowercased().contains(q) == true }
  }

  /// Matches in depth-first order; drives next/previous navigation.
  public func searchMatches(_ query: String) -> [Inspection.Node] {
    guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
    var hits: [Inspection.Node] = []
    walk { if $0.matches(query) { hits.append($0) } }
    return hits
  }

  /// Every node under the point, outermost first. Walks the whole tree: some
  /// zero-size containers hold children with real frames.
  public func nodes(containingX x: Double, y: Double) -> [Inspection.Node] {
    var hits: [Inspection.Node] = []
    walk { if $0.rect.contains(x: x, y: y) { hits.append($0) } }
    return hits
  }

  /// The rows a tree shows for an expansion set, with indent relative to `self`.
  public func visibleRows(expanded: Set<String>) -> [(node: Inspection.Node, level: Int)] {
    var out: [(node: Inspection.Node, level: Int)] = []
    func visit(_ node: Inspection.Node, _ level: Int) {
      out.append((node, level))
      guard expanded.contains(node.id) else { return }
      for child in node.children { visit(child, level + 1) }
    }
    visit(self, 0)
    return out
  }
}

extension Inspection {
  /// Strict ancestors of `id`, innermost first.
  public static func ancestors(of id: String, in parents: [String: String]) -> [String] {
    var out: [String] = []
    var cursor = parents[id]
    while let next = cursor {
      out.append(next)
      cursor = parents[next]
    }
    return out
  }

  /// Every id plus all its ancestors — keeps search hits reachable in the tree.
  public static func withAncestors(_ ids: [String], in parents: [String: String]) -> Set<String> {
    var set = Set(ids)
    for id in ids { set.formUnion(ancestors(of: id, in: parents)) }
    return set
  }

  /// Only UIKit text controls take a native `text`/`textColor` set; RN text
  /// renders from React state, so editing it there always fails.
  public static let textSettableClasses: Set<String> = [
    "UILabel", "UITextField", "UITextView", "UIButton",
  ]

  /// The search hit after (or before) the selection, wrapping; the first or
  /// last hit when the selection isn't one.
  public static func step(
    _ matches: [Node], from selected: String?, forward: Bool
  ) -> String? {
    guard !matches.isEmpty else { return nil }
    guard let index = matches.firstIndex(where: { $0.id == selected }) else {
      return forward ? matches.first?.id : matches.last?.id
    }
    let next = (index + (forward ? 1 : -1) + matches.count) % matches.count
    return matches[next].id
  }

  /// A coordinate rounded to two decimals, trailing zeros stripped.
  public static func format(_ n: Double) -> String {
    guard n.isFinite else { return "0" }
    let rounded = (n * 100).rounded() / 100
    return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
  }

  static func truncate(_ s: String, _ max: Int) -> String {
    s.count <= max ? s : "\(s.prefix(max - 1))…"
  }
}
