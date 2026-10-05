import ArgusUI
import SwiftUI

/// One session: its agents as tabs, the focused agent's transcript and input.
struct SessionView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(TerminalsStore.self) private var terminals
  let sessionId: String

  private var session: RemoteSession? {
    store.sessionsByRepo.values.joined().first { $0.id == sessionId }
      ?? store.scratchPads.first { $0.id == sessionId } ?? store.adoptedSessions[sessionId]
  }

  /// Live agents first — they appear the moment the host starts them — with
  /// the host's last status laid over for title and attention.
  private var agents: [RemoteAgentStatus] {
    guard let session else { return [] }
    let listed = (store.agentsByRepo[session.repoRoot] ?? []).filter { $0.sessionId == sessionId }
    guard let live = store.live else {
      return listed.sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
    }
    return live.agents(inSession: sessionId).compactMap { agent in
      guard
        var status = store.statusByAgent[agent.id] ?? listed.first(where: { $0.agentId == agent.id })
          ?? Self.placeholder(agentId: agent.id, sessionId: sessionId)
      else { return nil }
      status.status = agent.status
      status.title = live.conversation(for: agent.id)?.title ?? status.title
      return status
    }
  }

  /// An agent the host hasn't described yet; the wire type has no public init.
  private static func placeholder(agentId: String, sessionId: String) -> RemoteAgentStatus? {
    try? ProtocolCodec.convert(
      .object([
        "agent_id": .string(agentId), "session_id": .string(sessionId),
        "status": .string("running"),
      ]), to: RemoteAgentStatus.self)
  }

  private func startAgent() { startAgent(mode: nil) }

  private func startAgent(mode: RemotePermissionMode?) {
    Task {
      // Settings' default applies unless the caller picked a mode, as on the desktop.
      let fallback = AppPreferences.shared.defaultPermissionMode
      if let remoteMode = mode ?? RemotePermissionMode(rawValue: fallback.rawValue) {
        guard let agent = await store.spawnAgent(sessionId: sessionId, permissionMode: remoteMode)
        else { return }
        model.navigate(.session(id: sessionId, agentId: agent.agentId))
      } else {
        await startTrusted(fallback.rawValue)
      }
    }
  }

  /// `trusted` is a CLI flag fixed at launch, and the gateway's spawn refuses
  /// it; the admin command takes any mode and announces the agent the same way.
  private func startTrusted(_ mode: String) async {
    guard let backend = store.backend else { return }
    do {
      let info = try await backend.request(
        ArgusProtocol.Commands.StartAgent.self, .init(sessionId: sessionId, permissionMode: mode))
      if let repoRoot = session?.repoRoot { await store.loadAgents(repoRoot: repoRoot) }
      model.navigate(.session(id: sessionId, agentId: info.agentId))
    } catch {
      store.report(error)
    }
  }

  /// Closing a tab stops its agent, as in the desktop app; its transcript is
  /// saved first.
  private func closeAgent(_ agentId: String) {
    Task {
      await store.stopAgent(agentId: agentId)
      await store.live?.forget(agentId)
    }
  }

  /// The routed agent, else the first — a session always shows something.
  private var focusedAgentId: String? {
    model.route.agentId.flatMap { id in agents.contains { $0.agentId == id } ? id : nil }
      ?? agents.first?.agentId
  }

  var body: some View {
    ResizableVSplit(
      key: "session.terminal", topMin: 240, bottomMin: 120, bottomIdeal: 280,
      showsBottom: model.terminalPanelVisible && session?.status == .ready
    ) {
      Group {
        if case .sessionHome = model.route, let session {
          SessionHomeView(session: session, sessionAgents: agents, startAgent: startAgent(mode:))
            .id(session.id)
        } else if let gitView = model.route.gitView, let session {
          if session.status == .ready {
            GitScreen(session: session, view: gitView)
          } else {
            SessionSetupView(
              session: session, progress: store.live?.setupProgress(sessionId: sessionId) ?? session.progress)
          }
        } else {
          agentsPane
        }
      }
    } bottom: {
      if let session { TerminalPanel(session: session) }
    }
    .toolbar {
      ToolbarItem(placement: .navigation) {
        Picker("Panel", selection: panel) {
          Text("Home").tag(SessionPanel.home)
          Text("Agents").tag(SessionPanel.agents)
          Text("Git").tag(SessionPanel.git)
        }
        .pickerStyle(.segmented)
        .fixedSize()
      }
      if let session, session.status == .ready {
        ToolbarItemGroup {
          HuddleToolbarButton(sessionId: session.id)
          RunControl(session: session) { model.terminalPanelVisible = true }
          Button {
            model.terminalPanelVisible.toggle()
          } label: {
            Label("Terminal", systemImage: "terminal")
          }
          .help(model.terminalPanelVisible ? "Hide terminal (⇧⌘T)" : "Show terminal (⇧⌘T)")
        }
      }
    }
    // An agent's `trigger_run` shows its output, as the desktop app does.
    .onChange(of: terminals.revealed) { _, reveal in
      if reveal?.sessionId == sessionId { model.terminalPanelVisible = true }
    }
    .navigationTitle(session?.displayName ?? session?.branch ?? "Session")
    .navigationSubtitle(session?.branch ?? "")
    .task(id: session?.repoRoot) {
      if let repoRoot = session?.repoRoot { await store.loadAgents(repoRoot: repoRoot) }
    }
    // The run control reads the project's run commands and which are going.
    .task(id: session?.status == .ready ? sessionId : nil) {
      guard let session, session.status == .ready else { return }
      await terminals.loadConfig(repoRoot: session.repoRoot)
      await terminals.refresh(sessionId: sessionId)
    }
  }

  /// Home, agents or git — a route per panel, as in the desktop app.
  private var panel: Binding<SessionPanel> {
    Binding(
      get: {
        switch model.route {
        case .session: .agents
        case .sessionGit: .git
        default: .home
        }
      },
      set: { panel in
        switch panel {
        case .home: model.navigate(.sessionHome(id: sessionId))
        case .agents: model.navigate(.session(id: sessionId, agentId: nil))
        case .git: model.openGit(session: sessionId)
        }
      })
  }

  private var agentsPane: some View {
    VStack(spacing: 0) {
      AgentTabBar(
        agents: agents, focused: focusedAgentId, canStart: session?.status == .ready,
        select: { model.navigate(.session(id: sessionId, agentId: $0)) },
        start: startAgent, close: closeAgent)
      Divider()
      if let session, session.status != .ready {
        SessionSetupView(
          session: session, progress: store.live?.setupProgress(sessionId: sessionId) ?? session.progress)
      } else if let agentId = focusedAgentId {
        AgentPane(agentId: agentId, sessionId: sessionId)
          .id(agentId)
      } else {
        ContentUnavailableView {
          Label("No agents", systemImage: "sparkles")
        } description: {
          Text("Start an agent to work in this session.")
        } actions: {
          Button("Start Agent", action: startAgent)
            .buttonStyle(.borderedProminent)
            .disabled(session?.status != .ready)
        }
        .frame(maxHeight: .infinity)
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .background {
      // ⌘T, as for a new tab.
      Button("New Agent", action: startAgent)
        .keyboardShortcut("t", modifiers: .command)
        .hidden()
    }
  }
}

enum SessionPanel: Hashable {
  case home, agents, git
}

struct AgentTabBar: View {
  @Environment(HostStore.self) private var store
  let agents: [RemoteAgentStatus]
  let focused: String?
  let canStart: Bool
  let select: (String) -> Void
  let start: () -> Void
  let close: (String) -> Void

  var body: some View {
    HStack(spacing: 4) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
          ForEach(agents) { agent in
            AgentTab(
              agent: agent, selected: agent.agentId == focused,
              children: childCounts[agent.agentId] ?? 0,
              subagentsRunning: subagentsRunning(agent.agentId),
              select: { select(agent.agentId) }, close: { close(agent.agentId) })
          }
        }
      }
      Button(action: start) {
        Image(systemName: "plus")
      }
      .buttonStyle(.borderless)
      .disabled(!canStart)
      .help("New agent (⌘T)")
    }
    .padding(.horizontal, 8)
    // A scroll view takes all the height it's offered; a tab bar is one row.
    .frame(height: 38)
  }

  /// Agents each agent spawned, across every agent the host has described.
  private var childCounts: [String: Int] {
    var counts: [String: Int] = [:]
    for agent in store.statusByAgent.values {
      if let parent = agent.parentAgentId { counts[parent, default: 0] += 1 }
    }
    return counts
  }

  /// A Task/Agent call still without a result: a subagent is at work, even
  /// when the CLI reports its parent idle.
  private func subagentsRunning(_ agentId: String) -> Bool {
    store.live?.conversation(for: agentId)?.messages.contains { message in
      message.toolCalls.contains {
        ($0.name == "Task" || $0.name == "Agent") && $0.result == nil && $0.pendingPermission != true
      }
    } ?? false
  }
}

