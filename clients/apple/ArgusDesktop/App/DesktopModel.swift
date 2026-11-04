import AppKit
import ArgusAuth
import ArgusCore
import ArgusKit
import ArgusUpdate
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
  /// Each session's side panel: terminals, device, browser, files, diff and pull request tabs.
  let panels = SidePanelModel()
  let agentTabOrder = AgentTabOrder()
  /// Widths the session toolbar lays its items out by.
  let toolbarLayout = ToolbarLayout()
  /// Each session's open files in the code view.
  let code: CodeStore
  /// Language servers behind the code view: diagnostics, hover, completion, definitions.
  let languages: LanguageSupport
  let notificationsLog: NotificationsLog
  let huddles: HuddleStore
  /// Paired hosts this window drives besides its own.
  let hosts: RemoteHostsStore
  /// The Argus account: sign-in, and the hosts on it.
  let account: AccountStore
  /// The bundled host, linked to the account without a code.
  let localAccountLink = LocalHostAccountLink()
  /// The menu-bar item, when Settings shows it.
  let menuBar = MenuBarModel()
  /// Sparkle, on the channel the host's `updater_channel` names.
  let updater = StandardUpdater(feed: UpdateFeed(product: "argus-mac", channel: .latest))
  /// Every request, routed to the host that owns its subject.
  private(set) var backend: HostRouter?
  /// The supervised host alone: platform requests and telemetry are this Mac's.
  private(set) var localBackend: LocalBackend?

  var route: DesktopRoute = .home {
    didSet {
      if route.sessionId != oldValue.sessionId { viewedSessionChanged(from: oldValue.sessionId) }
    }
  }
  /// The project the New Session sheet is open for.
  var newSessionProject: RemoteProject?
  /// The session the Delete sheet is open for.
  var deletingSession: RemoteSession?
  /// Bumped to put the caret in the chat input in front (⌘L).
  var composerFocusRequest = 0
  /// The tab the Settings window shows.
  var settingsTab: SettingsTab = .general
  /// The project the Project Settings sheet is open for.
  var projectSettingsRepo: String?
  /// The Add Project flow (⌘O).
  var addingProject = false
  /// The Import from Claude Code sheet.
  var importingCliProjects = false
  /// A folder pick on a paired host's disk (`pickFolder`).
  var hostFolderRequest: HostFolderRequest?
  /// The machine the sidebar is narrowed to; nil shows every attached one.
  var machineFilter: HostId?
  /// The git sub-view each session was last left on.
  var gitViews: [String: GitRoute] = [:]
  /// Sessions last left on their git panel.
  var gitPanelSessions: Set<String> = []
  /// Sessions last left on their code view, and the file each showed.
  var codePanelSessions: Set<String> = []
  var lastCodePaths: [String: String] = [:]
  /// The agent each session last showed.
  var lastAgents: [String: String] = [:]
  /// An agent opened the moment it was spawned, before any list names it.
  var spawnedAgent: String?
  private var launchRouteApplied = false
  /// The active tab's back and forward.
  var history = NavigationHistory()
  /// A navigation already made a history step this run-loop pass: a second
  /// one in the same user action replaces it rather than stacking.
  var historyStepOpen = false
  /// A launch route or deep link to a session no host has listed yet, held
  /// until its host connects (`resolvePendingLocation`).
  var pendingLocation: DesktopLocation?
  var pendingTimeout: Task<Void, Never>?
  /// The window's tabs, each a saved location with its own history; the
  /// active one's live state is `route`, `history` and the focused host.
  var tabs: [WindowTab] = WindowTab.restored()
  var activeTabId = WindowTab.localId

  /// The keychain's, except under `ARGUS_NO_KEYCHAIN` (debug only): a build
  /// signed differently from the one that sealed the vault makes macOS prompt
  /// for it, and a throwaway run (`pnpm shots`) has no business reading it.
  private static func accountVault() -> any AccountVaultStore {
    #if DEBUG
      let environment = ProcessInfo.processInfo.environment
      if let name = environment["ARGUS_ACCOUNT_FIXTURE"] { return MemoryAccountVault(fixtureVault(deviceName: name)) }
      if environment["ARGUS_NO_KEYCHAIN"] != nil { return MemoryAccountVault() }
    #endif
    return KeychainAccountVault()
  }

  #if DEBUG
    /// `ARGUS_ACCOUNT_FIXTURE=<device name>`: a made-up account this Mac founded,
    /// verified offline, so a capture shows a signed-in account without one.
    private static func fixtureVault(deviceName: String) -> AccountVault {
      let keys = AccountDeviceKeys.generate(kind: "mac", name: deviceName)
      guard let signer = keys.signer,
        let genesis = try? AccountEntryBuilder.make(
          accountId: "acct_fixture", epoch: 1, head: nil, signer: signer, .genesis(member: keys.member)),
        case .ok(let verified) = AccountLog.verify([genesis])
      else { return .empty }
      return AccountVault(keys: keys, root: verified.root, entries: [genesis])
    }
  #endif

  init() {
    supervisor = HostSupervisor(configuration: HostLocation.current.configuration())
    hosts = RemoteHostsStore(
      file: PairedHostsFile(url: HostLocation.current.home.appendingPathComponent("mac-paired-hosts.json")),
      clientInfo: PairingClientInfo(
        product: "Argus for Mac", kind: "desktop", device: AppPreferences.shared.effectiveDeviceName,
        version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String))
    account = AccountStore(
      auth: AccountAuth(), vault: Self.accountVault(), deviceKind: "mac",
      deviceName: { AppPreferences.shared.effectiveDeviceName }, localHost: localAccountLink)
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
          // Version skew, not a bug: the screen shows why, so just count it.
          if let method = HostStore.unsupportedMethod(error) {
            MacTelemetry.captureUnsupported(method: method)
            return
          }
          notificationsLog.push(.error, HostStore.describe(error), source: scope)
        }))
    store.capabilities = ["monitor", "control", "admin"]
    terminals = TerminalsStore(backend: { [store] in store.backend })
    pullRequests = PullRequestsStore(host: store)
    git = GitWorkspaces(host: store)
    code = CodeStore(host: store)
    languages = LanguageSupport.install(on: code)
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
    HomeDefaults.dropLegacyKeys()
    runtime = RuntimeModel(store: store)
    huddles = HuddleStore(store: store, runtime: runtime)
    store.hooks.sessionIsRemote = { [weak self] id in self?.host(ofSession: id) != Hosts.local }
    store.hooks.agentNotificationClicked = { [weak self] agentId, sessionId in
      NSApp.activate()
      self?.navigate(.session(id: sessionId, agentId: agentId))
    }
    supervisor.onEvent = { [weak self] event in self?.supervisorEvent(event) }
    platform.focusWindow = { NSApp.activate() }
    code.model = self
    BuiltinPalette.register(in: palette)
    SettingsPalette.register(in: palette)
    platform.closeDevicePopout = { [runtime] key in runtime.closePopout(key) }
    AutomationsWiring.install(in: self)
    hosts.onReady = { [weak self] hostId in Task { await self?.hostCameUp(hostId) } }
    hosts.onHostsChanged = { [weak self] in Task { await self?.reloadLists() } }
    hosts.onAction = { action, success in
      MacTelemetry.capture(.hostsUsed(action: .init(action), success: success))
    }
    account.onHostsChanged = { [hosts] identities in hosts.setAccountHosts(identities) }
    hosts.onAccountHostFailing = { [account] failing in account.setConnectionFailing(failing) }
    hosts.onRouteUpgraded = { from, to in MacTelemetry.capture(.routeUpgraded(from: from, to: to)) }
    wireAccount()
    menuBar.install(on: self)
  }

  func start() {
    AppPreferences.shared.applyTheme()
    AppPreferences.shared.applyDisplaySize()
    MacTelemetry.capture(.launched)
    supervisor.start()
  }

  /// A second window on another app's host rather than the app running it.
  var isAttached: Bool { supervisor.attachedTo != nil }

  /// The host is up — ours, or another app's we attached to. The transport
  /// reconnects across host restarts (and a take-over: the socket is the
  /// home's either way) on its own, so the backend is made once.
  private func hostRunning() async {
    platform.role = isAttached ? .viewer : .platform
    guard backend == nil else { return }
    let platform = platform
    let local = LocalBackend(socketPath: supervisor.configuration.socketPath) { envelope in
      Task { @MainActor in platform.handle(envelope) }
    }
    let hosts = hosts
    let router = HostRouter(
      local: local,
      snapshots: HostSnapshotFiles(directory: HostLocation.current.home.appendingPathComponent("mac-host-snapshots"))
    ) { hostId, event in hosts.linkEvent(hostId, event) }
    localBackend = local
    backend = router
    store.beginConnecting()
    await store.attach(router)
    platform.attach(local)
    // Before telemetry: the consent level is one of the host's preferences.
    // A second window never hands its own values to the host it joined.
    let supplied = await HostPreferences.shared.attach(.local(local), supply: !isAttached)
    runtime.reloadPersisted()
    panels.reloadPersisted()
    agentTabOrder.reloadPersisted()
    HomeRecents.shared.reload()
    _ = store.observeIpc { [weak self] channel, args, _ in
      guard channel == "prefs:changed", let change = args.first else { return }
      Task { await self?.hostPrefsChanged(change) }
    }
    await MacTelemetry.attach(local, applyMode: !isAttached)
    if supplied > 0 { MacTelemetry.capture(.prefsSupplied(keys: supplied)) }
    hosts.bind(router)
    viewedSessionChanged(from: nil)
    // Only the app running the host may put it on an account.
    if !isAttached { localAccountLink.backend = local }
    Task { await account.start() }
    watchConnection(local)
  }

  /// A paired host connected, or reconnected after a drop: it kept running
  /// agents while we were away, so its share of the window is refetched.
  private func hostCameUp(_ hostId: HostId) async {
    await syncAccount(hostId)
    await reloadLists()
    store.followAgents()
    store.resyncQueues()
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
        // A new connection: the host knows nothing of our window or role.
        self?.platform.reportState()
        await self?.reload()
        await self?.terminals.reconnected()
        await self?.code.reconnected()
        await self?.languages.reconnected()
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
    await applyLaunchRoute()
    resolvePendingLocation()
    await menuBar.reconnected()
  }

  /// The Launch screen setting, once per launch and only while nothing else
  /// has picked a screen — it replaces Home rather than stacking on it.
  private func applyLaunchRoute() async {
    guard !launchRouteApplied, let backend = localBackend else { return }
    launchRouteApplied = true
    let settings = try? await backend.request(ArgusProtocol.Commands.GetAppSettings.self, EmptyParams())
    updater.feed.channel = UpdateChannel(setting: settings?.updaterChannel?.rawValue)
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
      // `git:<sessionId>[:<view>[:<arg>…]]`
      case ("git", 2...):
        let view = parts.count > 2 ? GitRoute(devString: parts[2...].joined(separator: ":")) : nil
        open(.init(route: .sessionGit(id: parts[1], view: view ?? .working)))
      case ("pull-requests", _): navigate(.pullRequests)
      case ("issues", _): navigate(.issues())
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

  /// Another window on the host changed preferences: take its values.
  private func hostPrefsChanged(_ change: JSONValue) async {
    let keys = { (field: String) -> [String] in
      guard case .object(let fields) = change, case .array(let list)? = fields[field] else { return [] }
      return list.compactMap { if case .string(let key) = $0 { key } else { nil } }
    }
    await HostPreferences.shared.hostChanged(settings: keys("settings"), uiState: keys("ui_state"))
    runtime.reloadPersisted()
    panels.reloadPersisted()
    agentTabOrder.reloadPersisted()
    HomeRecents.shared.reload()
  }

  /// Taking over quits the other app and its agents with it, so it asks.
  func confirmTakeOver(_ holder: HostLockRecord) {
    let alert = NSAlert()
    alert.messageText = "Quit \(holder.appName) and run Argus here?"
    alert.informativeText =
      "\(holder.appName) is asked to quit, which stops its running agents, and this app starts its own host on the same Argus home."
    alert.addButton(withTitle: "Quit and Take Over")
    alert.addButton(withTitle: "Cancel")
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    supervisor.takeOver()
  }

  private func supervisorEvent(_ event: HostSupervisor.Event) {
    switch event {
    case .started(let restarts):
      MacTelemetry.capture(.hostStarted(restarts: restarts))
      if restarts == 0 { MacTelemetry.capture(.hostConnected(mode: .own, holder: nil)) }
      Task { await hostRunning() }
    case .attached(let holder):
      MacTelemetry.capture(.hostConnected(mode: .attached, holder: .init(holder)))
      Task { await hostRunning() }
    case .holderExited:
      break
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

  /// Agents quitting this app would stop: none when it only watches another app's host.
  var runningAgentCount: Int {
    guard supervisor.state == .running else { return 0 }
    return store.statusByAgent.values.filter { $0.status == .running }.count
  }

  /// Stop the host cleanly: it lets agents finish stopping before it exits.
  func shutdown() async {
    MacTelemetry.capture(.quit(hadRunningAgents: runningAgentCount > 0))
    menuBar.stop()
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
    case .macServer: self = .macServer
    case .cli: self = .cli
    }
  }
}
