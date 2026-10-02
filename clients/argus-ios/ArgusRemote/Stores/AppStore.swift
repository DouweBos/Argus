import ArgusKit
import Foundation
import Observation

/// A message this client could not hand to the computer. It keeps the body it
/// would have sent — preamble and attachments included — so retrying is one
/// tap rather than retyping.
struct FailedSend: Identifiable, Sendable {
  var id: String
  var body: String
  var displayText: String?
  var images: [RemoteImageAttachment]

  /// What the user actually typed, without the linked-projects preamble.
  var text: String {
    LinkedProjects.parsePreamble(body)?.rest ?? displayText ?? body
  }
}

/// Owns the paired computers, the live `Transport` to the active one, and the
/// data it fetches. Views read slices and call actions; the transport pushes
/// events back in through `handle(_:)`.
///
/// Several computers can be paired; exactly one is connected at a time, and
/// everything fetched is cleared when that changes.
@MainActor
@Observable
final class AppStore {
  // MARK: Identity and connection
  //
  // These are module-internal rather than `private(set)`: the store is split
  // across several files to stay readable, and Swift scopes `private(set)` to
  // one file. Views read them; only the store's own extensions write them.

  var hosts: [DeviceIdentity] = []
  var activeHostId: String?
  var identity: DeviceIdentity?
  /// False until the stored pairings have been read back from the keychain.
  var loaded = false
  var connection: Transport.State = .offline
  var deviceName: String = UIDeviceName.current
  var themePreference: ThemePreference = .system
  /// Opens Read calls that returned an image, so screenshots show without a tap.
  var autoExpandImageReads = false
  /// Mirrored from `Telemetry` so the Settings toggle has something to bind to.
  var telemetryMode: TelemetryMode = .presence

  /// This device's grants, seeded from pairing and refreshed on every connect.
  var capabilities: [String] = []
  var hasControl: Bool { capabilities.contains("control") }

  // MARK: Per-host data
  //
  // Everything below belongs to the connected computer and is wiped wholesale
  // when that changes, so nothing from the previous one bleeds into the next.

  var projects: [RemoteProject] = []
  var sessionsByRepo: [String: [RemoteSession]] = [:]
  var agentsByRepo: [String: [RemoteAgentStatus]] = [:]
  /// Every agent across every project, for the home "Recent agents" section.
  var recentAgents: [RemoteAgentStatus] = []
  /// Sessions that belong to no project, each in its own directory.
  var scratchPads: [RemoteSession] = []
  /// LLM runners this computer has registered, for the spawn sheet's picker.
  var runners: [RemoteRunner] = []
  var stoppedByRepo: [String: [RemoteStoppedAgent]] = [:]
  var messagesByAgent: [String: [RemoteMessage]] = [:]
  /// Locally-appended user messages awaiting confirmation in the next snapshot.
  var optimisticByAgent: [String: [RemoteMessage]] = [:]
  /// Messages that never reached the computer, kept with their payload so a
  /// retry re-sends them instead of making you retype.
  var failedByAgent: [String: [FailedSend]] = [:]
  /// The computer's queue per agent — messages waiting on a busy agent.
  var queuedByAgent: [String: [RemoteQueuedMessage]] = [:]
  /// Queue adds still in flight. Separate from `queuedByAgent` because a queue
  /// event can replace that list before the computer has our add.
  var sendingQueuedByAgent: [String: [RemoteQueuedMessage]] = [:]
  var tasksByAgent: [String: [RemoteTask]] = [:]
  var todosByAgent: [String: [RemoteTodo]] = [:]
  /// Name of the tool currently executing per agent — drives the activity row.
  var pendingToolByAgent: [String: String] = [:]
  /// Cursor for the next older page per agent; nil means the start is reached.
  var prevBeforeByAgent: [String: Double] = [:]
  var gitStatusBySession: [String: RemoteGitStatus] = [:]
  var prompts: [String: RemotePermissionRequest] = [:]
  /// Prompts this client just answered — clears the inline form instantly,
  /// before the round trip lands.
  var answered: Set<String> = []
  /// Resolved image bytes keyed by `agentId:imageId`, as data URIs.
  var imageCache: [String: String] = [:]
  var capabilitiesByAgent: [String: RemoteAgentCapabilities] = [:]
  var statusByAgent: [String: RemoteAgentStatus] = [:]
  /// Locally-chosen effort per agent; the monitor snapshot doesn't carry it.
  var effortByAgent: [String: String] = [:]
  var devices: [RemoteDevice] = []
  /// Claude accounts signed in on the computer, and which one new agents run
  /// as. `nil` until the first load — an empty list would look like "signed
  /// out everywhere" rather than "not fetched yet".
  var claudeAccounts: [RemoteClaudeAccount]?
  var activeClaudeAccountId: String?
  /// The computer's in-flight Claude sign-in, if any.
  var claudeLogin: RemoteClaudeLoginState?
  /// Fold and orientation for watched devices, keyed by device id.
  var deviceStates: [String: RemoteDeviceState] = [:]
  /// Who is driving each watched device, and this connection's own id so the
  /// app can tell "someone else" from "me".
  var deviceClaims: [String: RemoteDeviceClaimState] = [:]
  var connectionId: String?
  var pushState: PushState = .off
  var pushEnabled = true

