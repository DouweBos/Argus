import ArgusKit
import Foundation
import Observation

/// One computer's data and every action on it, over whichever `HostBackend`
/// reaches it. Views read slices and call actions; the backend pushes events
/// back in through `handle(_:)`.
///
/// The store outlives its backend: an app attaches a fresh one on every
/// connect and `reset()`s when it moves to a different computer, so nothing
/// from the previous one bleeds into the next.
@MainActor
@Observable
public final class HostStore {
  // MARK: Connection
  //
  // Setters are module-internal rather than `private(set)`: the store is split
  // across several files to stay readable, and Swift scopes `private(set)` to
  // one file. Views read them; only the store's own extensions write them.

  public internal(set) var connection: Transport.State = .offline

  /// This device's grants. The app seeds them from what it knows about the
  /// host and refreshes them on connect.
  public var capabilities: [String] = []
  public var hasControl: Bool { capabilities.contains("control") }

  // MARK: Per-host data

  public internal(set) var projects: [RemoteProject] = []
  /// Whether `projects`, `recentAgents` and `devices` have been fetched from
  /// this computer yet — until then an empty list means "not known", not "none".
  public internal(set) var projectsLoaded = false
  public internal(set) var recentAgentsLoaded = false
  public internal(set) var devicesLoaded = false
  public internal(set) var sessionsByRepo: [String: [RemoteSession]] = [:]
  public internal(set) var agentsByRepo: [String: [RemoteAgentStatus]] = [:]
  /// Every agent across every project, for the home "Recent agents" section.
  public internal(set) var recentAgents: [RemoteAgentStatus] = []
  /// Sessions that belong to no project, each in its own directory.
  public internal(set) var scratchPads: [RemoteSession] = []
  /// Sessions outside every project, fetched by id — an automation run's host
  /// session lives in the run's own folder, so no project lists it.
  public internal(set) var adoptedSessions: [String: RemoteSession] = [:]
  /// LLM runners this computer has registered, for the spawn sheet's picker.
  public internal(set) var runners: [RemoteRunner] = []
  public internal(set) var stoppedByRepo: [String: [RemoteStoppedAgent]] = [:]
  public internal(set) var messagesByAgent: [String: [RemoteMessage]] = [:]
  /// Locally-appended user messages awaiting confirmation in the next snapshot.
  public internal(set) var optimisticByAgent: [String: [RemoteMessage]] = [:]
  /// Messages that never reached the computer, kept with their payload so a
  /// retry re-sends them instead of making you retype.
  public internal(set) var failedByAgent: [String: [FailedSend]] = [:]
  /// The computer's queue per agent — messages waiting on a busy agent.
  public internal(set) var queuedByAgent: [String: [RemoteQueuedMessage]] = [:]
  /// Queue adds still in flight. Separate from `queuedByAgent` because a queue
  /// event can replace that list before the computer has our add.
  public internal(set) var sendingQueuedByAgent: [String: [RemoteQueuedMessage]] = [:]
  public internal(set) var tasksByAgent: [String: [RemoteTask]] = [:]
  public internal(set) var todosByAgent: [String: [RemoteTodo]] = [:]
  /// Replies suggested once each agent's last turn ended; absent when none.
  public internal(set) var followUpsByAgent: [String: [String]] = [:]
  /// Name of the tool currently executing per agent — drives the activity row.
  public internal(set) var pendingToolByAgent: [String: String] = [:]
  /// Cursor for the next older page per agent; nil means the start is reached.
  public internal(set) var prevBeforeByAgent: [String: Double] = [:]
  public internal(set) var gitStatusBySession: [String: RemoteGitStatus] = [:]
  public internal(set) var prompts: [String: RemotePermissionRequest] = [:]
  /// Prompts this client just answered — clears the inline form instantly,
  /// before the round trip lands.
  public internal(set) var answered: Set<String> = []
  /// Resolved image bytes keyed by `agentId:imageId`, as data URIs.
  public internal(set) var imageCache: [String: String] = [:]
  public internal(set) var capabilitiesByAgent: [String: RemoteAgentCapabilities] = [:]
  public internal(set) var statusByAgent: [String: RemoteAgentStatus] = [:]
  /// Agents the computer no longer has — e.g. a finished automation run's,
  /// which is shut down when the run settles. Their transcript can outlive them.
  public internal(set) var goneAgents: Set<String> = []
  /// Locally-chosen effort per agent; the monitor snapshot doesn't carry it.
  public internal(set) var effortByAgent: [String: String] = [:]
  public internal(set) var devices: [RemoteDevice] = []
  /// Claude accounts signed in on the computer, and which one new agents run
  /// as. `nil` until the first load — an empty list would look like "signed
  /// out everywhere" rather than "not fetched yet".
  public internal(set) var claudeAccounts: [RemoteClaudeAccount]?
  public internal(set) var activeClaudeAccountId: String?
  /// Plan limits per Claude account; `nil` until the first load.
  public internal(set) var usageLimits: ArgusProtocol.ClaudeUsageLimits?
  /// Why the last usage load failed, cleared by the next success.
  public internal(set) var usageLimitsError: String?
  public internal(set) var usageLimitsLoading = false
  /// The computer's in-flight Claude sign-in, if any.
  public internal(set) var claudeLogin: RemoteClaudeLoginState?
  /// Fold and orientation for watched devices, keyed by device id.
  public internal(set) var deviceStates: [String: RemoteDeviceState] = [:]
  /// Who is driving each watched device, and this connection's own id so the
  /// app can tell "someone else" from "me".
  public internal(set) var deviceClaims: [String: RemoteDeviceClaimState] = [:]
  public internal(set) var connectionId: String?
  /// Touches, keys and buttons, sent in the order they happened.
  @ObservationIgnored let deviceInput = DeviceInputQueue()

