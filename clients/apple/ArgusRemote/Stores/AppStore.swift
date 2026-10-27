import ArgusAuth
import ArgusUI
import Foundation
import Observation

/// The phone's shell around the shared `HostStore`: the paired computers,
/// endpoint racing, push registration and phone-only preferences.
///
/// Several computers can be paired; exactly one is connected at a time. Each
/// connect hands a fresh `GatewayBackend` to `host`, and switching computers
/// resets it so nothing from the previous one bleeds into the next.
@MainActor
@Observable
final class AppStore {
  // MARK: Identity and connection
  //
  // These are module-internal rather than `private(set)`: the store is split
  // across several files to stay readable, and Swift scopes `private(set)` to
  // one file. Views read them; only the store's own extensions write them.

  /// QR pairings, from the keystore.
  var pairedHosts: [DeviceIdentity] = []
  /// Hosts on the signed-in account, rebuilt from its verified log. Their
  /// grants live here only: the host re-states them on every connect.
  var accountHosts: [DeviceIdentity] = []
  /// Every computer this phone can reach, one row each.
  var hosts: [DeviceIdentity] { .merging(paired: pairedHosts, account: accountHosts) }
  var activeHostId: String?
  var identity: DeviceIdentity?
  /// False until the stored pairings have been read back from the keychain.
  var loaded = false
  var deviceName: String = UIDeviceName.current
  var themePreference: ThemePreference = .system
  var colorTheme: ColorTheme = .muted
  /// Opens Read calls that returned an image, so screenshots show without a tap.
  var autoExpandImageReads = false
  /// The mode new agents started from this phone begin in; nil leaves it to
  /// the computer, as the desktop's own default does for its agents.
  var defaultPermissionMode: RemotePermissionMode?
  /// Failures shown this launch, newest first — the phone's `/notifications`.
  var warnings: [AppWarning] = []
  var unseenWarnings = 0
  /// Mirrored from `Telemetry` so the Settings toggle has something to bind to.
  var telemetryMode: TelemetryMode = .presence
  var pushState: PushState = .off
  var pushEnabled = true

  /// The connected computer's data and actions.
  let host = HostStore()
  /// The Argus account: sign-in, and the computers on it.
  let account: AccountStore

  // MARK: Collaborators

  let keystore = Keystore()
  let preferences = Preferences()
  let pendingDecisions = PendingDecisionStore()
  let agentHosts = AgentHostIndex()

  /// Bumped on every connect so a probe that finishes after the user switched
  /// computers can't clobber the newer connection.
  private var connectGeneration = 0

  init() {
    let name = Preferences().string(PreferenceKey.deviceName) ?? UIDeviceName.current
    account = AccountStore(auth: AccountAuth(), deviceKind: "ios", deviceName: { name })
    host.hooks = HostStoreHooks(
      track: { Telemetry.capture(TelemetryEvent($0)) },
      errorReported: { [weak self] error, scope in
        self?.noteWarning(HostStore.describe(error))
        Telemetry.capture(.appError(scope: scope, message: HostStore.describe(error)))
        Telemetry.captureException(error, source: "app_error", extra: ["scope": scope])
      },
      notify: { NotificationPresenter.present($0) },
      agentsSeen: { [weak self] agentIds in
        guard let self, let hostId = self.activeHostId else { return }
        self.agentHosts.remember(agentIds: agentIds, hostId: hostId)
      },
      endpointsChanged: { [weak self] endpoints in
        Task { await self?.endpointsChanged(endpoints) }
      },
      decisionUndelivered: { [weak self] agentId, toolUseId, decision in
        self?.queueOfflineDecision(agentId: agentId, toolUseId: toolUseId, decision: decision)
      })
  }

  // MARK: Lifecycle

