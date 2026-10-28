import AppKit
import ArgusCore
import ArgusUpdate
import Foundation
import Observation

/// The server: the supervised host, the socket to it, and what the menu shows.
/// No session UI — paired clients drive the host; this keeps it running.
@MainActor
@Observable
final class ServerModel {
  let location: HostLocation
  let supervisor: HostSupervisor
  let pairing: PairingModel
  let link = HostLinkModel(surface: .menubar)
  let updater: MenuUpdater
  let loginItem = LoginItem()
  let legacyAgent: LegacyServerAgent

  private(set) var backend: LocalBackend?
  private(set) var remote: ArgusProtocol.RemoteStatus?
  private(set) var agents: [ArgusProtocol.RemoteAgentStatus] = []
  var account: ArgusProtocol.AccountStatus?
  var approval: ArgusProtocol.AccountApprovalState = .idle(.init(kind: "idle"))
  var requests: [ArgusProtocol.AccountJoinRequest] = []
  var online: Bool?
  /// The last account action's failure, shown until dismissed.
  var notice: String?
  private(set) var autoInstall = false
  private(set) var legacySecrets: [ArgusProtocol.SecretStoreId] = []
  private(set) var loginState: LoginItemState = .off
  var oldLoginAgent = false
  /// Opens a window scene by id; the menu's views hand it over.
  @ObservationIgnored var openWindow: ((String) -> Void)?
  @ObservationIgnored var openSettings: (() -> Void)?
  /// The app delegate's Quit, which asks about running agents.
  @ObservationIgnored var onQuit: (() -> Void)?
  @ObservationIgnored private var pollers: [Task<Void, Never>] = []
  @ObservationIgnored private var events: Task<Void, Never>?
  @ObservationIgnored let notifier = ServerNotifier()

  static var isDebug: Bool {
    #if DEBUG
      true
    #else
      false
    #endif
  }

  init(location: HostLocation = .server(isDebug: ServerModel.isDebug)) {
    self.location = location
    var environment: [String: String] = [:]
    // Debug only: loopback pairing for a desktop on this Mac (docs/server-app.md).
    if Self.isDebug { environment["ARGUS_DEV_TRUST"] = "1" }
    supervisor = HostSupervisor(configuration: location.configuration(environment: environment))
    legacyAgent = LegacyServerAgent(home: location.home)
    updater = MenuUpdater(feed: UpdateFeed(product: "argus-server", channel: .latest))
    pairing = PairingModel()
    pairing.backend = { [weak self] in self?.backend }
    pairing.onStage = { [weak self] stage, _, grants in self?.pairingStage(stage, grants: grants) }
    pairing.onPaired = { [weak self] in Task { await self?.refreshRemote() } }
    supervisor.onEvent = { [weak self] event in self?.supervisorEvent(event) }
    updater.onEvent = { [weak self] event in self?.updaterEvent(event) }
    notifier.onOpen = { [weak self] target in self?.open(target) }
  }

