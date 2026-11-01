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
        .overlay { ImageViewerOverlay { Telemetry.capture(.imageViewerUsed(action: $0)) } }
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
    .tracksDynamicType()
    // Outside the gate, like a notification tap: a handoff that lands while
    // the app is locked is parked, not lost.
    .onContinueUserActivity(Handoff.activityType) { activity in
      guard let handoff = Handoff(userInfo: activity.userInfo) else { return }
      NotificationRouter.shared.open(handoff)
    }
    .onOpenURL { url in
      guard let location = ArgusLocation(deepLink: url) else { return }
      NotificationRouter.shared.open(location)
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
    // A section's root is never pushed, so its screen view is sent here.
    .onChange(of: router.section, initial: true) { _, section in Telemetry.screen(section.root) }
    // The Inbox badge and Home's "needs you" read the inbox from any tab.
    .liveRefresh(enabled: app.identity != nil && app.host.connection == .ready, every: .seconds(60)) {
      await proposals?.refresh()
      await automations?.refresh()
    }
    // Whether Linear is connected decides if Issues is listed at all.
    .task(id: app.host.connection == .ready) {
      guard app.host.connection == .ready else { return }
      await app.host.loadIntegrations()
    }
  }

  /// Every failed request already sets `lastError`; without this the app just
  /// appears to ignore the tap.
  private func errorToast(_ message: String) -> some View {
    Banner(text: message, tone: .danger)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
      .shadow(color: .black.opacity(0.25), radius: 10, y: 3)
      .padding(.horizontal, 16)
      // The overlay sits over the whole TabView, so clear its floating bar.
      .padding(.bottom, sizeClass == .regular ? 12 : 64)
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

  /// Sidebar beside detail. The sidebar lists sections, then each project's
  /// sessions, as the Mac's does — so the sessions beside the one you are
  /// reading stay a tap away.
  private var columns: some View {
    @Bindable var router = router
    return NavigationSplitView {
      SessionSidebar()
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

  private var tabs: some View {
    @Bindable var router = router
    return TabView(selection: $router.section) {
      ForEach(AppSection.tabs) { section in
        Tab(section.title, systemImage: section.symbol, value: section) {
          NavigationStack(path: pathBinding(section)) {
            Self.sectionRoot(section)
              .navigationDestination(for: Route.self) { destination($0) }
          }
        }
        .badge(badge(for: section))
      }
    }
  }

  /// What waits behind a tab: decisions, failures and reports on Inbox,
  /// unseen notifications on More.
  private func badge(for section: AppSection) -> Int {
    switch section {
    case .inbox: inboxCount
    case .more: app.notifications.unseenCount
    default: 0
    }
  }

  private var inboxCount: Int {
    guard let proposals, let automations else { return 0 }
    return proposals.items(runs: automations.runs, sessionIds: []).actionCount
  }

  private func pathBinding(_ section: AppSection) -> Binding<[Route]> {
    Binding(
      get: { router.paths[section] ?? [] },
      set: { router.paths[section] = $0 })
  }

  /// A section's own screen, for a tab or the detail column's root.
  @ViewBuilder
  static func sectionRoot(_ section: AppSection) -> some View {
    switch section {
    case .home: ProjectsView()
    case .inbox: InboxView()
    case .agents: AllAgentsView()
    case .devices: DevicesView()
    case .automations: AutomationsView()
    case .issues: IssuesView()
    case .pullRequests: PullRequestsView()
    case .usage:
      HostUsageView()
        .navigationTitle("Usage")
        .navigationBarTitleDisplayMode(.inline)
    case .notifications: WarningsView()
    case .settings: SettingsView()
    case .more: MoreView()
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
    case .session(let id, let label, let repoRoot):
      SessionView(sessionId: id, label: label, repoRoot: repoRoot)
    case .agent(let id, let label):
      SessionView(sessionId: nil, label: label, agentId: id)
    case .stoppedAgent(let historyId, let repoRoot, let label, let branch, let runner):
      StoppedAgentView(
        historyId: historyId, repoRoot: repoRoot, label: label,
        branch: branch, runnerSessionId: runner)
    case .changes(let sessionId, let label):
      ChangesView(sessionId: sessionId, label: label)
    case .fileDiff(let sessionId, let path, let mode):
      FileDiffView(sessionId: sessionId, path: path, mode: mode)
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
    case .issue(let ref):
      IssueView(ref: ref).id(ref)
    case .design(let url, let sessionId):
      DesignView(url: url, sessionId: sessionId).id(url)
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
    case .settingsPage(let page):
      page.screen
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
    case .more:
      MoreView()
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
        localizedReason: "Unlock Argus")) ?? false
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
    Group {
      if let project = router.detailProject {
        ProjectView(repoRoot: project.repoRoot, name: project.name)
      } else {
        RootView.sectionRoot(router.section)
      }
    }
    .task(id: router.section) {
      guard let route = router.pendingDetail, router.detailProject == nil else { return }
      router.pendingDetail = nil
      router.detailStack = [route]
    }
  }
}
