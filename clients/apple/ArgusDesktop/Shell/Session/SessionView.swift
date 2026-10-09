import ArgusUI
import SwiftUI

/// One session: its agents as tabs, the focused agent's transcript and input.
struct SessionView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(TerminalsStore.self) private var terminals
  let sessionId: String

  private var session: RemoteSession? { model.session(sessionId) }
  private var agents: [RemoteAgentStatus] { model.agents(inSession: sessionId) }
  private var focusedAgentId: String? { model.focusedAgentId(inSession: sessionId, agents: agents) }

  private func startAgent() { model.startAgent(inSession: sessionId) }
  private func startAgent(mode: RemotePermissionMode?) { model.startAgent(inSession: sessionId, mode: mode) }

  /// Closing a tab stops its agent, as in the desktop app; its transcript is
  /// saved first.
  private func closeAgent(_ agentId: String) {
    // The neighbour takes over, as on the desktop; the route never names a closed agent.
    if agentId == focusedAgentId, let index = agents.firstIndex(where: { $0.agentId == agentId }) {
      let rest = agents.filter { $0.agentId != agentId }
      let next = rest.isEmpty ? nil : rest[min(max(index - 1, 0), rest.count - 1)].agentId
      model.navigate(.session(id: sessionId, agentId: next))
    }
    Task { await store.stopAgent(agentId: agentId) }
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
        } else if case .sessionCode(_, let path, let line) = model.route, let session {
          if session.status == .ready {
            CodePanel(session: session, path: path, line: line)
          } else {
            SessionSetupView(session: session, progress: session.progress)
          }
        } else if let gitView = model.route.gitView, let session {
          if session.status == .ready {
            GitScreen(session: session, view: gitView)
          } else {
            SessionSetupView(
              session: session, progress: session.progress)
          }
        } else {
          agentsPane
        }
      }
    } bottom: {
      if let session { TerminalPanel(session: session) }
    }
    .toolbar {
      // Centred, as Xcode and Finder place their view switchers.
      ToolbarItem(placement: .principal) {
        PillTabBar(
          tabs: SessionPanel.allCases.map {
            PillTab(id: $0, title: $0.title, symbol: $0.symbol, badge: $0 == .git ? gitChangeCount : nil)
          },
          selection: model.sessionPanel ?? .home, compact: true
        ) { model.show($0, via: .toolbar) }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { model.toolbarLayout.switcherWidth = $0 }
      }
      if let session, session.status == .ready {
        // One item, so the toolbar draws one capsule around flat controls, as around the switcher.
        ToolbarItem {
          PillGroup {
            HuddleToolbarButton(sessionId: session.id)
            RunControl(session: session) { model.terminalPanelVisible = true }
            Button {
              model.terminalPanelVisible.toggle()
            } label: {
              Label("Terminal", systemImage: "terminal")
            }
            .help(model.terminalPanelVisible ? "Hide terminal (⇧⌘T)" : "Show terminal (⇧⌘T)")
            .accessibilityLabel("Terminal")
          }
          .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { model.toolbarLayout.sessionToolsWidth = $0 }
        }
      }
    }
    // An agent's `trigger_run` shows its output, as the desktop app does.
    .onChange(of: terminals.revealed) { _, reveal in
      if reveal?.sessionId == sessionId { model.terminalPanelVisible = true }
    }
    .onChange(of: agents.map(\.agentId)) { _, ids in
      if let spawned = model.spawnedAgent, ids.contains(spawned) { model.spawnedAgent = nil }
    }
    .navigationTitle(session.map(Self.title) ?? "Session")
    .navigationSubtitle(session.map(Self.subtitle) ?? "")
    .task(id: session?.repoRoot) {
      if let repoRoot = session?.repoRoot { await store.loadAgents(repoRoot: repoRoot) }
    }
    // The run control reads the project's run commands and which are going;
    // the git panel's lists load ahead so switching to it is instant.
    .task(id: session?.status == .ready ? sessionId : nil) {
      guard let session, session.status == .ready else { return }
      await terminals.loadConfig(repoRoot: session.repoRoot)
      await terminals.refresh(sessionId: sessionId)
      await model.git.prefetch(session)
    }
  }

  /// The session's name; the branch only as a subtitle, and only when it adds something.
  static func title(_ session: RemoteSession) -> String {
    session.displayName.flatMap { $0.isEmpty ? nil : $0 } ?? session.branch
  }

  static func subtitle(_ session: RemoteSession) -> String {
    title(session) == session.branch ? "" : session.branch
  }

  /// The open repository's changed files, as Grove badges its Changes tab.
  private var gitChangeCount: Int? {
    model.git.workspace(sessionId)?.workingCopy.changedCount
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
          session: session, progress: session.progress)
      } else if let agentId = focusedAgentId {
        AgentPane(agentId: agentId, sessionId: sessionId)
          .id(agentId)
      } else {
        EmptyState(icon: "sparkles", title: "No agents", body: "Start an agent to work in this session.") {
          Button("Start Agent", action: startAgent)
            .buttonStyle(.borderedProminent)
            .disabled(session?.status != .ready)
        }
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .background {
      // ⌘T too, as the Mac app always had it: agents are this panel's tabs.
      Button("New Agent") { MenuCommand.newAgent.run(model, via: .shortcut) }
        .keyboardShortcut("t", modifiers: .command)
        .hidden()
    }
  }
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
      .help("New agent (⇧⌘A)")
    }
    .padding(.horizontal, 8)
    // A scroll view takes all the height it's offered; a tab bar is one row.
    .frame(height: 38)
  }

  /// Agents each agent spawned, across every agent the host has described.
  private var childCounts: [String: Int] {
    var parents: [String: String] = [:]
    for agent in store.statusByAgent.values { parents[agent.agentId] = agent.parentAgentId }
    for agent in agents where agent.parentAgentId != nil { parents[agent.agentId] = agent.parentAgentId }
    return parents.values.reduce(into: [:]) { counts, parent in counts[parent, default: 0] += 1 }
  }

  /// A Task/Agent call still running in the loaded transcript: a subagent is
  /// at work, even when the CLI reports its parent idle.
  private func subagentsRunning(_ agentId: String) -> Bool {
    (store.messagesByAgent[agentId] ?? []).contains { message in
      message.toolCalls.contains { ($0.name == "Task" || $0.name == "Agent") && $0.status == .running }
    }
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
              .font(.scaled(size: 9, weight: .semibold))
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
        Image(systemName: "xmark").font(.scaled(size: 9, weight: .semibold))
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
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let agentId: String
  let sessionId: String
  /// Images and files dropped on the transcript go to the composer.
  @State private var drops = ComposerDropInbox()
  @State private var dropTargeted = false

  var body: some View {
    VStack(spacing: 0) {
      TranscriptView(agentKey: agentId, sessionId: sessionId, fixture: TranscriptStress.fixture)
        .onDrop(of: ComposerDropInbox.types, isTargeted: $dropTargeted, perform: drops.accept)
        .overlay {
          if dropTargeted {
            Rectangle().strokeBorder(theme.accent, lineWidth: 2).allowsHitTesting(false)
          }
        }
      HuddleTypingBar(agentId: agentId)
      ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
        MacTelemetry.capture(.inputUsed(affordance: affordance.rawValue))
      }
    }
    .environment(\.composerDropInbox, drops)
    .environment(\.composerFocusRequest, model.composerFocusRequest)
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
  /// The listed session's progress, refreshed on each `session:progress`.
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
