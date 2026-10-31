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
    for session in sessions where byId[session.id] == nil {
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
