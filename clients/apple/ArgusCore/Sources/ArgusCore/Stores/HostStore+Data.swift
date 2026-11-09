import ArgusKit
import Foundation

/// Monitor-scoped loading: lists, transcripts, images, git state.
///
/// Sessions and projects arrive as events (`sessions.changed`,
/// `projects.changed`) with a slow poll behind them; devices and automations
/// are polled outright. Transcripts are event-driven with a poll as a backstop.
extension HostStore {

  // MARK: Lists

  public func refreshProjects() async {
    guard let backend else { return }
    struct Result: Decodable { let projects: [RemoteProject] }
    guard let result = try? await backend.request(
      .projectsList, EmptyParams(), as: Result.self) else { return }
    projects = result.projects
    projectsLoaded = true
  }

  public func loadRecentAgents() async {
    guard let backend else { return }
    struct Result: Decodable { let agents: [RemoteAgentStatus] }
    guard let result = try? await backend.request(
      .agentsList, EmptyParams(), as: Result.self) else { return }
    recentAgents = result.agents
    recentAgentsLoaded = true
    for agent in result.agents { statusByAgent[agent.agentId] = agent }
    hooks.agentsSeen(result.agents.map(\.agentId))
  }

  /// Older computers don't know the method, which leaves the list empty.
  /// A session no project lists, by id, so a screen can open it.
  public func adoptSession(id: String) async {
    guard let backend,
      let session = try? await backend.request(ArgusProtocol.Commands.GetSession.self, .init(id: id)),
      let data = try? JSONEncoder().encode(session),
      let remote = try? JSONDecoder().decode(RemoteSession.self, from: data)
    else { return }
    adoptedSessions[id] = remote
  }

  public func loadScratchPads() async {
    guard let backend else { return }
    struct Result: Decodable { let sessions: [RemoteSession] }
    guard let result = try? await backend.request(
      .scratchPadsList, EmptyParams(), as: Result.self) else { return }
    scratchPads = result.sessions
  }

  /// Runners an agent can be started on. Host-wide, so it is loaded once and
  /// shared by every spawn sheet. Older computers don't answer, which leaves
  /// the list empty and the picker hidden.
  public func loadRunners() async {
    guard let backend, runners.isEmpty else { return }
    struct Result: Decodable { let runners: [RemoteRunner] }
    guard let result = try? await backend.request(
      .automationsRunners, EmptyParams(), as: Result.self) else { return }
    runners = result.runners
  }

  /// What a runner's CLI last reported, as the host kept it: a start's models
  /// and effort before any agent has run. Nil is the default runner.
  public func lastKnownModels(runnerId: String?) -> [RemoteModelInfo] {
    let id = runnerId ?? "claude-code"
    return runners.first { $0.id == id }?.reportedModels ?? []
  }

  /// Whether an agent's runner can rewind and fork its chat. Unknown runners
  /// and older hosts, which don't say, count as able.
  public func supportsTranscriptFork(agentId: String) -> Bool {
    runner(ofAgent: agentId)?.supportsTranscriptFork ?? true
  }

  /// Whether an agent's runner takes side questions; unknown counts as able.
  public func supportsSideQuestion(agentId: String) -> Bool {
    runner(ofAgent: agentId)?.supportsSideQuestion ?? true
  }

  private func runner(ofAgent agentId: String) -> RemoteRunner? {
    let id = statusByAgent[agentId]?.runnerId ?? "claude-code"
    return runners.first { $0.id == id }
  }

  /// Backstop for a change nothing announced (a dropped event, an older
  /// computer): refetch the projects and every session list already held.
  public func refreshHeldLists() async {
    await refreshProjects()
    await reloadSessions(for: nil)
  }

  /// Answer a `sessions.changed` event. A named repo reloads just that one;
  /// a nil repo means the computer couldn't say which, so everything the app
  /// is already holding gets refetched.
  public func reloadSessions(for repoRoot: String?) async {
    guard let repoRoot else {
      for known in sessionsByRepo.keys {
        await loadSessions(repoRoot: known)
      }

      return
    }
    // A repo this app has never listed has nothing to refresh.
    guard sessionsByRepo[repoRoot] != nil else { return }
    await loadSessions(repoRoot: repoRoot)
  }