  var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
  }

  var port: Int { location.port ?? 47617 }
  var webClientURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }

  // MARK: Lifecycle

  func start() {
    refreshLoginState()
    oldLoginAgent = !Self.isDebug && legacyAgent.isInstalled
    ServerTelemetry.capture(
      .launched(loginItem: loginState.telemetry, launchedByLaunchd: loginItem.launchedByLaunchd()))
    supervisor.start()
    startPolling()
  }

  func refreshLoginState() {
    loginState = loginItem.state
  }

  /// Stop the host: a running agent gets `timeout` to stop and save.
  func shutdown(timeout: Duration = .seconds(15)) async {
    for poller in pollers { poller.cancel() }
    events?.cancel()
    pairing.close()
    PairingCodeFile.remove(home: location.home)
    ServerTelemetry.detach()
    await backend?.disconnect()
    await supervisor.stop(timeout: timeout)
  }

  var activeAgents: Int { ServerMenuModel.activeCount(agents) }

  // MARK: Connection

  private func supervisorEvent(_ event: HostSupervisor.Event) {
    switch event {
    case .started(let restarts):
      ServerTelemetry.capture(.host(stage: .started, restarts: restarts, exitCode: nil, holder: nil, success: nil))
      connect()
    case .attached:
      connect()
    case .crashed(let exitCode, let attempt):
      ServerTelemetry.capture(
        .host(stage: .crashed, restarts: attempt, exitCode: Int(exitCode), holder: nil, success: nil))
    case .gaveUp(let crashes):
      ServerTelemetry.capture(.host(stage: .gaveUp, restarts: crashes, exitCode: nil, holder: nil, success: nil))
    case .lockConflict(let holder):
      ServerTelemetry.capture(.host(stage: .lockConflict, restarts: nil, exitCode: nil, holder: .init(holder), success: nil))
    case .handover(let holder, let success):
      ServerTelemetry.capture(.host(stage: .handover, restarts: nil, exitCode: nil, holder: .init(holder), success: success))
      if holder == .electron { ServerTelemetry.capture(.migrated(from: .electronRunning, success: success)) }
    case .holderExited:
      break
    }
  }

  /// The transport reconnects across host restarts on its own, so the backend
  /// is made once and every reconnect refetches.
  private func connect() {
    guard backend == nil else { return }
    let backend = LocalBackend(socketPath: supervisor.configuration.socketPath)
    self.backend = backend
    events = Task { [weak self] in
      let stream = await backend.events()
      for await event in stream {
        guard case .event(let envelope) = event, envelope.event == "ipc" else {
          if case .state(.ready) = event { await self?.reconnected() }
          continue
        }
        self?.ipc(envelope.payload)
      }
    }
    Task { await reconnected() }
  }

  private func reconnected() async {
    guard let backend else { return }
    await ServerTelemetry.attach(backend)
    let settings = try? await backend.request(ArgusProtocol.Commands.GetAppSettings.self, EmptyParams())
    autoInstall = settings?.serverAutoInstallUpdates == true
    updater.feed.channel = UpdateChannel(setting: settings?.updaterChannel?.rawValue)
    legacySecrets = (try? await backend.request(ArgusProtocol.Commands.LegacySecretStores.self, EmptyParams())) ?? []
    await refreshRemote()
    await refreshAgents()
    await refreshAccount()
    await refreshRequests()
  }

  private func ipc(_ payload: JSONValue) {
    guard let channel = payload["channel"]?.stringValue else { return }
    let arg = payload["args"]?.arrayValue?.first ?? .null
    switch channel {
    case "remote:status":
      if let next = try? ProtocolCodec.convert(arg, to: ArgusProtocol.RemoteStatus.self) { remote = next }
    case "account:status":
      let wasLinked = account?.linked
      if let next = try? ProtocolCodec.convert(arg, to: ArgusProtocol.AccountStatus.self) {
        account = next
        if next.linked != wasLinked { Task { await refreshRequests() } }
      }
    case "account:link-state":
      if let next = try? ProtocolCodec.convert(arg, to: ArgusProtocol.AccountLinkState.self) {
        account?.link = next
        link.observe(next)
      }
    case "account:approval-state":
      if let next = try? ProtocolCodec.convert(arg, to: ArgusProtocol.AccountApprovalState.self) {
        approval = next
      }
    default:
      if pairing.handle(channel: channel, payload: arg), case .confirming(let sas, _) = pairing.flow.phase {
        notifier.pairingCode(sas)
      }
    }
  }

  // MARK: Refresh

  private func startPolling() {
    // Agent states change in many places; a 2 s read is what the Electron tray polls.
    pollers.append(
      Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(2))
          await self?.tick()
        }
      })
    // Join requests and presence need the network; a minute is plenty.
    pollers.append(
      Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(60))
          await self?.refreshRequests()
        }
      })
    // An unattended restart waits for the last agent; a minute's latency is fine.
    pollers.append(
      Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(60))
          self?.maybeAutoInstall()
          self?.refreshLoginState()
        }
      })
  }

  private func tick() async {
    // Whoever held the home quit (a take-over, the old server's agent unloaded): run ours.
    if case .holderExited = supervisor.state { supervisor.start() }
    await refreshAgents()
  }

  func refreshAgents() async {
    guard let backend, supervisor.isConnected else { return }
    struct Result: Decodable { let agents: [ArgusProtocol.RemoteAgentStatus] }
    guard let result = try? await backend.request(.agentsList, EmptyParams(), as: Result.self) else { return }
    agents = result.agents.filter { $0.status != .stopped }
  }

  func refreshRemote() async {
    guard let backend else { return }
    remote = (try? await backend.request(ArgusProtocol.Commands.RemoteGetStatus.self, .init())) ?? remote
  }

  func refreshAccount() async {
    guard let backend else { return }
    account = (try? await backend.request(ArgusProtocol.Commands.AccountGetStatus.self, EmptyParams())) ?? account
  }

  func refreshRequests() async {
    guard let backend, let account, account.linked, account.config.enabled else {
      requests = []
      online = nil
      return
    }
    let previous = Set(requests.map(\.requestId))
    async let nextRequests = try? backend.request(ArgusProtocol.Commands.AccountListRequests.self, EmptyParams())
    async let hosts = try? backend.request(ArgusProtocol.Commands.AccountListHosts.self, EmptyParams())
    requests = await nextRequests ?? requests
    online = await hosts?.first(where: \.isSelf)?.online ?? online
    for request in requests where !previous.contains(request.requestId) {
      notifier.joinRequest(request)
    }
  }

  // MARK: Menu

  var snapshot: ServerMenuSnapshot {
    ServerMenuSnapshot(
      version: version,
      host: supervisor.state,
      port: port,
      stateDir: (location.home.path as NSString).abbreviatingWithTildeInPath,
      remote: remote,
      agents: agents,
      account: account.map {
        AccountMenuSnapshot(
          status: $0, approval: approval, tunnel: remote?.managedTunnel,
          requests: $0.linked ? requests : [], online: $0.linked ? online : nil, notice: notice)
      },
      pairing: pairing.flow.phase,
      update: updater.state,
      autoInstall: autoInstall,
      loginItem: loginState,
      legacySecrets: legacySecrets.map { $0 == .remoteDevices ? "paired devices" : "MCP sign-ins" },
      oldLoginAgent: oldLoginAgent)
  }

  var menuItems: [ServerMenuItem] { ServerMenuModel.items(snapshot) }

  // MARK: Updates

  func setAutoInstall(_ on: Bool) async {
    guard let backend else { return }
    struct Params: Encodable, Sendable { let settings: [String: JSONValue] }
    let saved = try? await backend.request(
      method: ArgusProtocol.Commands.SetAppSettings.name, Params(settings: ["server_auto_install_updates": .bool(on)]),
      as: ArgusProtocol.AppSettings.self)
    autoInstall = saved?.serverAutoInstallUpdates ?? autoInstall
    maybeAutoInstall()
  }

  func setUpdateChannel(_ channel: UpdateChannel) async {
    updater.feed.channel = channel
    guard let backend else { return }
    struct Params: Encodable, Sendable { let settings: [String: JSONValue] }
    _ = try? await backend.request(
      method: ArgusProtocol.Commands.SetAppSettings.name, Params(settings: ["updater_channel": .string(channel.rawValue)]),
      as: ArgusProtocol.AppSettings.self)
  }

  /// Opted in: take an update the moment the machine is quiet — download it
  /// too, since nobody is at an unattended server to click.
  func maybeAutoInstall() {
    guard autoInstall else { return }
    switch updater.state {
    case .available: updater.download()
    case .ready:
      if updater.install(activeAgents: activeAgents) == .ok {
        ServerTelemetry.capture(.update(stage: .autoInstalled))
      }
    default: break
    }
  }

  private func updaterEvent(_ event: MenuUpdater.Event) {
    switch event {
    case .checked: ServerTelemetry.capture(.update(stage: .checked))
    case .downloaded:
      ServerTelemetry.capture(.update(stage: .downloaded))
      maybeAutoInstall()
    case .installing: ServerTelemetry.capture(.update(stage: .installed))
    case .failed: ServerTelemetry.capture(.update(stage: .failed))
    }
    if case .available = updater.state { maybeAutoInstall() }
  }

  // MARK: Pairing

  private func pairingStage(_ stage: PairingModel.Stage, grants: (control: Bool, admin: Bool)) {
    let grant: ServerTelemetryEvent.Grant = grants.admin ? .admin : grants.control ? .control : .monitor
    switch stage {
    case .started:
      if case .waitingForDevice(_, let code) = pairing.flow.phase {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(code, forType: .string)
        PairingCodeFile.write(code, home: location.home)
      }
    case .confirmed: ServerTelemetry.capture(.pairing(stage: .confirmed, grant: grant))
    case .completed: PairingCodeFile.remove(home: location.home)
    case .failed:
      PairingCodeFile.remove(home: location.home)
      ServerTelemetry.capture(.pairing(stage: .failed, grant: .none))
    case .cancelled:
      PairingCodeFile.remove(home: location.home)
      ServerTelemetry.capture(.pairing(stage: .cancelled, grant: .none))
    case .rejected:
      PairingCodeFile.remove(home: location.home)
      ServerTelemetry.capture(.pairing(stage: .rejected, grant: .none))
    }
  }
}

/// `$ARGUS_HOME/pairing-code.txt`: the code for someone at the mini over SSH.
/// Owner-only, and gone once the pairing settles or the app quits.
enum PairingCodeFile {
  static func url(home: URL) -> URL { home.appendingPathComponent("pairing-code.txt") }

  static func write(_ code: String, home: URL) {
    let file = url(home: home)
    FileManager.default.createFile(
      atPath: file.path, contents: Data("\(code)\n".utf8), attributes: [.posixPermissions: 0o600])
  }

  static func remove(home: URL) {
    try? FileManager.default.removeItem(at: url(home: home))
  }
}
