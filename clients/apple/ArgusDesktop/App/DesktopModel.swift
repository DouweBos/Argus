import AppKit
import ArgusCore
import Foundation
import Observation

/// The app: the supervised host, the backend to it, the shared store, and the
/// route. Views read it from the environment.
@MainActor
@Observable
final class DesktopModel {
  let supervisor: HostSupervisor
  let store: HostStore
  let runtime: RuntimeModel
  let platform = PlatformBridge()
  let terminals: TerminalsStore
  let pullRequests: PullRequestsStore
  /// Each session's repository, opened when its git panel first shows.
  let git: GitWorkspaces
  let automations: AutomationsStore
  let proposals: ProposalsStore
  /// The inbox in full, from the host's catalog — the Mac's inbox and proposal screens.
  let inbox: InboxStore
  let palette = CommandPaletteModel()
  let notificationsLog: NotificationsLog
  let huddles: HuddleStore
  /// Paired hosts this window drives besides its own.
  let hosts: RemoteHostsStore
  /// Every request, routed to the host that owns its subject.
  private(set) var backend: HostRouter?
  /// The supervised host alone: platform requests and telemetry are this Mac's.
  private(set) var localBackend: LocalBackend?

  var route: DesktopRoute = .home
  /// The project the New Session sheet is open for.
  var newSessionProject: RemoteProject?
  /// The session the Delete sheet is open for.
  var deletingSession: RemoteSession?
  /// The bottom terminal panel under a session (⇧⌘T).
  var terminalPanelVisible = false
  /// The tab the Settings window shows.
  var settingsTab: SettingsTab = .general
  /// The project the Project Settings sheet is open for.
  var projectSettingsRepo: String?
  /// The Add Project flow (⌘O).
  var addingProject = false
  /// A folder pick on a paired host's disk (`pickFolder`).
  var hostFolderRequest: HostFolderRequest?
  /// The machine the sidebar is narrowed to; nil shows every attached one.
  var machineFilter: HostId?
  /// The panel each session was last left on, as the desktop app remembers.
  var agentsPanelSessions: Set<String> = []
  /// The git sub-view each session was last left on.
  var gitViews: [String: GitRoute] = [:]
  /// Sessions last left on their git panel.
  var gitPanelSessions: Set<String> = []
  private var launchRouteApplied = false
  private var tabRestored = false
  var back: [DesktopLocation] = []
  var forward: [DesktopLocation] = []
  /// A launch route or deep link to a session no host has listed yet, held
  /// until its host connects (`resolvePendingLocation`).
  var pendingLocation: DesktopLocation?
  var pendingTimeout: Task<Void, Never>?
  /// The window's tabs, each a saved location with its own history; the
  /// active one's live state is `route`, `back`, `forward` and the focused host.
  var tabs: [WindowTab] = WindowTab.restored()
  var activeTabId = WindowTab.restoredActive()

  init() {
    supervisor = HostSupervisor(configuration: HostLocation.configuration())
    hosts = RemoteHostsStore(
      file: PairedHostsFile(url: HostLocation.home.appendingPathComponent("mac-paired-hosts.json")),
      clientInfo: PairingClientInfo(
        product: "Argus for Mac", kind: "desktop", device: Host.current().localizedName,
        version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String))
    let notificationsLog = NotificationsLog()
    self.notificationsLog = notificationsLog
    store = HostStore(
      hooks: HostStoreHooks(
        // Only what the host can't see; the rest of the iOS catalog stays on iOS.
        track: { event in
          if case .pullRequestActed(let action) = event,
            let mac = MacTelemetryEvent.PullRequestAction(rawValue: action.rawValue)
          {
            MacTelemetry.capture(.pullRequestActed(action: mac))
          }
        },
        errorReported: { error, scope in
          NSLog("[argus] %@: %@", scope, HostStore.describe(error))
          notificationsLog.push(.error, HostStore.describe(error), source: scope)
        },
        // Banners only when you aren't already looking at the window.
        isAppFocused: { NSApp.isActive && NSApp.keyWindow != nil }))
    store.capabilities = ["monitor", "control", "admin"]
    terminals = TerminalsStore(backend: { [store] in store.backend })
    pullRequests = PullRequestsStore(host: store)
    git = GitWorkspaces(host: store)
    automations = AutomationsStore(host: store)
    proposals = ProposalsStore(host: store)
    inbox = InboxStore(host: store)
    terminals.replayed = { bytes, truncated in
      MacTelemetry.capture(
        .terminalReplayed(bytes: MacTelemetryEvent.byteBucket(bytes), truncated: truncated))
    }
    _ = store.observeIpc { [terminals] channel, args, seq in
      terminals.ipc(channel: channel, args: args, seq: seq)
    }
    runtime = RuntimeModel(store: store)
    huddles = HuddleStore(store: store, runtime: runtime)
    store.hooks.sessionIsRemote = { [weak self] id in self?.host(ofSession: id) != Hosts.local }
    store.hooks.agentNotificationClicked = { [weak self] agentId, sessionId in
      NSApp.activate()
      self?.navigate(.session(id: sessionId, agentId: agentId))
    }
    supervisor.onEvent = { [weak self] event in self?.supervisorEvent(event) }
    platform.focusWindow = { NSApp.activate() }
    BuiltinPalette.register(in: palette)
    SettingsPalette.register(in: palette)
    platform.closeDevicePopout = { [runtime] key in runtime.closePopout(key) }
    AutomationsWiring.install(in: self)
    hosts.onReady = { [weak self] hostId in Task { await self?.hostCameUp(hostId) } }
    hosts.onHostsChanged = { [weak self] in Task { await self?.reloadLists() } }
    hosts.onAction = { action, success in
      MacTelemetry.capture(.hostsUsed(action: .init(action), success: success))
    }
  }