  public func loadSessions(repoRoot: String) async {
    guard let backend else { return }
    struct Params: Encodable { let repo_root: String }
    struct Result: Decodable { let sessions: [RemoteSession] }
    guard let result = try? await backend.request(
      .sessionsList, Params(repo_root: repoRoot), as: Result.self) else { return }
    // The host leaves a session out while its worktree is still being made;
    // one this app just created stays in view, set up, until it is listed.
    let listed = Set(result.sessions.map(\.id))
    for id in creatingSessions.keys where listed.contains(id) { creatingSessions[id] = nil }
    let creating = creatingSessions.values.filter { $0.repoRoot == repoRoot }
    let previous = sessionsByRepo[repoRoot] ?? []
    sessionsByRepo[repoRoot] = creating + result.sessions
    await refreshGitStatusOnBranchChange(from: previous, to: result.sessions)
  }

  /// A checkout switched outside Argus: the cached status (branch name,
  /// ahead/behind) describes the old branch until it is re-read.
  private func refreshGitStatusOnBranchChange(
    from previous: [RemoteSession], to current: [RemoteSession]
  ) async {
    let before = Dictionary(previous.map { ($0.id, $0.branch) }, uniquingKeysWith: { a, _ in a })
    for session in current
    where gitStatusBySession[session.id] != nil && before[session.id].map({ $0 != session.branch }) == true {
      await loadGitStatus(sessionId: session.id)
    }
  }