  /// The most recent error worth showing, if any.
  public internal(set) var lastError: String?

  // MARK: Collaborators

  public private(set) var backend: (any HostBackend)?
  @ObservationIgnored public var hooks: HostStoreHooks

  @ObservationIgnored private var pump: Task<Void, Never>?
  /// Sessions created here that the host doesn't list yet (still setting up).
  @ObservationIgnored var creatingSessions: [String: RemoteSession] = [:]
  /// Debounces transcript refetches: a burst of agent events becomes one call.
  @ObservationIgnored private var refetchTimers: [String: Task<Void, Never>] = [:]
  /// Where each held transcript sits among the host's deltas; see `HostStore+TranscriptSync`.
  @ObservationIgnored var transcriptSync: [String: TranscriptSync] = [:]
  /// The epoch each held transcript was last paged in; survives a reconnect so
  /// a restarted host's re-seeded conversation replaces it rather than merging.
  @ObservationIgnored var heldEpochs: [String: String] = [:]
  /// Tail fetches in flight per agent; deltas wait in `bufferedDeltas` until they land.
  @ObservationIgnored var tailFetches: [String: Int] = [:]
  @ObservationIgnored var bufferedDeltas: [String: [TranscriptDelta]] = [:]
  /// Agents a delta has arrived for since the last connect: their events need no refetch.
  @ObservationIgnored var deltaAgents: Set<String> = []
  /// Agents a view is showing, so a delta that can't be lined up is worth a refetch.
  @ObservationIgnored var watchedAgents: Set<String> = []

  /// Frames arrive far too fast for observable state, and a view registers its
  /// sink only after `devices.watch` returns — so the config message that
  /// arrives first is buffered until someone is listening.
  @ObservationIgnored private var mediaSinks: [UInt16: @MainActor (MediaMessage) -> Void] = [:]
  @ObservationIgnored private var mediaBuffer: [UInt16: [MediaMessage]] = [:]
  private static let mediaBufferCap = 120
  /// Views listening to raw `ipc` channels; see `observeIpc`.
  @ObservationIgnored var ipcObservers: [UUID: @MainActor (String, [JSONValue], Int) -> Void] = [:]
  /// Streaming terminal readers, by terminal id; see `followTerminal`.
  @ObservationIgnored var terminalObservers: [String: @MainActor (TerminalFeed.Live, Int) -> Void] = [:]
  /// Where each agent's applied queue sits among the host's events; see `applyQueue`.
  @ObservationIgnored var queueSeq: [String: Int] = [:]
  /// Running worktree searches, by search id; see `startFileSearch`.
  @ObservationIgnored var fileSearchObservers: [String: @MainActor (ArgusProtocol.CodeSearchEvent) -> Void] = [:]