  func start() {
    AppPreferences.shared.applyTheme()
    AppPreferences.shared.applyDisplaySize()
    MacTelemetry.capture(.launched)
    supervisor.start()
  }

  /// The host is up. The transport reconnects across host restarts on its
  /// own, so the backend is made once.
  private func hostRunning() async {
    guard backend == nil else { return }
    let platform = platform
    let local = LocalBackend(socketPath: supervisor.configuration.socketPath) { envelope in
      Task { @MainActor in platform.handle(envelope) }
    }
    let hosts = hosts
    let router = HostRouter(
      local: local,
      snapshots: HostSnapshotFiles(directory: HostLocation.home.appendingPathComponent("mac-host-snapshots"))
    ) { hostId, event in hosts.linkEvent(hostId, event) }
    localBackend = local
    backend = router
    store.beginConnecting()
    await store.attach(router)
    platform.attach(local)
    await MacTelemetry.attach(local)
    hosts.bind(router)
    watchConnection(local)
  }

  /// A paired host connected, or reconnected after a drop: it kept running
  /// agents while we were away, so its share of the window is refetched.
  private func hostCameUp(_ hostId: HostId) async {
    await reloadLists()
    await store.live?.resync()
    await terminals.reconnected()
    for project in store.projects where backend?.host(of: .project, project.repoRoot) == hostId {
      await openProject(project.repoRoot)
    }
    resolvePendingLocation()
  }

  /// The lists that span every host.
  func reloadLists() async {
    if let filter = machineFilter, filter != Hosts.local, !hosts.attached.contains(filter) {
      machineFilter = nil
    }
    await store.refreshProjects()
    await store.loadScratchPads()
    await store.loadRecentAgents()
  }

  /// Which machine a session lives on.
  func host(ofSession id: String) -> HostId {
    backend?.host(of: .session, id) ?? Hosts.local
  }

  func host(ofProject repoRoot: String) -> HostId {
    backend?.host(of: .project, repoRoot) ?? Hosts.local
  }

  /// Refetch on every (re)connect — the host may have restarted underneath
  /// us. The transport's own state is the truth: `attach` reports ready before
  /// the socket is, and a view can't see a flip it coalesced away.
  private func watchConnection(_ backend: LocalBackend) {
    Task { [weak self] in
      while !Task.isCancelled {
        while await backend.transport.state != .ready {
          try? await Task.sleep(for: .milliseconds(200))
        }
        await self?.reload()
        await self?.terminals.reconnected()
        while await backend.transport.state == .ready {
          try? await Task.sleep(for: .milliseconds(500))
        }
      }
    }
  }

  /// Refetch what the window shows; called whenever the connection comes up.
  func reload() async {
    await store.refreshProjects()
    await store.loadScratchPads()
    await store.loadRecentAgents()
    await huddles.load()
    await AutomationsWiring.reload(self)
    for project in store.projects {
      await openProject(project.repoRoot)
    }
    #if DEBUG
      applyDevRoute()
    #endif
    restoreActiveTabOnce()
    await applyLaunchRoute()
    resolvePendingLocation()
  }

  private func restoreActiveTabOnce() {
    guard !tabRestored else { return }
    tabRestored = true
    restoreActiveTab()
  }