  public func loadAgents(repoRoot: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      var repo_root: String?
      var session_id: String?
    }
    struct Result: Decodable { let agents: [RemoteAgentStatus] }
    // The host refuses a repo it has no project for, which a scratch pad's or a run's folder never is.
    let params = sessionOutsideProjects(repoRoot: repoRoot).map { Params(session_id: $0.id) }
      ?? Params(repo_root: repoRoot)
    guard let result = try? await backend.request(.agentsList, params, as: Result.self) else { return }
    agentsByRepo[repoRoot] = result.agents
    for agent in result.agents { statusByAgent[agent.agentId] = agent }
  }

  public func loadStoppedAgents(repoRoot: String) async {
    guard let backend else { return }
    struct Params: Encodable { let repo_root: String }
    struct Result: Decodable { let agents: [RemoteStoppedAgent] }
    guard let result = try? await backend.request(
      .agentsStopped, Params(repo_root: repoRoot), as: Result.self) else { return }
    stoppedByRepo[repoRoot] = result.agents
  }

  public func loadAgentStatus(agentId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let agent_id: String }
    struct Result: Decodable { let agent: RemoteAgentStatus }
    do {
      let result = try await backend.request(
        .agentsStatus, Params(agent_id: agentId), as: Result.self)
      statusByAgent[agentId] = result.agent
      goneAgents.remove(agentId)
    } catch Transport.TransportError.gateway(let payload) where payload.isNotFound {
      goneAgents.insert(agentId)
    } catch {}
  }

  public func refreshDevices() async {
    guard let backend else { return }
    struct Result: Decodable { let devices: [RemoteDevice] }
    guard let result = try? await backend.request(
      .devicesList, EmptyParams(), as: Result.self) else { return }
    devices = result.devices
    devicesLoaded = true
  }

  /// Device hosts can only be added or removed on the computer itself: doing
  /// it from here would let a paired client make it open SSH with its keys.
  public func refreshDeviceHosts() async {
    guard let backend else { return }
    struct Result: Decodable { let hosts: [RemoteDeviceHost] }
    guard let result = try? await backend.request(
      .deviceHostsList, EmptyParams(), as: Result.self) else { return }
    deviceHosts = result.hosts
  }

  /// Start a billed EAS Simulator session on the host's next free slot. The
  /// computer returns at once; the device turns up in `devices` once ready.
  public func startEasSession(hostId: String) async throws -> String {
    guard let backend else { throw Self.offlineError }
    struct Params: Encodable, Sendable { let host_id: String }
    struct Result: Decodable { let device_id: String }
    let result = try await backend.request(
      .deviceHostsStartEasSession, Params(host_id: hostId), as: Result.self)
    await refreshDeviceHosts()
    return result.device_id
  }

  /// Stop an EAS Simulator session, which ends its device.
  public func stopEasSession(deviceId: String) async throws {
    guard let backend else { throw Self.offlineError }
    struct Params: Encodable, Sendable { let device_id: String }
    struct Result: Decodable { let accepted: Bool }
    _ = try await backend.request(
      .deviceHostsStopEasSession, Params(device_id: deviceId), as: Result.self)
    await refreshDeviceHosts()
    await refreshDevices()
  }

  // MARK: Transcript

  /// A stopped agent has no agent id — the process is gone and only the saved
  /// history remains. This mints a stand-in key so one transcript pipeline
  /// serves both live and finished conversations.
  public static func stoppedKey(repoRoot: String, historyId: String) -> String {
    "stopped:\(historyId)\n\(repoRoot)"
  }

  public static func parseStoppedKey(_ key: String) -> (historyId: String, repoRoot: String)? {
    guard key.hasPrefix("stopped:") else { return nil }
    let parts = key.dropFirst("stopped:".count).components(separatedBy: "\n")
    guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return nil }
    return (parts[0], parts[1])
  }

  public func loadTranscript(agentId key: String, before: Double? = nil) async {
    guard let backend else { return }

    struct LiveParams: Encodable {
      let agent_id: String
      let limit: Int
      let before: Double?
    }
    struct StoppedParams: Encodable {
      let repo_root: String
      let history_id: String
      let limit: Int
      let before: Double?
    }

    // A live agent's failure becomes an empty transcript: one that hasn't
    // started yet should show an empty state, not a spinner that never resolves.
    let transcript: RemoteTranscript
    if let stopped = Self.parseStoppedKey(key) {
      // A saved chat always has messages, so a failure is said rather than shown empty.
      do {
        transcript = try await backend.request(
          .agentsStoppedTranscript,
          StoppedParams(
            repo_root: stopped.repoRoot, history_id: stopped.historyId,
            limit: Self.transcriptPage, before: before),
          as: RemoteTranscript.self)
        transcriptErrorByAgent[key] = nil
      } catch {
        transcriptErrorByAgent[key] = Self.stoppedTranscriptFailure(error)
        return
      }
    } else {
      // A tail page re-establishes where deltas line up; those arriving
      // meanwhile wait for it.
      let isTail = before == nil
      if isTail { tailFetchStarted(key) }
      transcript =
        (try? await backend.request(
          .agentsTranscript,
          LiveParams(agent_id: key, limit: Self.transcriptPage, before: before),
          as: RemoteTranscript.self)) ?? Self.emptyTranscript
      if isTail {
        if !isStale(transcript, for: key) {
          replaceIfNewEpoch(transcript, for: key)
          merge(transcript, into: key, isOlderPage: false)
        }
        tailFetchLanded(key, page: transcript)
        return
      }
    }

    merge(transcript, into: key, isOlderPage: before != nil)
  }

  /// Hosts up to 0.68 only read saved chats inside a project, so a scratch
  /// pad's or a run's chat is refused as an unknown repo.
  nonisolated static func stoppedTranscriptFailure(_ error: Error) -> String {
    if case Transport.TransportError.gateway(let payload) = error, payload.isNotFound,
      payload.message.contains("repo_root")
    {
      return "Reading chats saved outside a project needs a newer version of Argus on the host."
    }
    return describe(error)
  }

  private static let emptyTranscript = RemoteTranscript(
    messages: [], nextAfter: nil, prevBefore: nil, total: nil,
    tasks: nil, todos: nil, model: nil, pendingToolName: nil)

  /// Merge a page into the cache, preserving object identity wherever the
  /// content is unchanged so SwiftUI doesn't rebuild rows and lose the scroll
  /// position on every 5-second poll.
  private func merge(_ transcript: RemoteTranscript, into key: String, isOlderPage: Bool) {
    let existing = messagesByAgent[key] ?? []
    var merged: [RemoteMessage]

    if isOlderPage {
      // Older page: prepend anything we don't already hold.
      let known = Set(existing.map(\.id))
      merged = transcript.messages.filter { !known.contains($0.id) } + existing
    } else {
      // Tail page: keep older pages already loaded, replace the tail.
      let incoming = Set(transcript.messages.map(\.id))
      let firstIncoming = transcript.messages.first?.id
      let kept = existing.prefix { message in
        message.id != firstIncoming && !incoming.contains(message.id)
      }
      merged = Array(kept) + transcript.messages
    }

    // Reuse the previous element when nothing changed.
    let previousById = Dictionary(existing.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    merged = merged.map { message in
      if let previous = previousById[message.id], previous == message { return previous }
      return message
    }

    if merged != existing {
      messagesByAgent[key] = merged
    }

    reconcileOptimistic(for: key, against: merged)

    if let tasks = transcript.tasks, tasksByAgent[key] != tasks { tasksByAgent[key] = tasks }
    if let todos = transcript.todos, todosByAgent[key] != todos { todosByAgent[key] = todos }
    if !isOlderPage { setFollowUps(transcript.followUps, for: key) }
    pendingToolByAgent[key] = transcript.pendingToolName

    // Only the first load establishes where "older" starts; scrolling up walks
    // the cursor backwards from there.
    if !isOlderPage, prevBeforeByAgent[key] == nil {
      prevBeforeByAgent[key] = transcript.prevBefore
    } else if isOlderPage {
      prevBeforeByAgent[key] = transcript.prevBefore
    }
  }

  /// Drop an optimistic bubble once the server echoes it back. The server's
  /// copy may carry the linked-projects preamble the user never typed, so the
  /// match is "contains", not equality.
  func reconcileOptimistic(for key: String, against messages: [RemoteMessage]) {
    guard let pending = optimisticByAgent[key], !pending.isEmpty else { return }
    let serverUserText = messages
      .filter { $0.role == .user }
      .map { $0.textBlocks.joined(separator: "\n") }

    let remaining = pending.filter { optimistic in
      let typed = optimistic.textBlocks.joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if typed.isEmpty { return false }
      return !serverUserText.contains { $0.contains(typed) }
    }
    if remaining.count != pending.count {
      optimisticByAgent[key] = remaining.isEmpty ? nil : remaining
    }
  }

  public func loadOlderMessages(agentId key: String) async {
    guard let cursor = prevBeforeByAgent[key] else { return }
    await loadTranscript(agentId: key, before: cursor)
  }

  /// Messages to render: the server's, then anything still in flight.
  public func visibleMessages(for key: String) -> [RemoteMessage] {
    (messagesByAgent[key] ?? []) + (optimisticByAgent[key] ?? [])
  }

  public func hasOlderMessages(for key: String) -> Bool {
    prevBeforeByAgent[key] != nil
  }

  // MARK: Images

  /// Locally-seeded attachments — an optimistic send's images, or a queued
  /// message's — carry their bytes with them and have no server-side id.
  /// Asking the computer for one is a request that can only fail.
  public static func isLocallySeeded(imageId: String) -> Bool {
    imageId.contains(":img:")
  }

  public func loadImage(agentId key: String, imageId: String) async {
    guard !Self.isLocallySeeded(imageId: imageId) else { return }
    let cacheKey = imageKey(key, imageId)
    guard imageCache[cacheKey] == nil, let backend else { return }

    struct LiveParams: Encodable {
      let agent_id: String
      let image_id: String
    }
    struct StoppedParams: Encodable {
      let repo_root: String
      let history_id: String
      let image_id: String
    }

    let image: RemoteImageData?
    if let stopped = Self.parseStoppedKey(key) {
      image = try? await backend.request(
        .agentsStoppedImage,
        StoppedParams(
          repo_root: stopped.repoRoot, history_id: stopped.historyId, image_id: imageId),
        as: RemoteImageData.self)
    } else {
      image = try? await backend.request(
        .agentsImage, LiveParams(agent_id: key, image_id: imageId), as: RemoteImageData.self)
    }
    guard let image else { return }
    imageCache[cacheKey] = image.dataURI
  }

  public func cachedImage(agentId key: String, imageId: String) -> String? {
    imageCache[imageKey(key, imageId)]
  }

  /// Seed the cache directly — used for locally attached images so an
  /// optimistic bubble shows its attachments before any round trip.
  public func seedImage(agentId key: String, imageId: String, dataURI: String) {
    imageCache[imageKey(key, imageId)] = dataURI
  }

  // MARK: Subscriptions

  public func watchAgent(_ key: String, on: Bool) async {
    // A stopped agent has no live process to subscribe to, and a local
    // backend follows every agent whether or not a view is showing it.
    guard Self.parseStoppedKey(key) == nil else { return }
    if on { watchedAgents.insert(key) } else { watchedAgents.remove(key) }
    guard let backend, on || !followsAllAgents else { return }
    await backend.subscribe(agentId: key, on: on)
  }

  // MARK: Git

  public func loadGitStatus(sessionId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let status: RemoteGitStatus }
    guard let result = try? await backend.request(
      .sessionsGitStatus, Params(session_id: sessionId), as: Result.self)
    else { return }
    gitStatusBySession[sessionId] = result.status
  }

  /// Re-reads a status something already shows, once per burst: a push or
  /// fetch rewrites refs in several steps, each a `git_status_changed`.
  public func refreshGitStatus(sessionId: String) async {
    guard gitStatusBySession[sessionId] != nil else { return }
    guard gitStatusLoading.insert(sessionId).inserted else {
      gitStatusStale.insert(sessionId)
      return
    }
    defer { gitStatusLoading.remove(sessionId) }
    repeat {
      gitStatusStale.remove(sessionId)
      await loadGitStatus(sessionId: sessionId)
    } while gitStatusStale.contains(sessionId)
  }

  /// A fetch or push moves remote-tracking refs every checkout of the repo compares to.
  public func refreshGitStatuses(repoRoot: String) async {
    for session in sessionsByRepo[repoRoot] ?? [] { await refreshGitStatus(sessionId: session.id) }
  }

  /// Throws rather than answering "", which would read as "no changes".
  public func loadDiff(sessionId: String, mode: String) async throws -> String {
    guard let backend else { return "" }
    struct Params: Encodable {
      let session_id: String
      let mode: String
    }
    struct Result: Decodable {
      let diff: String
      let base_branch: String?
    }
    return try await backend.request(
      .sessionsDiff, Params(session_id: sessionId, mode: mode), as: Result.self
    ).diff
  }

  public func listBranches(sessionId: String) async -> [RemoteGitBranch] {
    guard let backend else { return [] }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let branches: [RemoteGitBranch] }
    let result = try? await backend.request(
      .sessionsBranches, Params(session_id: sessionId), as: Result.self)
    return result?.branches ?? []
  }
}