  /// The most recent error worth showing, if any.
  var lastError: String?

  // MARK: Collaborators

  let keystore = Keystore()
  let preferences = Preferences()
  let pendingDecisions = PendingDecisionStore()
  let agentHosts = AgentHostIndex()

  var transport: Transport?
  private var pump: Task<Void, Never>?
  /// Bumped on every connect so a probe that finishes after the user switched
  /// computers can't clobber the newer connection.
  private var connectGeneration = 0
  /// Debounces transcript refetches: a burst of agent events becomes one call.
  private var refetchTimers: [String: Task<Void, Never>] = [:]

  /// Frames arrive far too fast for observable state, and a view registers its
  /// sink only after `devices.watch` returns — so the config message that
  /// arrives first is buffered until someone is listening.
  private var mediaSinks: [UInt16: @MainActor (MediaMessage) -> Void] = [:]
  private var mediaBuffer: [UInt16: [MediaMessage]] = [:]
  private static let mediaBufferCap = 120

  static let transcriptPage = 80

  // MARK: Lifecycle

  func initialize() async {
    telemetryMode = Telemetry.currentMode
    pushEnabled = preferences.string(PreferenceKey.pushEnabled) != "off"
    deviceName = preferences.string(PreferenceKey.deviceName) ?? UIDeviceName.current
    themePreference =
      ThemePreference(rawValue: preferences.string(PreferenceKey.theme) ?? "") ?? .system
    autoExpandImageReads = preferences.string(PreferenceKey.autoExpandImageReads) == "on"

    let stored = await keystore.load()
    hosts = stored.hosts
    activeHostId = stored.activeId
    loaded = true

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
    if deviceId == activeHostId, transport != nil, connection != .offline { return }
    Telemetry.capture(.hostSwitched(hostCount: hosts.count))

    // Adopt the target before any awaiting, so a screen pushed on the same
    // tap can name it and show its own connecting state instead of "Argus".
    self.identity = identity
    self.activeHostId = deviceId
    capabilities = identity.capabilities

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
    hosts = state.hosts
    activeHostId = state.activeId
    await connect(to: identity)
  }

  func renameHost(_ deviceId: String, to name: String) async {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let state = await keystore.update(deviceId: deviceId) { $0.hostName = trimmed }
    hosts = state.hosts
    if identity?.deviceId == deviceId { identity?.hostName = trimmed }
  }

  func unpairHost(_ deviceId: String) async {
    if activeHostId == deviceId {
      // Best-effort: the computer should stop pushing to a phone that just
      // dropped its key, but an offline unpair must still succeed locally.
      try? await transport?.request(
        .deviceUnregisterPush, EmptyParams(), as: IgnoredResult.self)
      await disconnect()
      clearHostData()
    }
    agentHosts.forget(hostId: deviceId)
    let state = await keystore.remove(deviceId: deviceId)
    hosts = state.hosts
    activeHostId = state.activeId
    identity = nil
    capabilities = []
  }

