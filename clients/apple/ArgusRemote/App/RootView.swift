import ArgusUI
import LocalAuthentication
import SwiftUI

/// The app shell: a biometric gate, then one navigation stack.
///
/// The gate is opportunistic — a device with no biometrics enrolled is not
/// locked out of its own agents. Notification routing is wired up outside the
/// gate so a background Approve/Deny tap is never dropped.
struct RootView: View {
  @Environment(\.colorScheme) private var systemScheme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var app = AppStore()
  @State private var router = Router()
  @State private var automations: AutomationsStore?
  @State private var proposals: ProposalsStore?
  @State private var pullRequests: PullRequestsStore?
  @State private var imageViewer = ImageViewerState()
  /// The project a new session is being named for, and the name being typed.
  @State private var newSessionProject: RemoteProject?

  @Environment(\.scenePhase) private var scenePhase
  @State private var askingConsent = false
  @State private var unlocked = false
  @State private var canAuthenticate = false
  @State private var biometryLabel: String?
  #if DEBUG
    @State private var devDriver: DevDriver?
  #endif
  private var theme: Theme {
    Theme.resolved(for: app.themePreference.colorScheme ?? systemScheme, colorTheme: app.colorTheme)
  }

  var body: some View {
    Group {
      if unlocked, let automations, let proposals, let pullRequests {
        navigation
        // One presenter for the whole app, so any transcript image can open
        // without threading modal state through every view between.
        .overlay { ImageViewerOverlay() }
        // A device waiting to join the account is announced wherever the user is.
        .modifier(JoinRequestPrompt())
        .environment(app)
        .environment(app.host)
        .environment(\.autoExpandImageReads, app.autoExpandImageReads)
        .environment(router)
        .environment(automations)
        .environment(proposals)
        .environment(pullRequests)
        .environment(imageViewer)
        .tint(theme.accent)
      } else {
        LockScreen(
          biometryLabel: biometryLabel,
          canAuthenticate: canAuthenticate,
          onUnlock: authenticate)
      }
    }
    .environment(\.theme, theme)
    // Outside the gate, like a notification tap: a handoff that lands while
    // the app is locked is parked, not lost.
    .onContinueUserActivity(Handoff.activityType) { activity in
      guard let handoff = Handoff(userInfo: activity.userInfo) else { return }
      NotificationRouter.shared.open(handoff)
    }
    .preferredColorScheme(app.themePreference.colorScheme)
    // Asked before pairing, so nothing is sent on a choice not yet made.
    .sheet(isPresented: $askingConsent) { TelemetryConsentSheet() }
    // Sending is per-event, but the app going away is the last chance to get
    // the tail of them off the device.
    .onChange(of: scenePhase) { _, phase in
      if phase == .background { Telemetry.flush() }
      // Moved tunnels, new computers and reconnected drives, picked up on the way back in.
      if phase == .active {
        app.recheckRoutes()
        Task { await app.account.refresh() }
        Task { await app.host.refreshHeldLists() }
      }
    }
    .task { await bootstrap() }
    // Rotating an iPad, or resizing it in Split View, changes the column
    // count; carry the open destinations across rather than losing them.
    .onChange(of: sizeClass) { _, new in router.adopt(split: new == .regular) }
  }