  public static let transcriptPage = 80

  public init(hooks: HostStoreHooks = HostStoreHooks()) {
    self.hooks = hooks
  }

  // MARK: Lifecycle

  /// The app is reaching for a backend; shows as connecting until `attach`.
  public func beginConnecting() {
    connection = .connecting
  }

  /// Adopt a live backend and start listening to it.
  public func attach(_ backend: any HostBackend) async {
    pump?.cancel()
    self.backend = backend
    connection = .ready
    // A new connection numbers its events from scratch.
    queueSeq = [:]
    let stream = await backend.events()
    pump = Task { [weak self] in
      for await event in stream {
        await self?.handle(event)
      }
    }
    followAgents()
  }

  /// Drop the backend. Data stays until `reset()`, so a reconnect to the same
  /// computer doesn't blank the screen.
  public func detach() async {
    pump?.cancel()
    pump = nil
    for (_, timer) in refetchTimers { timer.cancel() }
    refetchTimers.removeAll()
    forgetTranscriptSync()
    await backend?.disconnect()
    backend = nil
    connection = .offline
  }

  /// A connect that never produced a backend.
  public func connectFailed(_ message: String) {
    connection = .offline
    lastError = message
  }

  /// Forget everything fetched from the current computer.
  public func reset() {
    creatingSessions = [:]
    projects = []
    projectsLoaded = false
    recentAgentsLoaded = false
    devicesLoaded = false
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
    queueSeq = [:]
    tasksByAgent = [:]
    todosByAgent = [:]
    followUpsByAgent = [:]
    pendingToolByAgent = [:]
    prevBeforeByAgent = [:]
    gitStatusBySession = [:]
    prompts = [:]
    answered = []
    imageCache = [:]
    capabilitiesByAgent = [:]
    statusByAgent = [:]
    goneAgents = []
    effortByAgent = [:]
    devices = []
    claudeAccounts = nil
    activeClaudeAccountId = nil
    usageLimits = nil
    usageLimitsError = nil
    usageLimitsLoading = false
    claudeLogin = nil
    deviceStates = [:]
    deviceClaims = [:]
    connectionId = nil
    lastError = nil
    mediaSinks = [:]
    mediaBuffer = [:]
    forgetTranscriptSync()
    heldEpochs = [:]
    watchedAgents = []
  }

  // MARK: Events

  func handle(_ event: HostEvent) async {
    switch event {
    case .state(let state):
      let reconnected = state == .ready && connection != .ready
      connection = state
      // Subscriptions belong to a connection; a fresh one starts with none.
      if reconnected {
        resyncTranscripts()
        resyncQueues()
        followAgents()
      }
    case .media(let bytes):
      guard let message = MediaMessage.parse(bytes) else { return }
      deliver(message)
    case .event(let envelope):
      handle(envelope)
    }
  }