  /// The Launch screen setting, once per launch and only while nothing else
  /// has picked a screen — it replaces Home rather than stacking on it.
  private func applyLaunchRoute() async {
    guard !launchRouteApplied, let backend = localBackend else { return }
    launchRouteApplied = true
    let settings = try? await backend.request(ArgusProtocol.Commands.GetAppSettings.self, EmptyParams())
    guard settings?.launchRoute == .inbox, route == .home, pendingLocation == nil else { return }
    route = .inbox
  }

  #if DEBUG
    /// `ARGUS_DEV_ROUTE=session:<id>[:<agentId>]` or `devices` opens a screen at launch, so
    /// a dev build can be checked without anything clicking on it.
    private func applyDevRoute() {
      guard route == .home,
        let raw = ProcessInfo.processInfo.environment["ARGUS_DEV_ROUTE"]
      else { return }
      if raw.hasPrefix("/"), let location = DesktopLocation(path: raw) { return open(location) }
      let parts = raw.split(separator: ":").map(String.init)
      switch (parts.first, parts.count) {
      case ("session", 2...): open(.init(route: .session(id: parts[1], agentId: parts.count > 2 ? parts[2] : nil)))
      case ("home", 2...): open(.init(route: .sessionHome(id: parts[1])))
      // `git:<sessionId>[:<view>[:<arg>…]]`
      case ("git", 2...):
        let view = parts.count > 2 ? GitRoute(devString: parts[2...].joined(separator: ":")) : nil
        open(.init(route: .sessionGit(id: parts[1], view: view ?? .working)))
      case ("pull-requests", _): navigate(.pullRequests)
      case ("agents", _): navigate(.agents)
      case ("runtimes", _): navigate(.runtimes)
      case ("devices", _): navigate(.devices)
      default: break
      }
    }
  #endif

  /// What Electron does when a project opens: make sure its project-root
  /// session exists (the host makes it idempotently), then load its lists.
  func openProject(_ repoRoot: String) async {
    if let backend {
      _ = try? await backend.request(
        ArgusProtocol.Commands.CreateProjectRootSession.self, .init(repoRoot: repoRoot))
    }
    await store.loadSessions(repoRoot: repoRoot)
    await store.loadAgents(repoRoot: repoRoot)
  }

  private func supervisorEvent(_ event: HostSupervisor.Event) {
    switch event {
    case .started(let restarts):
      MacTelemetry.capture(.hostStarted(restarts: restarts))
      Task { await hostRunning() }
    case .crashed(let exitCode, let attempt):
      MacTelemetry.capture(.hostCrashed(exitCode: Int(exitCode), attempt: attempt))
    case .gaveUp(let crashes):
      MacTelemetry.capture(.hostFailed(crashes: crashes))
    case .lockConflict(let holder):
      MacTelemetry.capture(.hostLockConflict(holder: .init(holder)))
    case .handover(let holder, let success):
      MacTelemetry.capture(.hostHandover(holder: .init(holder), success: success))
    }
  }

  /// ⌘N: a new session in the project you're looking at, else the first.
  func requestNewSession() {
    let current = route.sessionId.flatMap { id in
      store.sessionsByRepo.values.joined().first { $0.id == id }?.repoRoot
    }
    newSessionProject =
      store.projects.first { $0.repoRoot == current } ?? store.projects.first
  }

  /// The session on screen, when it's a worktree (the project root can't go).
  var deletableSession: RemoteSession? {
    route.sessionId.flatMap { id in
      store.sessionsByRepo.values.joined().first { $0.id == id && $0.kind == .worktree }
    }
  }

  func requestDeleteSession() {
    deletingSession = deletableSession
  }

  // MARK: Quit

  var runningAgentCount: Int {
    store.live?.agents.values.filter { $0.status == .running }.count
      ?? store.statusByAgent.values.filter { $0.status == .running }.count
  }

  /// Stop the host cleanly: it lets agents finish stopping before it exits.
  func shutdown() async {
    MacTelemetry.capture(.quit(hadRunningAgents: runningAgentCount > 0))
    // The renderer's job on quit: every transcript saved before the host goes.
    await store.live?.saveAll()
    await store.detach()
    platform.detach()
    MacTelemetry.detach()
    await supervisor.stop()
  }
}

extension MacTelemetryEvent.Holder {
  init(_ owner: HostLockRecord.Owner) {
    switch owner {
    case .electron: self = .electron
    case .mac: self = .mac
    case .cli: self = .cli
    }
  }
}
