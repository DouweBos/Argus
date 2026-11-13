import ArgusKit

/// Sessions stacked on one another: each child branches from its parent's branch.
public enum SessionStack {
  public struct Entry: Identifiable, Hashable, Sendable {
    public let session: RemoteSession
    /// 0 for a session on the base branch, 1 for one stacked on it, and so on.
    public let depth: Int
    public var id: String { session.id }
  }

  /// An item placed in a list that may split a stack, as the attention sections do.
  public struct Placed<Item> {
    public let item: Item
    /// Depth under parents in the same list; a child whose parent is elsewhere starts at 0.
    public let depth: Int
    /// Its parent, when that sits in another list (a different section, folded away).
    public let parentElsewhere: RemoteSession?
  }

  /// `items` in their order, each stacked one moved under its parent when the
  /// parent is in the same list. Items with no session stay where they are.
  public static func place<Item>(
    _ items: [Item], session: (Item) -> RemoteSession?, all: [RemoteSession] = []
  ) -> [Placed<Item>] {
    let ids = Set(items.compactMap { session($0)?.id })
    let byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    func parentHere(_ item: Item) -> String? {
      session(item)?.parentSessionId.flatMap { ids.contains($0) ? $0 : nil }
    }
    let children = Dictionary(grouping: items.filter { parentHere($0) != nil }) { parentHere($0) ?? "" }
    var out: [Placed<Item>] = []
    var seen = Set<Int>()
    let index = Dictionary(
      items.enumerated().compactMap { i, item in session(item).map { ($0.id, i) } },
      uniquingKeysWith: { a, _ in a })
    func visit(_ i: Int, _ depth: Int) {
      guard seen.insert(i).inserted else { return }
      let item = items[i]
      let parentId = session(item)?.parentSessionId
      let elsewhere = depth == 0 ? parentId.flatMap { ids.contains($0) ? nil : byId[$0] } : nil
      out.append(Placed(item: item, depth: depth, parentElsewhere: elsewhere))
      guard let id = session(item)?.id else { return }
      for child in children[id] ?? [] {
        if let ci = session(child).flatMap({ index[$0.id] }) { visit(ci, depth + 1) }
      }
    }
    for (i, item) in items.enumerated() where parentHere(item) == nil { visit(i, 0) }
    // A parent cycle has no top; keep its sessions rather than drop them.
    for i in items.indices where !seen.contains(i) { visit(i, 0) }
    return out
  }

  /// `sessions` in their order, with every stacked session moved under its
  /// parent. A parent that isn't in the list leaves its child at the top level.
  public static func ordered(_ sessions: [RemoteSession]) -> [Entry] {
    place(sessions, session: { $0 }).map { Entry(session: $0.item, depth: $0.depth) }
  }

  /// Where stack placement put a session: its depth, and its parent when that's in another list.
  public struct Nesting: Hashable, Sendable {
    public let depth: Int
    public let parentElsewhere: RemoteSession?

    public static let none = Nesting(depth: 0, parentElsewhere: nil)

    /// "On top of …" when its parent is in another list.
    public var caption: String? { SessionStack.caption(parentElsewhere: parentElsewhere) }
  }

  /// `items` reordered so stacked sessions follow their parents, with each one's nesting by id.
  /// Compare runs group from this order: a compare slot is never stacked, so it keeps its place.
  public static func arrange<Item>(
    _ items: [Item], session: (Item) -> RemoteSession?, all: [RemoteSession]
  ) -> (items: [Item], nesting: [String: Nesting]) {
    let placed = place(items, session: session, all: all)
    var nesting: [String: Nesting] = [:]
    for entry in placed {
      if let id = session(entry.item)?.id {
        nesting[id] = Nesting(depth: entry.depth, parentElsewhere: entry.parentElsewhere)
      }
    }
    return (placed.map(\.item), nesting)
  }

  /// "On top of …", for a stacked session shown away from its parent.
  public static func caption(parentElsewhere parent: RemoteSession?) -> String? {
    parent.map { "On top of \($0.displayName ?? $0.branch)" }
  }

  /// How many sessions each one is stacked on, for indenting its row.
  public static func depths(_ sessions: [RemoteSession]) -> [String: Int] {
    Dictionary(ordered(sessions).map { ($0.id, $0.depth) }, uniquingKeysWith: { a, _ in a })
  }

  /// The bottom of the session's stack.
  public static func root(of id: String, in sessions: [RemoteSession]) -> RemoteSession? {
    let byId = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    var current = byId[id]
    var seen = Set<String>()
    while let session = current, let parent = session.parentSessionId.flatMap({ byId[$0] }),
      seen.insert(session.id).inserted
    {
      current = parent
    }
    return current
  }

  /// Every session in the same stack as `id`, bottom first; empty when it isn't stacked.
  public static func members(of id: String, in sessions: [RemoteSession]) -> [RemoteSession] {
    guard let root = root(of: id, in: sessions) else { return [] }
    let ordered = ordered(sessions)
    guard let start = ordered.firstIndex(where: { $0.id == root.id }) else { return [] }
    var members = [ordered[start].session]
    for entry in ordered[(start + 1)...] {
      guard entry.depth > 0 else { break }
      members.append(entry.session)
    }
    return members.count > 1 ? members : []
  }
}