  func handle(_ envelope: EventEnvelope) {
    guard let name = RemoteEventName(rawValue: envelope.event) else { return }
    if name == .ipc { notifyIpcObservers(envelope) }
    switch name {
    case .hostEndpoints:
      struct Payload: Decodable { let endpoints: [RemoteEndpoint] }
      guard let payload = try? ProtocolCodec.convert(envelope.payload, to: Payload.self)
      else { return }
      hooks.endpointsChanged(payload.endpoints)

    case .permissionRequest:
      guard let request = try? ProtocolCodec.convert(
        envelope.payload, to: RemotePermissionRequest.self) else { return }
      prompts[promptKey(request.agentId, request.toolUseId)] = request
      refreshUnlessFollowing(request.agentId)

    case .permissionCancel:
      guard let cancel = try? ProtocolCodec.convert(
        envelope.payload, to: RemotePermissionCancel.self) else { return }
      prompts.removeValue(forKey: promptKey(cancel.agentId, cancel.toolUseId))
      refreshUnlessFollowing(cancel.agentId)

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
      applyQueue(payload.messages, agentId: payload.agent_id, seq: envelope.seq)

    case .agentCapabilities:
      guard let agentId = envelope.agentId,
        let caps = try? ProtocolCodec.convert(
          envelope.payload, to: RemoteAgentCapabilities.self)
      else { return }
      capabilitiesByAgent[agentId] = caps

    case .agentEvent:
      // Never rendered raw — it only tells us the snapshot is stale.
      guard let agentId = envelope.agentId else { return }
      refreshUnlessFollowing(agentId)

    case .agentTranscript:
      guard let delta = try? ProtocolCodec.convert(envelope.payload, to: TranscriptDelta.self)
      else { return }
      receive(delta)

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
      hooks.notify(notification)

    case .terminalData:
      struct Payload: Decodable { let terminal_id: String; let data: String }
      guard let payload = try? ProtocolCodec.convert(envelope.payload, to: Payload.self),
        let data = Data(base64Encoded: payload.data)
      else { return }
      terminalObservers[payload.terminal_id]?(.data(data), envelope.seq)

    case .terminalExit:
      struct Payload: Decodable { let terminal_id: String; let exit_code: Int }
      guard let payload = try? ProtocolCodec.convert(envelope.payload, to: Payload.self)
      else { return }
      terminalObservers[payload.terminal_id]?(.exit(payload.exit_code), envelope.seq)

    case .filesSearch:
      guard let event = try? ProtocolCodec.convert(
        envelope.payload, to: ArgusProtocol.CodeSearchEvent.self) else { return }
      let searchId: String
      switch event {
      case .matches(let batch): searchId = batch.searchId
      case .done(let done): searchId = done.searchId
      case .unknown: return
      }
      fileSearchObservers[searchId]?(event)

    case .ipc:
      // Raw broadcasts reach admin devices only.
      handleRawBroadcast(envelope.payload)
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
    hooks.agentsSeen([status.agentId])
  }

  public func promptKey(_ agentId: String, _ toolUseId: String) -> String {
    "\(agentId):\(toolUseId)"
  }

  public func imageKey(_ agentId: String, _ imageId: String) -> String {
    "\(agentId):\(imageId)"
  }

  /// A burst of events becomes one refetch — the snapshot is the truth, the
  /// events only say it moved.
  func scheduleTranscriptRefresh(_ agentId: String) {
    refetchTimers[agentId]?.cancel()
    refetchTimers[agentId] = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled else { return }
      await self?.loadTranscript(agentId: agentId)
    }
  }

  // MARK: Media routing

  public func registerMediaSink(
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
  public func repoRoot(forSessionId id: String) -> String? {
    for (repoRoot, sessions) in sessionsByRepo where sessions.contains(where: { $0.id == id }) {
      return repoRoot
    }
    guard
      let projectName = statusByAgent.values.first(where: { $0.sessionId == id })?.projectName
    else { return nil }

    return projects.first { $0.name == projectName }?.repoRoot
  }

  // MARK: Error surface

  public func report(_ error: Error, scope: String = "app") {
    lastError = Self.describe(error)
    hooks.errorReported(error, scope)
  }

  /// Put a message in front of the user without an underlying error.
  public func showError(_ message: String) {
    lastError = message
  }

  public func clearError() { lastError = nil }

  /// A description worth putting in front of someone.
  ///
  /// `localizedDescription` on a `DecodingError` is "The data couldn't be read
  /// because it isn't in the correct format", which says nothing about which
  /// field drifted — and a mismatch against the desktop's schema is exactly
  /// the failure this client is most prone to.
  public nonisolated static func describe(_ error: Error) -> String {
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
}
