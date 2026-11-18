import ArgusKit

/// Newest message first. A compare run sorts by its newest slot and a stack by its
/// newest session, so each stays together; sessions with no message keep their order, last.
public enum SessionRecency {
  public static func sorted<Item>(_ items: [Item], session: (Item) -> RemoteSession?) -> [Item] {
    let sessions = items.map(session)
    let byId = Dictionary(sessions.compactMap { $0.map { ($0.id, $0) } }, uniquingKeysWith: { a, _ in a })
    // A run, else the bottom of its stack in this list, else itself.
    func unit(_ index: Int) -> String {
      guard let s = sessions[index] else { return "item:\(index)" }
      if let run = s.compareGroup?.id { return "run:\(run)" }
      var current = s
      var seen: Set<String> = [s.id]
      while let parent = current.parentSessionId.flatMap({ byId[$0] }), seen.insert(parent.id).inserted {
        current = parent
      }
      return current.id
    }
    let units = items.indices.map(unit)
    var newest: [String: Double] = [:]
    var first: [String: Int] = [:]
    for (index, key) in units.enumerated() {
      first[key] = first[key] ?? index
      if let at = sessions[index]?.lastMessageAt { newest[key] = max(newest[key] ?? at, at) }
    }
    let order = items.indices.sorted { a, b in
      let (ua, ub) = (units[a], units[b])
      switch (newest[ua], newest[ub]) {
      case (let x?, let y?) where x != y: return x > y
      case (.some, nil): return true
      case (nil, .some): return false
      default:
        let (fa, fb) = (first[ua] ?? a, first[ub] ?? b)
        return fa != fb ? fa < fb : a < b
      }
    }
    return order.map { items[$0] }
  }

  public static func sorted(_ sessions: [RemoteSession]) -> [RemoteSession] {
    sorted(sessions) { $0 }
  }
}