  /// A tab bar on a phone, a system sidebar on an iPad — `sidebarAdaptable`
  /// is one hierarchy that presents itself correctly on both, so there is no
  /// separate split-view tree to keep in step.
  private var navigation: some View {
    Group {
      if sizeClass == .regular { columns } else { tabs }
    }
    // Floated rather than stacked: a transient state should not resize the
    // whole layout on its way in and out.
    .overlay(alignment: .top) {
      if app.identity != nil, app.host.connection == .offline {
        reconnectingPill
          .transition(.move(edge: .top).combined(with: .opacity))
      }
    }
    .animation(.easeOut(duration: 0.25), value: app.host.connection)
    // Not while offline: the reconnecting pill already says that, and better.
    .overlay(alignment: .bottom) {
      if let error = app.host.lastError, app.host.connection != .offline {
        errorToast(error)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.easeOut(duration: 0.25), value: app.host.lastError)
  }

  /// Every failed request already sets `lastError`; without this the app just
  /// appears to ignore the tap.
  private func errorToast(_ message: String) -> some View {
    Banner(text: message, tone: .danger)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
      .shadow(color: .black.opacity(0.25), radius: 10, y: 3)
      .padding(.horizontal, 16)
      .padding(.bottom, 12)
      .onTapGesture { app.host.clearError() }
      .task(id: message) {
        try? await Task.sleep(for: .seconds(6))
        app.host.clearError()
      }
      .accessibilityLabel(message)
  }

  /// Small, quiet, and out of the way — it retries on its own, so this is a
  /// status, not something to act on.
  private var reconnectingPill: some View {
    HStack(spacing: 7) {
      StatusDot(tone: .warning, pulse: true)
      Text("Reconnecting…")
        .font(.footnote.weight(.medium))
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 13)
    .padding(.vertical, 8)
    .background(.regularMaterial, in: Capsule())
    .overlay(Capsule().strokeBorder(theme.border, lineWidth: 0.5))
    .shadow(color: .black.opacity(0.25), radius: 10, y: 3)
    .padding(.top, 6)
    .accessibilityLabel("Reconnecting to \(app.identity?.label ?? "your computer")")
  }

  /// Sidebar beside detail. The sidebar carries the hierarchy — sections,
  /// then each project as a collapsible group of its agents — so the agents
  /// beside the one you are reading stay a tap away.
  private var columns: some View {
    @Bindable var router = router
    return NavigationSplitView {
      sidebar
        .navigationTitle("Argus")
        .navigationSplitViewColumnWidth(min: 240, ideal: 300, max: 380)
    } detail: {
      NavigationStack(path: $router.detailStack) {
        DetailRoot()
          .navigationDestination(for: Route.self) { destination($0) }
      }
    }
    .navigationSplitViewStyle(.balanced)
  }

  private var sidebar: some View {
    @Bindable var router = router
    return List(selection: selection) {
      Section {
        ForEach(AppSection.allCases) { section in
          Label(section.title, systemImage: section.symbol)
            .tag(SidebarItem.section(section))
        }
      }

      if !app.host.projects.isEmpty {
        Section("Projects") {
          ForEach(app.host.projects) { project in
            DisclosureGroup(isExpanded: projectExpansion(project)) {
              let groups = sessionGroups(in: project)
              if groups.isEmpty {
                Text("Nothing running")
                  .font(.footnote)
                  .foregroundStyle(.secondary)
              }
              ForEach(groups) { group in
                DisclosureGroup(isExpanded: expansion(for: group.id)) {
                  if group.agents.isEmpty {
                    Text("No agents")
                      .font(.footnote)
                      .foregroundStyle(.secondary)
                  }
                  ForEach(group.agents) { agent in
                    Label {
                      Text(Labels.agentName(agent)).lineLimit(1)
                    } icon: {
                      StatusDot(
                        tone: agent.awaiting != nil ? .warning : agent.status.tone,
                        pulse: agent.awaiting == nil && agent.status == .running)
                    }
                    .tag(
                      SidebarItem.agent(
                        id: agent.agentId, label: Labels.agentName(agent),
                        repoRoot: project.repoRoot, projectName: project.name))
                  }
                  if app.host.hasControl {
                    Button {
                      spawnAgent(in: group.id, project: project)
                    } label: {
                      Label("New agent", systemImage: Icon.plus)
                        .font(.footnote)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.accent)
                  }
                } label: {
                  Label(group.label, systemImage: Icon.branch).lineLimit(1)
                }
              }
              if app.host.hasControl {
                Button {
                  newSessionProject = project
                } label: {
                  Label("New session", systemImage: Icon.plus)
                    .font(.footnote)
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.accent)
              }
            } label: {
              Label(project.name, systemImage: Icon.folder).lineLimit(1)
            }
          }
        }
      }
    }
    .listStyle(.sidebar)
    .sheet(item: $newSessionProject) { project in
      StartAgentSheet(
        repoRoot: project.repoRoot,
        sessionId: app.host.sessionsByRepo[project.repoRoot]?
          .first { $0.kind == .projectRoot }?.id,
        currentLabel: "Current checkout",
        workspace: .worktree,
        models: [],
        defaultMode: app.defaultPermissionMode
      ) { started, chosen in
        Telemetry.capture(
          .agentStartSubmitted(workspace: chosen.rawValue, changedWorkspace: chosen != .worktree))
        if case .agent(let agent) = started {
          router.apply(
            .agent(
              id: agent.agentId, label: Labels.agentName(agent),
              repoRoot: project.repoRoot, projectName: project.name))
        }
        Task {
          // Show it straight away rather than waiting for the next poll.
          await app.host.loadSessions(repoRoot: project.repoRoot)
          router.expandedProjects.insert(project.repoRoot)
        }
      }
    }
  }

  private func spawnAgent(in sessionId: String, project: RemoteProject) {
    Task {
      guard
        let agent = await app.host.spawnAgent(
          sessionId: sessionId, permissionMode: app.defaultPermissionMode)
      else { return }
      router.apply(
        .agent(
          id: agent.agentId, label: Labels.agentName(agent),
          repoRoot: project.repoRoot, projectName: project.name))
      await app.host.loadRecentAgents()
    }
  }

  /// A session in the sidebar tree, with whatever is running inside it.
  struct SessionGroup: Identifiable {
    var id: String
    var label: String
    var agents: [RemoteAgentStatus]
    /// The project root — `main` — which belongs at the top of its project.
    var isRoot: Bool
  }

  /// Project → session → agents.
  ///
  /// `recentAgents` already spans every project, so the agents cost no extra
  /// fetch. Sessions are only listed once a project has been expanded — that
  /// is what makes an idle session with no agents visible at all.
  private func sessionGroups(in project: RemoteProject) -> [SessionGroup] {
    let agents = app.host.recentAgents.filter { $0.projectName == project.name }
    var order: [String] = []
    var byId: [String: SessionGroup] = [:]

    for session in app.host.sessionsByRepo[project.repoRoot] ?? [] {
      order.append(session.id)
      byId[session.id] = SessionGroup(
        id: session.id, label: session.displayName ?? session.branch, agents: [],
        isRoot: session.kind == .projectRoot)
    }
    for agent in agents {
      if byId[agent.sessionId] == nil {
        order.append(agent.sessionId)
        let label = agent.sessionLabel ?? "Session"
        byId[agent.sessionId] = SessionGroup(
          id: agent.sessionId, label: label, agents: [],
          // Until a project is expanded its sessions haven't been fetched,
          // so `kind` is unavailable and the branch name is all we have.
          isRoot: label == "main" || label == "master")
      }
      byId[agent.sessionId]?.agents.append(agent)
    }

    return order.compactMap { byId[$0] }.map { group in
      var sorted = group
      sorted.agents.sort {
        let left = Labels.activityRank($0)
        let right = Labels.activityRank($1)
        if left != right { return left < right }
        return Labels.lastActivity($0) > Labels.lastActivity($1)
      }
      return sorted
    }
    // The project root first; everything else keeps the order the computer
    // gave, which already matches the desktop's sidebar.
    .enumerated()
    .sorted { left, right in
      if left.element.isRoot != right.element.isRoot { return left.element.isRoot }
      return left.offset < right.offset
    }
    .map(\.element)
  }

  /// Expanding a project is when its sessions are worth fetching.
  private func projectExpansion(_ project: RemoteProject) -> Binding<Bool> {
    Binding(
      get: { router.expandedProjects.contains(project.repoRoot) },
      set: { open in
        if open {
          router.expandedProjects.insert(project.repoRoot)
          Task { await app.host.loadSessions(repoRoot: project.repoRoot) }
        } else {
          router.expandedProjects.remove(project.repoRoot)
        }
      })
  }

  private var selection: Binding<SidebarItem?> {
    Binding(
      get: { router.sidebarSelection },
      set: { router.apply($0) })
  }

  private func expansion(for repoRoot: String) -> Binding<Bool> {
    Binding(
      get: { router.expandedProjects.contains(repoRoot) },
      set: { open in
        if open {
          router.expandedProjects.insert(repoRoot)
        } else {
          router.expandedProjects.remove(repoRoot)
        }
      })
  }

  private var tabs: some View {
    @Bindable var router = router
    return TabView(selection: $router.section) {
      ForEach(AppSection.allCases) { section in
        Tab(section.title, systemImage: section.symbol, value: section) {
          NavigationStack(path: pathBinding(section)) {
            root(for: section)
              .navigationDestination(for: Route.self) { destination($0) }
          }
        }
      }
    }
  }

  private func pathBinding(_ section: AppSection) -> Binding<[Route]> {
    Binding(
      get: { router.paths[section] ?? [] },
      set: { router.paths[section] = $0 })
  }

  @ViewBuilder
  private func root(for section: AppSection) -> some View {
    switch section {
    case .projects: ProjectsView()
    case .inbox: InboxView()
    case .automations: AutomationsView()
    case .devices: DevicesView()
    case .settings: SettingsView()
    }
  }

  private func destination(_ route: Route) -> some View {
    // Every push funnels through here, so this is the one place a screen
    // event has to be sent from.
    screen(for: route).onAppear { Telemetry.screen(route) }
  }

  @ViewBuilder
  private func screen(for route: Route) -> some View {
    switch route {
    case .pair:
      PairView()
    case .computer(let deviceId):
      ComputerView(deviceId: deviceId)
    case .projects:
      ProjectsView()
    case .agents:
      AllAgentsView()
    case .project(let repoRoot, let name):
      ProjectView(repoRoot: repoRoot, name: name)
    case .agent(let id, let label):
      AgentView(agentId: id, label: label)
    case .stoppedAgent(let historyId, let repoRoot, let label, let branch, let runner):
      StoppedAgentView(
        historyId: historyId, repoRoot: repoRoot, label: label,
        branch: branch, runnerSessionId: runner)
    case .changes(let sessionId, let label):
      ChangesView(sessionId: sessionId, label: label)
    case .file(let sessionId, let path, let line, let source):
      FileView(sessionId: sessionId, path: path, line: line, source: source)
    case .quickOpen(let sessionId, let label):
      QuickOpenView(sessionId: sessionId, label: label)
    case .fileSearch(let sessionId, let label):
      FileSearchView(sessionId: sessionId, label: label)
    case .terminals(let sessionId, let label):
      SessionTerminalsList(sessionId: sessionId) { terminal in
        router.push(.terminal(id: terminal.id, label: SessionTerminalsList.title(terminal)))
      }
      .navigationTitle("Terminals · \(label)")
      .navigationBarTitleDisplayMode(.inline)
    case .terminal(let id, let label):
      TerminalOutputView(terminalId: id)
        .navigationTitle(label)
        .navigationBarTitleDisplayMode(.inline)
    case .stashes(let sessionId, let label):
      StashesView(sessionId: sessionId, label: label)
    case .branches(let sessionId, let repoRoot, let label):
      BranchesView(sessionId: sessionId, repoRoot: repoRoot, label: label)
    case .branch(let sessionId, let repoRoot, let branch):
      BranchView(sessionId: sessionId, repoRoot: repoRoot, branch: branch)
    case .commit(let sessionId, let hash, let subject):
      CommitView(sessionId: sessionId, hash: hash, subject: subject)
    case .branchCompare(let sessionId, let left, let right):
      BranchCompareView(sessionId: sessionId, left: left, right: right)
    case .devices:
      DevicesView()
    case .device(let id, let platform, let name, let isTv):
      DeviceView(deviceId: id, platform: platform, name: name, isTv: isTv)
    case .inbox:
      InboxView()
    case .proposal(let id):
      // Keyed so swapping one proposal for another doesn't keep the old one's state.
      ProposalView(proposalId: id).id(id)
    case .pullRequests:
      PullRequestsView()
    case .issues:
      IssuesView()
    case .pullRequest(let repo, let number, let label):
      PullRequestView(repo: repo, number: number, label: label)
    case .automations:
      AutomationsView()
    case .automation(let id, let label):
      AutomationView(automationId: id, label: label)
    case .quickRun:
      QuickRunView()
    case .automationEditor(let id, _):
      AutomationEditorView(automationId: id)
    case .describeAutomation:
      DescribeAutomationView()
    case .automationDraft(let detail, let notes):
      AutomationEditorView(automationId: nil, prefill: detail, notes: notes)
    case .run(let id, let label):
      RunView(runId: id, label: label)
    case .settings:
      SettingsView()
    case .notifications:
      WarningsView()
    case .computers:
      HomeView()
    case .account:
      AccountView()
    case .addComputer:
      AddComputerView()
    case .claudeAccounts:
      ClaudeAccountsView()
    case .usage:
      HostUsageView()
        .navigationTitle("Usage")
        .navigationBarTitleDisplayMode(.inline)
    }
  }

  private func bootstrap() async {
    askingConsent = !Telemetry.hasAnsweredConsent
    #if DEBUG
      if devDriver == nil { devDriver = DevDriver.startIfConfigured(app: app, router: router) }
      if devDriver != nil { askingConsent = false }
    #endif
    if automations == nil { automations = AutomationsStore(host: app.host) }
    if proposals == nil { proposals = ProposalsStore(host: app.host) }
    if pullRequests == nil { pullRequests = PullRequestsStore(host: app.host) }
    router.adopt(split: sizeClass == .regular)
    NotificationRouter.shared.configure(app: app, router: router)
    await NotificationRouter.shared.registerCategories()

    let context = LAContext()
    var error: NSError?
    let available = context.canEvaluatePolicy(
      .deviceOwnerAuthenticationWithBiometrics, error: &error)
    guard available else {
      // No hardware or nothing enrolled: the lock is opportunistic, not a
      // second password the user never set.
      unlocked = true
      await app.initialize()
      NotificationRouter.shared.unlocked()
      return
    }
    biometryLabel = switch context.biometryType {
    case .faceID: "Face ID"
    case .touchID: "Touch ID"
    case .opticID: "Optic ID"
    default: "biometrics"
    }
    canAuthenticate = true
  }

  private func authenticate() {
    Task {
      let context = LAContext()
      let ok = (try? await context.evaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        localizedReason: "Unlock Argus Remote")) ?? false
      guard ok else { return }
      unlocked = true
      await app.initialize()
      NotificationRouter.shared.unlocked()
    }
  }
}

/// The detail column's root.
///
/// Deliberately its own view: the stack's root identity is this type, so
/// changing section re-renders it instead of re-creating the stack and
/// dropping whatever was pushed.
private struct DetailRoot: View {
  @Environment(Router.self) private var router

  var body: some View {
    if let project = router.detailProject {
      ProjectView(repoRoot: project.repoRoot, name: project.name)
    } else {
      switch router.section {
      case .projects: ProjectsView()
      case .inbox: InboxView()
      case .automations: AutomationsView()
      case .devices: DevicesView()
      case .settings: SettingsView()
      }
    }
  }
}
