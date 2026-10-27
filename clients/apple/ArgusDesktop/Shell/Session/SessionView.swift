import ArgusUI
import SwiftUI

/// One session: its agents as tabs, the focused agent's transcript and input.
struct SessionView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(TerminalsStore.self) private var terminals
  let sessionId: String
  @AppStorage(ContextCardPreference.key(.agents)) private var agentCardCollapsed =
    ContextCardPreference.collapsedByDefault(.agents)
  @AppStorage(ContextCardPreference.key(.code)) private var codeCardCollapsed =
    ContextCardPreference.collapsedByDefault(.code)
  @AppStorage(ContextCardPreference.key(.git)) private var gitCardCollapsed =
    ContextCardPreference.collapsedByDefault(.git)
  @State private var contentWidth: CGFloat = 0

  private var session: RemoteSession? { model.session(sessionId) }

  /// The panel's card is folded to its switcher, so its run control and huddle sit in the toolbar.
  private var cardCollapsed: Bool {
    switch model.sessionPanel ?? .agents {
    case .agents: agentCardCollapsed
    case .code: codeCardCollapsed
    case .git: gitCardCollapsed
    }
  }

  /// The reading column steps clear of an open card when there's room to.
  private var readingReserve: CGFloat {
    !agentCardCollapsed && contentWidth >= SessionContextCardOverlay.minWidth ? SessionContextCardOverlay.reserve : 0
  }
  private var agents: [RemoteAgentStatus] { model.agents(inSession: sessionId) }
  private var focusedAgentId: String? { model.focusedAgentId(inSession: sessionId, agents: agents) }

  private func startAgent() { model.startAgent(inSession: sessionId) }

  private func closeAgent(_ agentId: String) { model.closeAgent(agentId, inSession: sessionId) }

  var body: some View {
    Group {
      if case .sessionCode(_, let path, let line) = model.route, let session {
        if session.status == .ready {
          CodePanel(session: session, path: path, line: line)
        } else {
          SessionSetupView(session: session, progress: session.progress)
            .sessionContextCard(session, panel: .code)
        }
      } else if let gitView = model.route.gitView, let session {
        if session.status == .ready {
          GitScreen(session: session, view: gitView)
        } else {
          SessionSetupView(session: session, progress: session.progress)
            .sessionContextCard(session, panel: .git)
        }
      } else {
        agentsPane
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
    .toolbar(removing: .title)
    .toolbar { SessionToolbar(session: session, sessionId: sessionId, cardCollapsed: cardCollapsed) }
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

  private var agentsPane: some View {
    VStack(spacing: 0) {
      AgentTabBar(
        agents: agents, focused: focusedAgentId, canStart: session?.status == .ready,
        select: { model.navigate(.session(id: sessionId, agentId: $0)) },
        start: startAgent, close: closeAgent)
      .padding(.trailing, SessionContextCardOverlay.barReserve)
      Group {
        if let session, session.status != .ready {
          SessionSetupView(session: session, progress: session.progress)
        } else if let agentId = focusedAgentId {
          AgentPane(agentId: agentId, sessionId: sessionId)
            .id(agentId)
        } else {
          SessionStartPane(sessionId: sessionId)
            .id(sessionId)
        }
      }
      .environment(\.readingColumnReserve, readingReserve)
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .sessionContextCard(session, panel: .agents, barHeight: AgentTabBar.height)
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
        Label("New Agent", systemImage: Icon.plus)
      }
      .buttonStyle(FlatIconButtonStyle(size: 22))
      .disabled(!canStart)
      .help("New agent (⇧⌘A)")
    }
    .padding(.horizontal, 10)
    // A scroll view takes all the height it's offered; a tab bar is one row.
    .frame(height: Self.height)
  }

  static let height: CGFloat = 34

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
  @Environment(\.theme) private var theme
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
    .font(.scaled(size: 12))
    .foregroundStyle(selected ? theme.text : theme.textSecondary)
    .padding(.leading, 9)
    .padding(.trailing, 7)
    .padding(.vertical, 4)
    .background(selected || hovering ? theme.selection.opacity(selected ? 1 : 0.55) : .clear, in: .rect(cornerRadius: 6))
    .onHover { hovering = $0 }
    .contextMenu {
      Button("Close Agent", action: close)
    }
  }
}

/// The focused agent: its transcript, kept live, and the input that drives it.
/// Before the first message the composer sits mid-pane under a title instead.
struct AgentPane: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let agentId: String
  let sessionId: String
  /// Images and files dropped on the transcript go to the composer.
  @State private var drops = ComposerDropInbox()
  @State private var dropTargeted = false
  @State private var loaded = false

  /// Nothing said yet, nothing queued, and the agent isn't at work.
  private var fresh: Bool {
    loaded && store.visibleMessages(for: agentId).isEmpty
      && (store.queuedByAgent[agentId] ?? []).isEmpty && (store.failedByAgent[agentId] ?? []).isEmpty
      && store.statusByAgent[agentId]?.status != .running
  }

  var body: some View {
    let fresh = fresh
    VStack(spacing: 0) {
      TranscriptView(
        agentKey: agentId, sessionId: sessionId, fixture: TranscriptStress.fixture,
        showsEmptyState: TranscriptStress.fixture != nil
      )
        .onDrop(of: ComposerDropInbox.types, isTargeted: $dropTargeted, perform: drops.accept)
        .overlay {
          if dropTargeted {
            Rectangle().strokeBorder(theme.accent, lineWidth: 2).allowsHitTesting(false)
          }
        }
        .overlay(alignment: .bottom) {
          if fresh { AgentStartTitle(sessionId: sessionId).padding(.bottom, 18) }
        }
      HuddleTypingBar(agentId: agentId)
      ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
        MacTelemetry.capture(.inputUsed(affordance: affordance.rawValue))
      }
      // Shares the height with the transcript above, which centres the composer.
      if fresh { Color.clear.frame(maxHeight: .infinity) }
    }
    .environment(\.composerDropInbox, drops)
    .environment(\.composerFocusRequest, model.composerFocusRequest)
    .huddleAgent(agentId)
    .task {
      await store.watchAgent(agentId, on: true)
      await store.loadTranscript(agentId: agentId)
      loaded = true
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

/// "What should we work on?" over a new agent's composer, with where it works.
struct AgentStartTitle: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let sessionId: String

  private var place: String {
    guard let session = model.session(sessionId) else { return "" }
    if session.kind == .scratchPad { return "Scratch pad" }
    return store.projects.first { $0.repoRoot == session.repoRoot }?.name
      ?? URL(fileURLWithPath: session.repoRoot).lastPathComponent
  }

  var body: some View {
    VStack(spacing: 6) {
      Text("What should we work on?")
        .font(.scaled(size: 26, weight: .medium))
        .foregroundStyle(theme.text)
      if !place.isEmpty {
        Text(place)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textSecondary)
      }
    }
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity)
    .readingColumn()
    .allowsHitTesting(false)
  }
}