extension HostStore {
  /// Whether a tool call is still waiting on a decision.
  ///
  /// The live `permission.request` event is trusted over the snapshot, which
  /// can lag a poll behind; a local answer wins over both, so the form clears
  /// the instant it is tapped.
  public func isToolCallPending(agentKey: String, call: RemoteToolCall) -> Bool {
    if answered.contains(promptKey(agentKey, call.id)) { return false }
    // A stopped agent's last call can't be answered any more.
    if let state = statusByAgent[agentKey]?.status, state == .stopped || state == .error { return false }
    if prompts[promptKey(agentKey, call.id)] != nil { return true }
    return call.status == .pending || call.pendingPermission == true
  }

  /// The call or anything a sub-agent ran under it is waiting on a decision.
  public func hasPendingCall(agentKey: String, in call: RemoteToolCall) -> Bool {
    if isToolCallPending(agentKey: agentKey, call: call) { return true }
    return (call.children ?? []).contains { child in
      guard case .toolUse(let nested) = child else { return false }
      return hasPendingCall(agentKey: agentKey, in: nested)
    }
  }

  /// The prompt backing a pending call, when the gateway has forwarded one.
  public func prompt(agentKey: String, toolUseId: String) -> RemotePermissionRequest? {
    prompts[promptKey(agentKey, toolUseId)]
  }
}