  func initialize() async {
    telemetryMode = Telemetry.currentMode
    pushEnabled = preferences.string(PreferenceKey.pushEnabled) != "off"
    deviceName = preferences.string(PreferenceKey.deviceName) ?? UIDeviceName.current
    themePreference =
      ThemePreference(rawValue: preferences.string(PreferenceKey.theme) ?? "") ?? .system
    colorTheme = .sanitize(preferences.string(PreferenceKey.colorTheme))
    autoExpandImageReads = preferences.string(PreferenceKey.autoExpandImageReads) == "on"
    defaultPermissionMode = preferences.string(PreferenceKey.defaultPermissionMode)
      .flatMap(RemotePermissionMode.init(rawValue:))

    let stored = await keystore.load()
    pairedHosts = stored.hosts
    activeHostId = stored.activeId
    loaded = true
    // An account host connects once the account's log has listed it.
    Task { await startAccount() }

    if let activeId = stored.activeId,
      let identity = stored.hosts.first(where: { $0.deviceId == activeId })
    {
      await connect(to: identity)
    }
  }

  /// Connect to a paired computer, dropping the previous one's data.
  ///
  /// Selecting the computer we are already on is a no-op. Leaving a session
  /// and re-entering it from the home screen is the common case, and tearing
  /// down a working connection to race every endpoint again is both slow and
  /// visible. A dropped connection still re-races, because the tap is then
  /// the user asking us to try again.
  func selectHost(_ deviceId: String) async {
    guard let identity = hosts.first(where: { $0.deviceId == deviceId }) else { return }
    if deviceId == activeHostId, host.backend != nil, host.connection != .offline { return }
    Telemetry.capture(.hostSwitched(hostCount: hosts.count))

    // Adopt the target before any awaiting, so a screen pushed on the same
    // tap can name it and show its own connecting state instead of "Argus".
    self.identity = identity
    self.activeHostId = deviceId
    host.capabilities = identity.capabilities

    await disconnect()
    clearHostData()
    _ = await keystore.setActive(deviceId)
    await connect(to: identity)
  }

  func pairCompleted(_ identity: DeviceIdentity) async {
    Telemetry.capture(
      .paired(
        endpointKind: identity.endpoints?.first?.kind.rawValue ?? "unknown",
        hasControl: identity.capabilities.contains("control")))
    await disconnect()
    clearHostData()
    let state = await keystore.add(identity)
    pairedHosts = state.hosts
    activeHostId = state.activeId
    await connect(to: identity)
  }

  func renameHost(_ deviceId: String, to name: String) async {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let state = await keystore.update(deviceId: deviceId) { $0.hostName = trimmed }
    pairedHosts = state.hosts
    if identity?.deviceId == deviceId { identity?.hostName = trimmed }
  }

  func unpairHost(_ deviceId: String) async {
    if activeHostId == deviceId {
      // Best-effort: the computer should stop pushing to a phone that just
      // dropped its key, but an offline unpair must still succeed locally.
      _ = try? await host.backend?.request(
        .deviceUnregisterPush, EmptyParams(), as: IgnoredResult.self)
      await disconnect()
      clearHostData()
    }
    agentHosts.forget(hostId: deviceId)
    let state = await keystore.remove(deviceId: deviceId)
    pairedHosts = state.hosts
    activeHostId = state.activeId
    identity = nil
    host.capabilities = []
  }

  /// Which computer owns a given agent — a push carries only an agent id.
  func hostId(forAgent agentId: String) -> String? {
    agentHosts.host(forAgent: agentId)
  }

  func connect(to identity: DeviceIdentity) async {
    self.identity = identity
    host.capabilities = identity.capabilities
    connectGeneration += 1
    let generation = connectGeneration
    host.beginConnecting()

    do {
      let attempt = try await EndpointRacer.connectBest(identity: identity)
      // The user may have switched computers while we were probing.
      guard generation == connectGeneration else {
        await attempt.transport.disconnect()
        return
      }
      if identity.isAccountHost { account.setConnectionFailing(false) }
      let backend = GatewayBackend(transport: attempt.transport)
      await host.attach(backend)
      await onReady(backend, identity: identity, winningURL: attempt.url)
    } catch {
      guard generation == connectGeneration else { return }
      host.connectFailed("Couldn't reach this computer on any known address.")
      // Its tunnel may have moved: watch the directory for the new address.
      if identity.isAccountHost { account.setConnectionFailing(true) }
    }
  }

