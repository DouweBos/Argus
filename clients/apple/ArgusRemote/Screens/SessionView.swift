import ArgusUI
import SwiftUI

/// One session, as the Mac shows it: its agents as tabs over the one in front,
/// and everything else about the session in a details sheet.
struct SessionView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  /// Nil when opened on an agent whose session isn't known yet.
  let sessionId: String?
  let label: String
  var repoRoot: String?
  /// The agent to put in front first.
  var agentId: String?

  /// The tab picked; on the router so a rotation or resize, which rebuilds this screen, keeps it.
  private var focused: String? {
    get { router.focusedAgents[focusKey] }
    nonmutating set { router.focusedAgents[focusKey] = newValue }
  }
  private var focusKey: String { resolvedSessionId ?? agentId ?? label }
  @State private var showingDetails = false
  @State private var width: CGFloat = 0
  /// What the chat keeps when the side panel is open beside it.
  private static let minChatWidth: CGFloat = 380
  @State private var startingAgent = false
  @State private var confirmingStop = false

  private var resolvedSessionId: String? { sessionId ?? agentId.flatMap { host.statusByAgent[$0]?.sessionId } }
  private var session: RemoteSession? { resolvedSessionId.flatMap(host.session(id:)) }
  private var resolvedRepoRoot: String? { session?.repoRoot ?? repoRoot }

  /// Its live agents, oldest first; the one this screen was opened on stays
  /// even once it stops, so its transcript doesn't vanish underfoot.
  private var agents: [RemoteAgentStatus] {
    guard let id = resolvedSessionId, let root = resolvedRepoRoot else { return [] }
    var list = host.agents(inSessionId: id, repoRoot: root).filter { !host.isGone($0.agentId) }
    if let agentId, !list.contains(where: { $0.agentId == agentId }), let opened = host.statusByAgent[agentId] {
      list.append(opened)
    }
    return list
  }

  /// The tab picked, else the one it opened on, else whatever wants you most.
  private var focusedAgentId: String? {
    let ids = agents.map(\.agentId)
    if let focused, ids.contains(focused) { return focused }
    if let agentId, ids.isEmpty || ids.contains(agentId) { return agentId }
    return AgentOrder.byActivity(agents).first?.agentId
  }

  private var focusedAgent: RemoteAgentStatus? {
    focusedAgentId.flatMap { id in agents.first { $0.agentId == id } ?? host.statusByAgent[id] }
  }

  private var sessionTitle: String { session.map(SessionActivity.title) ?? label }

  /// The agent in front, else the session; the line under it says where.
  private var title: String {
    if let focusedAgent { return Labels.agentName(focusedAgent, among: agents) }
    return focusedAgentId == nil ? sessionTitle : label
  }

  private var subtitle: String? {
    let parts = focusedAgentId == nil
      ? [session.flatMap(SessionActivity.subtitle)]
      : [sessionTitle, session.flatMap(SessionActivity.subtitle)]
    let line = parts.compactMap { $0 }.filter { !$0.isEmpty && $0 != title }.joined(separator: " · ")
    return line.isEmpty ? nil : line
  }

  var body: some View {
    HStack(spacing: 0) {
      VStack(spacing: 0) {
        if agents.count > 1 { tabBar }
        if let session, !session.isUnavailable, session.status == .error || session.setupPending == true {
          setupBanner(session)
        }
        content
      }
      // Only where there is room beside the chat; a phone keeps the details sheet.
      if router.isSplit, router.panelOpen, let session {
        SidePanelColumn(session: session, maxWidth: width - Self.minChatWidth)
          .transition(.move(edge: .trailing))
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    .animation(.snappy(duration: 0.25), value: router.panelOpen)
    .background(theme.bg.ignoresSafeArea())
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { toolbar }
    // The composer needs the room, and a conversation is a place you leave by going back.
    .toolbar(.hidden, for: .tabBar)
    // A sheet on a phone; on iPad the details are the side panel's first tab.
    .sheet(isPresented: $showingDetails) { details }
    // Pinned once shown, so the panel's MCP row and a rebuilt screen agree on the agent in front.
    .onChange(of: focusedAgentId, initial: true) { _, id in
      if let sid = resolvedSessionId, router.focusedAgents[sid] != id { router.focusedAgents[sid] = id }
    }
    .sheet(isPresented: $startingAgent) {
      if let session { StartInSessionSheet(session: session) { focus($0) } }
    }
    .confirmationDialog("Shut down this agent?", isPresented: $confirmingStop, titleVisibility: .visible) {
      Button("Shut down", role: .destructive) { stopFocused() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        focusedAgent?.status == .running
          ? "It stops mid-turn and anything still queued for it is discarded."
          : "Its process ends and anything still queued for it is discarded.")
    }
    .task(id: resolvedSessionId) {
      guard let id = resolvedSessionId else { return }
      // No project lists an automation run's session; opened straight from its agent, fetch it.
      if host.session(id: id) == nil { await host.adoptSession(id: id) }
      if let root = resolvedRepoRoot { await host.loadAgents(repoRoot: root) }
    }
    .liveRefresh(enabled: host.connection == .ready && resolvedRepoRoot != nil) {
      guard let root = resolvedRepoRoot else { return }
      await host.loadAgents(repoRoot: root)
      await host.loadSessions(repoRoot: root)
    }
  }

  // MARK: Tabs and content

  private var tabBar: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      PillTabBar(
        tabs: agents.map { agent in
          PillTab(
            id: agent.agentId, title: Labels.agentName(agent, among: agents), symbol: Icon.agent,
            indicator: agent.awaiting != nil)
        },
        selection: focusedAgentId, compact: true
      ) { picked in
        guard picked != focusedAgentId else { return }
        focused = picked
        Telemetry.capture(.sessionUsed(action: .switchAgent))
      }
      .padding(.horizontal, theme.space)
      .padding(.vertical, 6)
    }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.border).frame(height: 1) }
  }

  @ViewBuilder private var content: some View {
    if let id = focusedAgentId {
      AgentView(agentId: id, label: title).id(id)
    } else if let session, session.status == .initializing || session.status == .deleting {
      setupProgress(session)
    } else {
      EmptyState(
        icon: Icon.agent, title: "No agents",
        body: canStart
          ? "Start one and it works in this session's checkout."
          : "Agents started in this session from Argus on your computer appear here."
      ) {
        if canStart { Btn(label: "New agent", icon: Icon.plus, hugs: true) { startingAgent = true } }
      }
    }
  }

  private var canStart: Bool {
    guard let session else { return false }
    return host.hasControl && session.status == .ready && !session.isUnavailable
  }

  private func setupBanner(_ session: RemoteSession) -> some View {
    Group {
      if session.status == .error { SetupFailedRow(session: session) } else { SetupPendingRow(session: session) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card()
    .padding(theme.space)
  }

  /// A bar while the computer sets the session up or removes it; a spinner until there is a count.
  private func setupProgress(_ session: RemoteSession) -> some View {
    VStack(spacing: 12) {
      if let fraction = session.progress?.fraction {
        ProgressView(value: fraction).frame(maxWidth: 220)
      } else {
        ProgressView()
      }
      MutedText(SessionActivity.statusLabel(session.status) ?? "")
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      VStack(spacing: 0) {
        Text(title).font(.scaled(.subheadline).weight(.semibold)).lineLimit(1)
        if let subtitle {
          Text(subtitle).font(.scaled(.caption)).foregroundStyle(theme.textSecondary).lineLimit(1)
        }
      }
      .accessibilityElement(children: .combine)
    }
    ToolbarItemGroup(placement: .topBarTrailing) {
      if host.hasControl, let id = focusedAgentId, !host.isGone(id) {
        IconBtn(systemName: Icon.stop, label: "Shut down agent") { confirmingStop = true }
      }
      if session != nil, router.isSplit {
        IconBtn(
          systemName: Icon.sidePanel, label: router.panelOpen ? "Hide side panel" : "Show side panel"
        ) { togglePanel() }
      } else if session != nil {
        IconBtn(systemName: Icon.details, label: "Session details") {
          showingDetails.toggle()
          if showingDetails { Telemetry.capture(.sessionUsed(action: .openDetails)) }
        }
      }
    }
  }

  @ViewBuilder private var details: some View {
    if let session {
      NavigationStack {
        SessionDetailsView(
          session: session, agentId: focusedAgentId,
          open: open, started: focus,
          deleted: {
            showingDetails = false
            router.pop()
          }
        )
        .toolbar {
          ToolbarItem(placement: .confirmationAction) { Button("Done") { showingDetails = false } }
        }
      }
      .presentationDetents([.medium, .large])
    }
  }

  // MARK: Actions

  private func togglePanel() {
    router.panelOpen.toggle()
    Telemetry.capture(.sessionPanelUsed(action: router.panelOpen ? .open : .close, tab: router.panelTab))
  }

  private func open(_ route: Route) {
    showingDetails = false
    router.push(route)
  }

  private func focus(_ agent: RemoteAgentStatus) {
    showingDetails = false
    focused = agent.agentId
    if let root = resolvedRepoRoot { Task { await host.loadAgents(repoRoot: root) } }
  }

  /// Stops the agent in front and moves to the next live one, if any.
  private func stopFocused() {
    guard let id = focusedAgentId else { return }
    let next = agents.first { $0.agentId != id && !host.isGone($0.agentId) }?.agentId
    Task {
      await host.stopAgent(agentId: id)
      focused = next
    }
  }
}
