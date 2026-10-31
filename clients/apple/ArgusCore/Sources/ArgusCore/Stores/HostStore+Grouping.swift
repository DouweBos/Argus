import Foundation

/// Agents by session and project, live status laid over, in the order both apps list them.
extension HostStore {
  /// A session's agents, oldest first.
  public func agents(inSession session: RemoteSession) -> [RemoteAgentStatus] {
    let listed = (agentsByRepo[session.repoRoot] ?? []).filter { $0.sessionId == session.id }
    return AgentOrder.byCreation(AgentOrder.overlaid(listed, live: statusByAgent))
  }

  /// The same, plus any only the cross-project list has yet — for a session
  /// opened before its project's agents load.
  public func agents(inSessionId id: String, repoRoot: String) -> [RemoteAgentStatus] {
    var seen = Set<String>()
    let listed = ((agentsByRepo[repoRoot] ?? []) + recentAgents)
      .filter { $0.sessionId == id && seen.insert($0.agentId).inserted }
    return AgentOrder.byCreation(AgentOrder.overlaid(listed, live: statusByAgent))
  }

  /// Every agent across projects: what wants you first, then the most recent.
  public var recentAgentsByActivity: [RemoteAgentStatus] {
    AgentOrder.byActivity(AgentOrder.overlaid(recentAgents, live: statusByAgent))
  }

  /// A project's agents, from its own list and the cross-project one. An agent
  /// is placed by its session; by project name only while the sessions are
  /// unknown and no other project shares the name.
  public func agents(inProject repoRoot: String) -> [RemoteAgentStatus] {
    var seen = Set<String>()
    let own = (agentsByRepo[repoRoot] ?? []).filter { seen.insert($0.agentId).inserted }
    let sessionIds = sessionsByRepo[repoRoot].map { Set($0.map(\.id)) }
    let name = projects.first { $0.repoRoot == repoRoot }?.name
    let nameIsUnique = name.map { name in projects.filter { $0.name == name }.count == 1 } ?? false
    let recent = recentAgents.filter { agent in
      guard !seen.contains(agent.agentId) else { return false }
      if let sessionIds { return sessionIds.contains(agent.sessionId) }
      return nameIsUnique && agent.projectName == name
    }
    return own + recent
  }

  /// A project's sessions with their agents, the project root first.
  public func sessionGroups(repoRoot: String) -> [SessionGroup] {
    SessionGroup.make(
      sessions: sessionsByRepo[repoRoot] ?? [], agents: agents(inProject: repoRoot), live: statusByAgent)
  }
}