  /// Which computer owns a given agent — a push carries only an agent id.
  func host(forAgent agentId: String) -> String? {
    agentHosts.host(forAgent: agentId)
  }

  private func connect(to identity: DeviceIdentity) async {
    self.identity = identity
    capabilities = identity.capabilities
    connectGeneration += 1
    let generation = connectGeneration
    connection = .connecting

    do {
      let attempt = try await EndpointRacer.connectBest(identity: identity)
      // The user may have switched computers while we were probing.
      guard generation == connectGeneration else {
        await attempt.transport.disconnect()
        return
      }
      transport = attempt.transport
      connection = .ready
      let stream = await attempt.transport.resubscribe()
      pump = Task { [weak self] in
        for await event in stream {
          await self?.handle(event)
        }
      }
      await onReady(attempt.transport, identity: identity, winningURL: attempt.url)
    } catch {
      guard generation == connectGeneration else { return }
      connection = .offline
      lastError = "Couldn't reach this computer on any known address."
    }
  }

  private func disconnect() async {
    pump?.cancel()
    pump = nil
    for (_, timer) in refetchTimers { timer.cancel() }
    refetchTimers.removeAll()
    await transport?.disconnect()
    transport = nil
    connection = .offline
  }

  /// Everything a fresh connection has to settle before the UI is trustworthy.
  private func onReady(_ transport: Transport, identity: DeviceIdentity, winningURL: String)
    async
  {
    struct RenameParams: Encodable { let name: String }
    struct CapabilitiesResult: Decodable { let capabilities: [String] }
    struct EndpointsResult: Decodable { let endpoints: [RemoteEndpoint] }

    try? await transport.request(
      .deviceRename, RenameParams(name: deviceName), as: IgnoredResult.self)

    // Grants may have changed while this phone was away.
    if let result = try? await transport.request(
      .deviceCapabilities, EmptyParams(), as: CapabilitiesResult.self)
    {
      capabilities = result.capabilities
      let state = await keystore.update(deviceId: identity.deviceId) {
        $0.capabilities = result.capabilities
      }
      hosts = state.hosts
    }

    await registerPush(transport)
    await flushPendingDecisions(transport)

    // Re-sync addresses so a phone paired over Wi-Fi learns the tunnels.
    if let result = try? await transport.request(
      .hostEndpoints, EmptyParams(), as: EndpointsResult.self)
    {
      let state = await keystore.update(deviceId: identity.deviceId) {
        $0.endpoints = result.endpoints
        $0.url = winningURL
      }
      hosts = state.hosts
      self.identity = state.hosts.first { $0.deviceId == identity.deviceId }
    }
  }

  private func clearHostData() {
    projects = []
    sessionsByRepo = [:]
    agentsByRepo = [:]
    recentAgents = []
    scratchPads = []
    stoppedByRepo = [:]
    messagesByAgent = [:]
    optimisticByAgent = [:]
    failedByAgent = [:]
    queuedByAgent = [:]
    sendingQueuedByAgent = [:]
    tasksByAgent = [:]
    todosByAgent = [:]
    pendingToolByAgent = [:]
    prevBeforeByAgent = [:]
    gitStatusBySession = [:]
    prompts = [:]
    answered = []
    imageCache = [:]
    capabilitiesByAgent = [:]
    statusByAgent = [:]
    effortByAgent = [:]
    devices = []
    claudeAccounts = nil
    activeClaudeAccountId = nil
    claudeLogin = nil
    deviceStates = [:]
    deviceClaims = [:]
    connectionId = nil
    pushState = .off
    lastError = nil
    mediaSinks = [:]
    mediaBuffer = [:]
  }

  // MARK: Events

  private func handle(_ event: Transport.Event) async {
    switch event {
    case .state(let state):
      connection = state
    case .media(let bytes):
      guard let message = MediaMessage.parse(bytes) else { return }
      deliver(message)
    case .event(let envelope):
      await handle(envelope)
    }
  }

