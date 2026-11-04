import ArgusKit
import Foundation

/// A local backend (the Mac's own host, and the hosts it routes to) follows
/// every agent rather than only the one on screen: tabs, the sidebar and the
/// quit prompt show each agent's status, and the per-agent raw channels below
/// only reach a subscribed connection. The conversations themselves are the
/// host's; this only listens.
extension HostStore {
  var followsAllAgents: Bool { backend?.kind == .local }

  /// Subscribe to every agent the host is running. Runs on attach and after
  /// every reconnect: subscriptions belong to a connection.
  public func followAgents() {
    guard followsAllAgents, let backend else { return }
    Task {
      guard
        let snapshot = try? await backend.request(
          ArgusProtocol.Commands.StateHydrate.self, EmptyParams())
      else { return }
      for agent in snapshot.agents {
        await backend.subscribe(agentId: agent.agentId, on: true)
      }
    }
  }

  /// The raw broadcasts a console connection gets that the typed events don't cover.
  func handleRawBroadcast(_ payload: JSONValue) {
    guard let ipc = try? ProtocolCodec.convert(payload, to: IpcPayload.self) else { return }
    let arg = ipc.args?.first ?? .null
    // A push, pull, fetch or commit anywhere moves the ahead/behind the sidebar shows.
    if ipc.channel == "git_status_changed", case .object(let body) = arg, let id = body["sessionId"]?.stringValue {
      Task { await refreshGitStatus(sessionId: id) }
      return
    }
    guard followsAllAgents else { return }
    switch ipc.channel {
    case "agent:started":
      guard let info = try? ProtocolCodec.convert(arg, to: StartedAgent.self) else { return }
      Task { await agentStarted(info) }
      return
    case "agent_notification_clicked":
      guard let click = try? ProtocolCodec.convert(arg, to: NotificationClick.self) else { return }
      hooks.agentNotificationClicked(click.agent_id, click.session_id)
      return
    case "session:progress":
      if let sessionId = arg.stringValue { Task { await listSessionRepo(sessionId) } }
      return
    default:
      break
    }

    let parts = ipc.channel.split(separator: ":", maxSplits: 2).map(String.init)
    guard parts.count == 3, parts[0] == "agent" else { return }
    let agentId = parts[2]
    switch parts[1] {
    case "exit":
      agentExited(agentId, code: Int(arg.numberValue ?? 0))
    case "effort-changed":
      effortByAgent[agentId] = arg.stringValue
    case "model-changed":
      if let model = arg.stringValue { patchStatus(agentId) { $0.model = model } }
    case "permission-mode-changed":
      let mode = arg.stringValue.flatMap { $0.isEmpty ? nil : $0 }
      patchStatus(agentId) { $0.permissionMode = mode }
    default:
      break
    }
  }

  /// An agent spawned anywhere — this app, the phone, MCP: follow it and list it.
  private func agentStarted(_ info: StartedAgent) async {
    await backend?.subscribe(agentId: info.agent_id, on: true)
    await reloadAgents(ofSession: info.session_id)
    // The Agents screen lists across projects and only loads on appear.
    if recentAgentsLoaded { await loadRecentAgents() }
  }

  /// Exits aren't a typed status: the host drops a stopped agent instead.
  func agentExited(_ agentId: String, code: Int) {
    let state: RemoteAgentState = code == 0 ? .stopped : .error
    patchStatus(agentId) { $0.status = state }
    if let sessionId = statusByAgent[agentId]?.sessionId {
      Task { await reloadAgents(ofSession: sessionId) }
    }
  }

  private func reloadAgents(ofSession sessionId: String) async {
    if let repoRoot = repoRoot(forSessionId: sessionId) {
      await loadAgents(repoRoot: repoRoot)
    } else {
      await loadRecentAgents()
    }
  }

  /// A session's progress is read from its listed row; list its repo if no
  /// view has yet. Once listed, `sessions.changed` keeps it fresh.
  private func listSessionRepo(_ sessionId: String) async {
    guard repoRoot(forSessionId: sessionId) == nil, let backend,
      let snapshot = try? await backend.request(
        ArgusProtocol.Commands.StateHydrate.self, EmptyParams()),
      let repoRoot = snapshot.sessions.first(where: { $0.id == sessionId })?.repoRoot,
      sessionsByRepo[repoRoot] == nil
    else { return }
    await loadSessions(repoRoot: repoRoot)
  }
}

private struct StartedAgent: Decodable {
  let agent_id: String
  let session_id: String
}

private struct NotificationClick: Decodable {
  let agent_id: String
  let session_id: String
}
