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
  }

  public func loadRecentAgents() async {
    guard let backend else { return }
    struct Result: Decodable { let agents: [RemoteAgentStatus] }
    guard let result = try? await backend.request(
      .agentsList, EmptyParams(), as: Result.self) else { return }
    recentAgents = result.agents
    for agent in result.agents { statusByAgent[agent.agentId] = agent }
    hooks.agentsSeen(result.agents.map(\.agentId))
  }

  /// Older computers don't know the method, which leaves the list empty.
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
    sessionsByRepo[repoRoot] = creating + result.sessions
  }

  public func loadAgents(repoRoot: String) async {
    guard let backend else { return }
    struct Params: Encodable { let repo_root: String }
    struct Result: Decodable { let agents: [RemoteAgentStatus] }
    guard let result = try? await backend.request(
      .agentsList, Params(repo_root: repoRoot), as: Result.self) else { return }
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
    // A live agent's transcript is already here, whole.
    if liveTranscript(key) { return }

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

    // Any failure becomes an empty transcript: an agent that hasn't started
    // yet should show an empty state, not a spinner that never resolves.
    let transcript: RemoteTranscript
    if let stopped = Self.parseStoppedKey(key) {
      transcript =
        (try? await backend.request(
          .agentsStoppedTranscript,
          StoppedParams(
            repo_root: stopped.repoRoot, history_id: stopped.historyId,
            limit: Self.transcriptPage, before: before),
          as: RemoteTranscript.self)) ?? Self.emptyTranscript
    } else {
      transcript =
        (try? await backend.request(
          .agentsTranscript,
          LiveParams(agent_id: key, limit: Self.transcriptPage, before: before),
          as: RemoteTranscript.self)) ?? Self.emptyTranscript
    }

    merge(transcript, into: key, isOlderPage: before != nil)
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
    if liveImage(key, imageId: imageId) { return }

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
    // A stopped agent has no live process to subscribe to, and a live-owned
    // one stays subscribed whether or not a view is showing it.
    guard Self.parseStoppedKey(key) == nil, !ownsConversations, let backend else { return }
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

  public func loadDiff(sessionId: String, mode: String) async -> String {
    guard let backend else { return "" }
    struct Params: Encodable {
      let session_id: String
      let mode: String
    }
    struct Result: Decodable {
      let diff: String
      let base_branch: String?
    }
    let result = try? await backend.request(
      .sessionsDiff, Params(session_id: sessionId, mode: mode), as: Result.self)
    return result?.diff ?? ""
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
