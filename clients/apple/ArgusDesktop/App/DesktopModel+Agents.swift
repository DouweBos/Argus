import AppKit
import ArgusCore
import ArgusKit
import Foundation

/// A session's agents and what the Agent menu, the palette and the tab bar do
/// with them.
extension DesktopModel {
  /// The host's agents in a session, oldest first, each with the latest
  /// status (and title) it announced laid over the listed one.
  func agents(inSession id: String) -> [RemoteAgentStatus] {
    guard let session = session(id) else { return [] }
    return (store.agentsByRepo[session.repoRoot] ?? [])
      .filter { $0.sessionId == id }
      .map { store.statusByAgent[$0.agentId] ?? $0 }
      .sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
  }

  /// The routed agent, else the first — a session always shows something.
  /// One just spawned (a resumed chat) is routed to before any list has it.
  func focusedAgentId(inSession id: String, agents: [RemoteAgentStatus]) -> String? {
    route.agentId.flatMap { agentId in
      agents.contains { $0.agentId == agentId } || spawnedAgent == agentId ? agentId : nil
    } ?? agents.first?.agentId
  }

  /// The agent the Agent menu acts on: the one in front on a session's Agents panel.
  var agentInFront: RemoteAgentStatus? {
    guard case .session(let id, _) = route else { return nil }
    let agents = agents(inSession: id)
    let focused = focusedAgentId(inSession: id, agents: agents)
    return agents.first { $0.agentId == focused }
  }

  /// Closing an agent tab stops its agent, as in the desktop app; its
  /// transcript is saved first.
  func closeAgent(_ agentId: String, inSession sessionId: String) {
    let agents = agents(inSession: sessionId)
    // The neighbour takes over, as on the desktop; the route never names a closed agent.
    if agentId == focusedAgentId(inSession: sessionId, agents: agents),
      let index = agents.firstIndex(where: { $0.agentId == agentId })
    {
      let rest = agents.filter { $0.agentId != agentId }
      let next = rest.isEmpty ? nil : rest[min(max(index - 1, 0), rest.count - 1)].agentId
      navigate(.session(id: sessionId, agentId: next))
    }
    Task { await store.stopAgent(agentId: agentId) }
  }

  /// Closes several tabs at once; the focus falls to the nearest one left open.
  func closeAgents(_ ids: [String], inSession sessionId: String) {
    let agents = agents(inSession: sessionId)
    let closing = Set(ids)
    if let focused = focusedAgentId(inSession: sessionId, agents: agents), closing.contains(focused) {
      let index = agents.firstIndex { $0.agentId == focused } ?? 0
      let before = agents[..<index].last { !closing.contains($0.agentId) }
      let after = agents[index...].first { !closing.contains($0.agentId) }
      navigate(.session(id: sessionId, agentId: (before ?? after)?.agentId))
    }
    Task { for id in ids { await store.stopAgent(agentId: id) } }
  }

  func renameAgent(_ agentId: String, to title: String) {
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, let backend = store.backend else { return }
    Task { _ = try? await backend.request(ArgusProtocol.Commands.SetAgentTitle.self, .init(agentId: agentId, title: title)) }
  }

  /// Shows the session's checkout in Finder; only this Mac's sessions have a path here.
  func revealSessionInFinder(_ sessionId: String) {
    guard host(ofSession: sessionId) == Hosts.local, let backend = store.backend else { return }
    Task {
      guard let path = (try? await backend.request(ArgusProtocol.Commands.GetSession.self, .init(id: sessionId)))??.path
      else { return }
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }
  }

  /// The session on screen, when it can take a new agent.
  var sessionReadyForAgent: String? {
    guard let id = route.sessionId, session(id)?.status == .ready else { return nil }
    return id
  }

  /// Starts an agent and brings its tab to the front.
  func startAgent(inSession id: String, mode: RemotePermissionMode? = nil) {
    Task {
      guard let agentId = await startAgent(sessionId: id, mode: mode) else { return }
      open(spawned: agentId, session: id)
    }
  }

  /// The next or previous agent tab, wrapping, as ⇧⌘] and ⇧⌘[ do on the desktop.
  func cycleAgent(by offset: Int) {
    guard case .session(let id, _) = route else { return }
    let agents = agents(inSession: id)
    guard let next = Self.cycled(agents.map(\.agentId), from: focusedAgentId(inSession: id, agents: agents), by: offset)
    else { return }
    navigate(.session(id: id, agentId: next))
  }

  /// The session's nth agent tab (0-based); nothing when there isn't one.
  func selectAgent(at index: Int) {
    guard let id = route.sessionId else { return }
    let agents = agents(inSession: id)
    guard agents.indices.contains(index) else { return }
    navigate(.session(id: id, agentId: agents[index].agentId))
  }

  nonisolated static func cycled(_ ids: [String], from current: String?, by offset: Int) -> String? {
    guard ids.count > 1, let current, let index = ids.firstIndex(of: current) else { return nil }
    return ids[((index + offset) % ids.count + ids.count) % ids.count]
  }

  func interruptAgentInFront() {
    guard let agent = agentInFront, agent.status == .running else { return }
    Task { await store.interrupt(agentId: agent.agentId) }
  }

  /// Puts the caret in the chat input of the agent in front.
  func focusComposer() {
    composerFocusRequest += 1
  }
}
