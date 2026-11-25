import ArgusCore
import ArgusKit
import ArgusUI

/// The palette's jumps to a chat, terminal or open file, read from the stores.
extension BuiltinPalette {
  static func jumps(_ model: DesktopModel) -> [PaletteCommand] {
    let store = model.store
    let sessions = store.projects.flatMap { project in
      (store.sessionsByRepo[project.repoRoot] ?? []).map { session in
        let name = session.displayName ?? session.branch
        return (session, PaletteJumps.Place(sessionId: session.id, name: name, project: project.name))
      }
    }
    let places = sessions.map(\.1)
    let current = model.route.sessionId
    var live: [String: [PaletteJumps.LiveChat]] = [:]
    var saved: [String: [PaletteJumps.SavedChat]] = [:]
    var terminals: [String: [PaletteJumps.Terminal]] = [:]
    var files: [String: [String]] = [:]
    for (session, _) in sessions {
      let agents = store.agents(inSessionId: session.id, repoRoot: session.repoRoot)
      live[session.id] = agents.map {
        .init(
          agentId: $0.agentId, title: Labels.agentName($0, among: agents),
          lastActive: $0.lastActivityAt ?? $0.createdAt ?? 0, runnerSessionId: $0.runnerSessionId)
      }
      saved[session.id] = (store.chats(in: session) ?? []).map {
        .init(historyId: $0.historyId, title: $0.title, endedAt: $0.endedAt, runnerSessionId: $0.runnerSessionId)
      }
      terminals[session.id] = model.terminals.tabs(session.id).map {
        .init(id: $0.id, title: $0.title, isRun: $0.isRun)
      }
      files[session.id] = model.code.sessions[session.id]?.tabs.paths
    }
    let jumps =
      PaletteJumps.chats(places, live: live, saved: saved, current: current)
      + PaletteJumps.terminals(places, tabs: terminals, current: current)
      + PaletteJumps.files(places, tabs: files, current: current)
    return jumps.map { jump in
      PaletteCommand(
        id: jump.id, title: jump.title, section: jump.section, subtitle: jump.subtitle, keywords: jump.keywords,
        systemImage: jump.systemImage
      ) { go(to: jump.target, model) }
    }
  }

  /// One navigation per pick; a terminal also brings its tab up in the session's side panel.
  private static func go(to target: PaletteJumps.Target, _ model: DesktopModel) {
    switch target {
    case .agent(let sessionId, let agentId):
      model.navigate(.session(id: sessionId, agentId: agentId))
    case .savedChat(let sessionId, let historyId):
      guard let session = model.store.session(id: sessionId),
        let chat = model.store.stoppedChat(repoRoot: session.repoRoot, historyId: historyId)
      else { return }
      Task {
        guard let agent = await model.store.resumeChat(chat, sessionId: sessionId) else { return }
        model.open(spawned: agent.agentId, session: sessionId)
      }
    case .terminal(let sessionId, let terminalId):
      if model.route.sessionId != sessionId { model.open(session: sessionId) }
      model.showTerminal(terminalId, session: sessionId)
      MacTelemetry.capture(.panelTabOpened(kind: .terminal, via: .palette))
    case .file(let sessionId, let path):
      model.navigate(.sessionCode(id: sessionId, path: path, line: nil))
    }
  }

  /// Saved chats are fetched per project on demand: the current one's fresh, the rest once.
  static func loadSavedChats(_ model: DesktopModel) async {
    let currentRepo = model.route.sessionId.flatMap { model.store.session(id: $0)?.repoRoot }
    for project in model.store.projects
    where project.repoRoot == currentRepo || model.store.stoppedByRepo[project.repoRoot] == nil {
      await model.store.loadStoppedAgents(repoRoot: project.repoRoot)
    }
  }
}