/// One tab: status, title, and a close button that stops the agent, as in
/// the desktop app.
struct AgentTab: View {
  let agent: RemoteAgentStatus
  let selected: Bool
  /// Agents this one spawned.
  var children = 0
  var subagentsRunning = false
  let select: () -> Void
  let close: () -> Void
  @State private var hovering = false

  private var running: Bool {
    agent.status == .running || (agent.status == .idle && subagentsRunning)
  }

  var body: some View {
    HStack(spacing: 6) {
      Button(action: select) {
        HStack(spacing: 6) {
          StatusDot(
            tone: agent.awaiting != nil ? .warning : (running ? RemoteAgentState.running.tone : agent.status.tone),
            pulse: running)
          if agent.parentAgentId != nil {
            Image(systemName: "arrow.turn.down.right")
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(.secondary)
              .help("Spawned by another agent")
              .accessibilityLabel("Subagent")
          }
          Text(agent.title ?? "Agent").lineLimit(1)
          if children > 0 {
            Badge(label: "\(children)", tone: .accent)
              .help("\(children) subagent\(children == 1 ? "" : "s")")
          }
        }
      }
      .buttonStyle(.plain)
      Button(action: close) {
        Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .opacity(selected || hovering ? 1 : 0)
      .help("Close agent")
    }
    .padding(.leading, 10)
    .padding(.trailing, 8)
    .padding(.vertical, 5)
    .background(selected ? AnyShapeStyle(.selection) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 6))
    .onHover { hovering = $0 }
    .contextMenu {
      Button("Close Agent", action: close)
    }
  }
}