  private func handle(_ envelope: EventEnvelope) async {
    guard let name = RemoteEventName(rawValue: envelope.event) else { return }
    switch name {
    case .hostEndpoints:
      struct Payload: Decodable { let endpoints: [RemoteEndpoint] }
      guard let payload = try? ProtocolCodec.convert(envelope.payload, to: Payload.self),
        let deviceId = identity?.deviceId
      else { return }
      let state = await keystore.update(deviceId: deviceId) { $0.endpoints = payload.endpoints }
      hosts = state.hosts

    case .permissionRequest:
      guard let request = try? ProtocolCodec.convert(
        envelope.payload, to: RemotePermissionRequest.self) else { return }
      prompts[promptKey(request.agentId, request.toolUseId)] = request
      scheduleTranscriptRefresh(request.agentId)

    case .permissionCancel:
      guard let cancel = try? ProtocolCodec.convert(
        envelope.payload, to: RemotePermissionCancel.self) else { return }
      prompts.removeValue(forKey: promptKey(cancel.agentId, cancel.toolUseId))
      scheduleTranscriptRefresh(cancel.agentId)

    case .agentStatus:
      guard let status = try? ProtocolCodec.convert(
        envelope.payload, to: RemoteAgentStatus.self) else { return }
      apply(status)

    case .agentQueue:
      struct Payload: Decodable {
        let agent_id: String
        let messages: [RemoteQueuedMessage]
      }
      guard let payload = try? ProtocolCodec.convert(envelope.payload, to: Payload.self)
      else { return }
      queuedByAgent[payload.agent_id] = payload.messages

    case .agentCapabilities:
      guard let agentId = envelope.agentId,
        let caps = try? ProtocolCodec.convert(
          envelope.payload, to: RemoteAgentCapabilities.self)
      else { return }
      capabilitiesByAgent[agentId] = caps

    case .agentEvent:
      // Never rendered raw — it only tells us the snapshot is stale.
      guard let agentId = envelope.agentId else { return }
      scheduleTranscriptRefresh(agentId)

    case .deviceState:
      guard let state = try? ProtocolCodec.convert(
        envelope.payload, to: RemoteDeviceState.self) else { return }
      deviceStates[state.deviceId] = state

    case .deviceClaim:
      guard let claim = try? ProtocolCodec.convert(
        envelope.payload, to: RemoteDeviceClaimState.self) else { return }
      deviceClaims[claim.deviceId] = claim

    case .sessionsChanged:
      // Lists are held by the client, so a change on the computer is only
      // visible if it says so. A null repo means "something went; refetch
      // whatever you hold".
      struct Payload: Decodable { let repo_root: String? }
      let repoRoot = (try? ProtocolCodec.convert(
        envelope.payload, to: Payload.self))?.repo_root
      Task { await reloadSessions(for: repoRoot) }

    case .projectsChanged:
      Task { await refreshProjects() }

    case .claudeAccountsChanged:
      struct Payload: Decodable {
        let accounts: [RemoteClaudeAccount]
        let active_id: String
      }
      guard let payload = try? ProtocolCodec.convert(envelope.payload, to: Payload.self)
      else { return }
      claudeAccounts = payload.accounts
      activeClaudeAccountId = payload.active_id

    case .claudeAccountsLogin:
      guard let state = try? ProtocolCodec.convert(
        envelope.payload, to: RemoteClaudeLoginState.self) else { return }
      claudeLogin = state

    case .notification:
      guard let notification = try? ProtocolCodec.convert(
        envelope.payload, to: RemoteNotification.self) else { return }
      NotificationPresenter.present(notification)

    case .ipc:
      // Raw broadcasts only reach admin devices, which a phone never is.
      break
    }
  }

  private func apply(_ status: RemoteAgentStatus) {
    statusByAgent[status.agentId] = status
    for (repo, agents) in agentsByRepo {
      if let index = agents.firstIndex(where: { $0.agentId == status.agentId }) {
        agentsByRepo[repo]?[index] = status
      }
    }
    if let index = recentAgents.firstIndex(where: { $0.agentId == status.agentId }) {
      recentAgents[index] = status
    } else {
      recentAgents.insert(status, at: 0)
    }
    if let hostId = activeHostId {
      agentHosts.remember(agentIds: [status.agentId], hostId: hostId)
    }
  }