  func disconnect() async {
    await host.detach()
  }

  /// Everything a fresh connection has to settle before the UI is trustworthy.
  private func onReady(_ backend: GatewayBackend, identity: DeviceIdentity, winningURL: String)
    async
  {
    struct RenameParams: Encodable { let name: String }
    struct CapabilitiesResult: Decodable { let capabilities: [String] }
    struct EndpointsResult: Decodable { let endpoints: [RemoteEndpoint] }

    _ = try? await backend.request(
      .deviceRename, RenameParams(name: deviceName), as: IgnoredResult.self)

    // Grants may have changed while this phone was away.
    if let result = try? await backend.request(
      .deviceCapabilities, EmptyParams(), as: CapabilitiesResult.self)
    {
      host.capabilities = result.capabilities
      await updateHost(identity.deviceId) { $0.capabilities = result.capabilities }
    }

    await registerPush(backend)
    await flushPendingDecisions(backend)

    // Re-sync addresses so a phone paired over Wi-Fi learns the tunnels, without
    // forgetting one that just isn't up right now.
    if let result = try? await backend.request(
      .hostEndpoints, EmptyParams(), as: EndpointsResult.self)
    {
      await updateHost(identity.deviceId) {
        $0.endpoints = DeviceIdentity.mergedEndpoints(known: $0.endpoints, live: result.endpoints)
        $0.url = winningURL
      }
      self.identity = hosts.first { $0.deviceId == identity.deviceId } ?? self.identity
    }
  }

  func clearHostData() {
    host.reset()
    pushState = .off
  }

  private func endpointsChanged(_ endpoints: [RemoteEndpoint]) async {
    guard let deviceId = identity?.deviceId else { return }
    await updateHost(deviceId) {
      $0.endpoints = DeviceIdentity.mergedEndpoints(known: $0.endpoints, live: endpoints)
    }
  }

  // MARK: Preferences

  func setTelemetryMode(_ mode: TelemetryMode) {
    telemetryMode = mode
    Telemetry.setMode(mode)
  }

  func setThemePreference(_ preference: ThemePreference) {
    themePreference = preference
    preferences.set(preference.rawValue, for: PreferenceKey.theme)
  }

  func setColorTheme(_ theme: ColorTheme) {
    guard theme != colorTheme else { return }
    colorTheme = theme
    preferences.set(theme.rawValue, for: PreferenceKey.colorTheme)
    Telemetry.capture(.colorThemeChanged(theme: theme.rawValue))
  }

  func setAutoExpandImageReads(_ enabled: Bool) {
    autoExpandImageReads = enabled
    preferences.set(enabled ? "on" : "off", for: PreferenceKey.autoExpandImageReads)
    Telemetry.capture(.settingChanged(setting: .autoExpandImageReads, enabled: enabled))
  }

  func setDefaultPermissionMode(_ mode: RemotePermissionMode?) {
    defaultPermissionMode = mode
    preferences.set(mode?.rawValue, for: PreferenceKey.defaultPermissionMode)
    Telemetry.capture(.defaultChanged(setting: .permissionMode, value: mode?.rawValue ?? "computer"))
  }

  // MARK: Warnings

  private static let warningCap = 50

  private func noteWarning(_ message: String) {
    // A polling screen repeats its failure every few seconds; keep one entry.
    if warnings.first?.message == message {
      warnings[0] = AppWarning(message: message, at: Date())
      return
    }
    warnings.insert(AppWarning(message: message, at: Date()), at: 0)
    if warnings.count > Self.warningCap { warnings.removeLast(warnings.count - Self.warningCap) }
    unseenWarnings += 1
  }

  func markWarningsSeen() { unseenWarnings = 0 }

  func clearWarnings() {
    warnings = []
    unseenWarnings = 0
  }
}

/// One failure the user was shown, kept so a toast that vanished can be read.
struct AppWarning: Identifiable, Hashable {
  let id = UUID()
  let message: String
  let at: Date
}