/// The focused agent: its transcript, kept live, and the input that drives it.
struct AgentPane: View {
  @Environment(HostStore.self) private var store
  let agentId: String
  let sessionId: String

  var body: some View {
    VStack(spacing: 0) {
      TranscriptView(agentKey: agentId, sessionId: sessionId, fixture: TranscriptStress.fixture)
      HuddleTypingBar(agentId: agentId)
      ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
        MacTelemetry.capture(.inputUsed(affordance: affordance.rawValue))
      }
    }
    .huddleAgent(agentId)
    .task {
      await store.watchAgent(agentId, on: true)
      await store.loadTranscript(agentId: agentId)
      await store.loadCapabilities(agentId: agentId)
      // A new agent has no status until its first event; the input's mode,
      // model and effort pills read it.
      if store.statusByAgent[agentId] == nil { await store.loadAgentStatus(agentId: agentId) }
    }
    .onDisappear {
      Task { await store.watchAgent(agentId, on: false) }
    }
  }
}

/// A session still being set up (or torn down), or one whose setup failed.
struct SessionSetupView: View {
  let session: RemoteSession
  /// The live `session:progress`, which runs ahead of the listed session.
  let progress: RemoteSessionProgress?

  var body: some View {
    VStack(spacing: 16) {
      switch session.status {
      case .error:
        SetupFailedRow(session: session).frame(maxWidth: 520)
      case .deleting:
        progress("Deleting the worktree…")
      default:
        progress("Setting up the worktree…")
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder
  private func progress(_ title: String) -> some View {
    Text(title).foregroundStyle(.secondary)
    if let fraction = progress?.fraction {
      ProgressView(value: fraction).frame(maxWidth: 320)
    } else {
      ProgressView()
    }
  }
}
