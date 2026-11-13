import Foundation

/// How agent lists are ordered. Every list lays the live status over the
/// listed one first, so a running agent sorts (and reads) as running.
public enum AgentOrder {
  /// Each agent with the latest status (and title) it announced, where there is one.
  public static func overlaid(_ agents: [RemoteAgentStatus], live: [String: RemoteAgentStatus]) -> [RemoteAgentStatus] {
    agents.map { live[$0.agentId] ?? $0 }
  }

  /// What wants you first, then the most recently active.
  public static func byActivity(_ agents: [RemoteAgentStatus]) -> [RemoteAgentStatus] {
    agents.sorted {
      let (left, right) = (Labels.activityRank($0), Labels.activityRank($1))
      return left != right ? left < right : Labels.lastActivity($0) > Labels.lastActivity($1)
    }
  }

  /// Oldest first: a session's agents in the order its tabs opened.
  public static func byCreation(_ agents: [RemoteAgentStatus]) -> [RemoteAgentStatus] {
    agents.sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
  }

  /// A session screen's tabs, oldest first: its live agents, plus the `kept` ones it has
  /// shown that stopped since, so a shut-down tab stays (with its Resume) until closed.
  public static func sessionTabs(
    listed: [RemoteAgentStatus], kept: [String], status: (String) -> RemoteAgentStatus?, isGone: (String) -> Bool
  ) -> [RemoteAgentStatus] {
    let keep = Set(kept)
    var tabs = listed.filter { !isGone($0.agentId) || keep.contains($0.agentId) }
    for id in kept where !tabs.contains(where: { $0.agentId == id }) {
      if let agent = status(id) { tabs.append(agent) }
    }
    return byCreation(tabs)
  }

  /// `agents` in a dragged `order`: the ones it names first, in its order, then the rest
  /// (agents opened since) as they came.
  public static func arranged(_ agents: [RemoteAgentStatus], by order: [String]?) -> [RemoteAgentStatus] {
    guard let order, !order.isEmpty else { return agents }
    let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
    let placed = agents.compactMap { agent in rank[agent.agentId].map { (agent, $0) } }
      .sorted { $0.1 < $1.1 }.map(\.0)
    return placed + agents.filter { rank[$0.agentId] == nil }
  }

  /// `ids` with `id` dropped into `target`'s slot; nil when that changes nothing.
  public static func moved(_ id: String, to target: String, in ids: [String]) -> [String]? {
    guard id != target, let from = ids.firstIndex(of: id), let to = ids.firstIndex(of: target) else { return nil }
    var next = ids
    next.insert(next.remove(at: from), at: to)
    return next
  }

  /// The tab that takes over when `closing` closes: the one before it, else the one after.
  public static func neighbour(of closing: String, in ids: [String]) -> String? {
    guard let index = ids.firstIndex(of: closing) else { return ids.first }
    let rest = ids.filter { $0 != closing }
    return rest.isEmpty ? nil : rest[min(max(index - 1, 0), rest.count - 1)]
  }

  /// The next or previous of `ids` from `current`, wrapping; nil when there is nowhere to go.
  public static func cycled(_ ids: [String], from current: String?, by offset: Int) -> String? {
    guard ids.count > 1, let current, let index = ids.firstIndex(of: current) else { return nil }
    return ids[((index + offset) % ids.count + ids.count) % ids.count]
  }
}

/// A session and the agents in it, as both apps list a project.
public struct SessionGroup: Identifiable, Hashable, Sendable {
  public var id: String
  /// The session's name, else its branch; the agents' label when the session isn't listed yet.
  public var label: String
  /// Nil when only its agents are known, before the project's sessions load.
  public var session: RemoteSession?
  /// Oldest first, live status laid over.
  public var agents: [RemoteAgentStatus]

  public var isRoot: Bool { session?.kind == .projectRoot }

  public init(id: String, label: String, session: RemoteSession?, agents: [RemoteAgentStatus]) {
    self.id = id
    self.label = label
    self.session = session
    self.agents = agents
  }

  /// The project root first, then the sessions in the host's order, then any
  /// session only its agents mention.
  public static func make(
    sessions: [RemoteSession], agents: [RemoteAgentStatus], live: [String: RemoteAgentStatus] = [:]
  ) -> [SessionGroup] {
    var order: [String] = []
    var byId: [String: SessionGroup] = [:]
    // Stacked sessions follow their parent, as the Mac sidebar draws them.
    for session in SessionStack.ordered(sessions).map(\.session) where byId[session.id] == nil {
      order.append(session.id)
      byId[session.id] = SessionGroup(
        id: session.id, label: session.displayName ?? session.branch, session: session, agents: [])
    }
    for agent in AgentOrder.overlaid(agents, live: live) {
      if byId[agent.sessionId] == nil {
        order.append(agent.sessionId)
        byId[agent.sessionId] = SessionGroup(
          id: agent.sessionId, label: agent.sessionLabel ?? "Session", session: nil, agents: [])
      }
      byId[agent.sessionId]?.agents.append(agent)
    }
    let groups = order.compactMap { byId[$0] }.map { group in
      var sorted = group
      sorted.agents = AgentOrder.byCreation(group.agents)
      return sorted
    }
    return groups.filter(\.isRoot) + groups.filter { !$0.isRoot }
  }
}

/// The sidebar's search and narrowing, as plain functions over the lists.
public enum SessionSearch {
  /// Case- and diacritic-blind; an empty query matches nothing.
  public static func matches(_ text: String, query: String) -> Bool {
    let query = query.trimmingCharacters(in: .whitespaces)
    return !query.isEmpty && text.localizedCaseInsensitiveContains(query)
  }

  /// A session matches by its title, its branch or its project's name.
  public static func matches(_ session: RemoteSession, projectName: String?, query: String) -> Bool {
    [projectName ?? "", session.displayName ?? "", session.branch].contains { matches($0, query: query) }
  }

  /// Worktrees to list: the search's matches, else all unless folded shut.
  public static func visibleWorktrees(_ worktrees: [RemoteSession], shown: Set<String>?, collapsed: Bool)
    -> [RemoteSession]
  {
    if let shown { return worktrees.filter { shown.contains($0.id) } }
    return collapsed ? [] : worktrees
  }

  /// Stable sort by the rank of whatever `key` names; unknown keys go last.
  public static func ordered<Item, Key: Hashable>(_ items: [Item], by order: [Key], key: (Item) -> Key) -> [Item] {
    let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
    return items.enumerated()
      .sorted { a, b in
        let (ra, rb) = (rank[key(a.element)] ?? .max, rank[key(b.element)] ?? .max)
        return ra == rb ? a.offset < b.offset : ra < rb
      }
      .map(\.element)
  }
}