  func promptKey(_ agentId: String, _ toolUseId: String) -> String {
    "\(agentId):\(toolUseId)"
  }

  func imageKey(_ agentId: String, _ imageId: String) -> String {
    "\(agentId):\(imageId)"
  }

  /// A burst of events becomes one refetch — the snapshot is the truth, the
  /// events only say it moved.
  private func scheduleTranscriptRefresh(_ agentId: String) {
    refetchTimers[agentId]?.cancel()
    refetchTimers[agentId] = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled else { return }
      await self?.loadTranscript(agentId: agentId)
    }
  }

  // MARK: Media routing

  func registerMediaSink(
    streamId: UInt16, _ sink: @escaping @MainActor (MediaMessage) -> Void
  ) -> () -> Void {
    mediaSinks[streamId] = sink
    for buffered in mediaBuffer.removeValue(forKey: streamId) ?? [] {
      sink(buffered)
    }
    return { [weak self] in
      Task { @MainActor in self?.mediaSinks.removeValue(forKey: streamId) }
    }
  }

  private func deliver(_ message: MediaMessage) {
    if let sink = mediaSinks[message.streamId] {
      sink(message)
      return
    }
    var buffered = mediaBuffer[message.streamId] ?? []
    buffered.append(message)
    if buffered.count > Self.mediaBufferCap { buffered.removeFirst() }
    mediaBuffer[message.streamId] = buffered
  }

  // MARK: Lookups

  /// The repo a session belongs to. Falls back to the agent's project name
  /// when its repo's sessions haven't been loaded yet (deep link into an
  /// agent), and gives up rather than guessing.
  func repoRoot(forSessionId id: String) -> String? {
    for (repoRoot, sessions) in sessionsByRepo where sessions.contains(where: { $0.id == id }) {
      return repoRoot
    }
    guard
      let projectName = statusByAgent.values.first(where: { $0.sessionId == id })?.projectName
    else { return nil }

    return projects.first { $0.name == projectName }?.repoRoot
  }

  // MARK: Error surface

  func report(_ error: Error, scope: String = "app") {
    lastError = AppStore.describe(error)
    Telemetry.capture(.appError(scope: scope, message: AppStore.describe(error)))
    Telemetry.captureException(error, source: "app_error", extra: ["scope": scope])
  }

  /// A description worth putting in front of someone.
  ///
  /// `localizedDescription` on a `DecodingError` is "The data couldn't be read
  /// because it isn't in the correct format", which says nothing about which
  /// field drifted — and a mismatch against the desktop's schema is exactly
  /// the failure this client is most prone to.
  static func describe(_ error: Error) -> String {
    switch error {
    case let transport as Transport.TransportError:
      switch transport {
      case .gateway(let payload): return payload.message
      case .timedOut: return "The computer didn't answer in time."
      case .notReady: return "Not connected to a computer."
      case .badIdentity: return "This pairing's keys are unreadable."
      }
    case let decoding as DecodingError:
      switch decoding {
      case .keyNotFound(let key, _):
        return "Unexpected reply: missing “\(key.stringValue)”."
      case .typeMismatch(_, let context), .valueNotFound(_, let context):
        let path = context.codingPath.map(\.stringValue).joined(separator: ".")
        return "Unexpected reply at “\(path.isEmpty ? "root" : path)”."
      case .dataCorrupted(let context):
        return "Unreadable reply: \(context.debugDescription)"
      @unknown default:
        return "Unexpected reply from the computer."
      }
    default:
      return error.localizedDescription
    }
  }

  func clearError() { lastError = nil }

  func setTelemetryMode(_ mode: TelemetryMode) {
    telemetryMode = mode
    Telemetry.setMode(mode)
  }

  func setThemePreference(_ preference: ThemePreference) {
    themePreference = preference
    preferences.set(preference.rawValue, for: PreferenceKey.theme)
  }

  func setAutoExpandImageReads(_ enabled: Bool) {
    autoExpandImageReads = enabled
    preferences.set(enabled ? "on" : "off", for: PreferenceKey.autoExpandImageReads)
    Telemetry.capture(.settingChanged(setting: .autoExpandImageReads, enabled: enabled))
  }
}
