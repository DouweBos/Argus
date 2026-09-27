import ArgusKit
import Foundation

/// Control-scoped actions. Every one of these is refused by the gateway
/// without the `control` grant — `hasControl` only decides whether the UI
/// offers the button, it is not the enforcement.
extension AppStore {

  // MARK: Messaging

  func sendMessage(
    agentId: String, message: String, images: [RemoteImageAttachment] = [],
    displayText: String? = nil, isRetry: Bool = false
  ) async {
    let localId = appendOptimistic(agentId: agentId, text: displayText ?? message, images: images)
    // No socket at all still has to land somewhere the user can see and retry,
    // or the message is gone the moment the lock screen took the connection.
    guard let transport else {
      markFailed(agentId: agentId, localId: localId, message: message, displayText: displayText,
        images: images, isRetry: isRetry)
      return
    }

    struct Params: Encodable {
      let agent_id: String
      let message: String
      let display_text: String?
      let images: [RemoteImageAttachment]?
    }
    struct Result: Decodable { let queued: Bool? }
    do {
      let result = try await transport.request(
        .agentsSend,
        Params(
          agent_id: agentId, message: message, display_text: displayText,
          images: images.isEmpty ? nil : images),
        as: Result.self)
      Telemetry.capture(
        .messageSent(
          queued: result.queued == true, hasImages: !images.isEmpty, length: message.count))
      // The computer queues a send that arrived mid-turn. Drop the bubble and
      // let the queue show it, or it reads as already delivered.
      if result.queued == true {
        optimisticByAgent[agentId]?.removeAll { $0.id == localId }
        await loadQueue(agentId: agentId)

        return
      }
      await loadTranscript(agentId: agentId)
    } catch {
      report(error, scope: "agent:send")
      markFailed(agentId: agentId, localId: localId, message: message, displayText: displayText,
        images: images, isRetry: isRetry)
    }
  }

  /// Move a bubble from "sent" to "not sent". Without this the optimistic copy
  /// is indistinguishable from a delivered message — the computer never got it,
  /// nothing retries, and nothing ever echoes it back to reconcile against.
  private func markFailed(
    agentId: String, localId: String, message: String, displayText: String?,
    images: [RemoteImageAttachment], isRetry: Bool = false
  ) {
    Telemetry.capture(.messageSendFailed(retried: isRetry))
    optimisticByAgent[agentId]?.removeAll { $0.id == localId }
    if optimisticByAgent[agentId]?.isEmpty == true {
      optimisticByAgent[agentId] = nil
    }
    failedByAgent[agentId, default: []].append(
      FailedSend(
        id: localId, body: message, displayText: displayText, images: images))
  }

  /// Send a failed message again. It leaves the failed list first, so a second
  /// failure re-adds it rather than showing the same message twice.
  func retryFailed(agentId: String, id: String) async {
    guard let pending = failedByAgent[agentId]?.first(where: { $0.id == id }) else { return }
    discardFailed(agentId: agentId, id: id)
    await sendMessage(
      agentId: agentId, message: pending.body, images: pending.images,
      displayText: pending.displayText, isRetry: true)
  }

  func discardFailed(agentId: String, id: String) {
    failedByAgent[agentId]?.removeAll { $0.id == id }
    if failedByAgent[agentId]?.isEmpty == true {
      failedByAgent[agentId] = nil
    }
  }

  /// Show the user's message immediately, with its attachments, rather than
  /// waiting a poll cycle for the snapshot to catch up. Returns its local id.
  @discardableResult
  private func appendOptimistic(
    agentId: String, text: String, images: [RemoteImageAttachment]
  ) -> String {
    let id = "optimistic-\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 0..<10000))"
    var refs: [RemoteImageRef] = []
    for (index, image) in images.enumerated() {
      let imageId = "\(id):img:\(index)"
      seedImage(
        agentId: agentId, imageId: imageId,
        dataURI: "data:\(image.mediaType);base64,\(image.data)")
      refs.append(RemoteImageRef(imageId: imageId, mediaType: image.mediaType))
    }
    let message = RemoteMessage(
      id: id, role: .user, textBlocks: [text], toolCalls: [],
      images: refs.isEmpty ? nil : refs,
      timestamp: Date().timeIntervalSince1970 * 1000)
    optimisticByAgent[agentId, default: []].append(message)

    return id
  }

  // MARK: Queue
  //
  // The queue lives on the computer, so it survives reinstalling this app and
  // is shared with the desktop — which is also what drains it. There is
  // deliberately no local mirror; state comes back on `agent.queue`.

  func queueMessage(
    agentId: String, message: String, images: [RemoteImageAttachment], displayText: String
  ) async {
    guard let transport else {
      failedByAgent[agentId, default: []].append(
        FailedSend(
          id: "failed-\(UUID().uuidString)", body: message, displayText: displayText,
          images: images))
      return
    }
    struct Params: Encodable {
      let agent_id: String
      let message: String
      let display_text: String
      let images: [RemoteImageAttachment]?
    }
    do {
      try await transport.request(
        .agentsQueueAdd,
        Params(
          agent_id: agentId, message: message, display_text: displayText,
          images: images.isEmpty ? nil : images),
        as: IgnoredResult.self)
      Telemetry.capture(
        .messageSent(queued: true, hasImages: !images.isEmpty, length: message.count))
      await loadQueue(agentId: agentId)
    } catch {
      report(error, scope: "agent:queue")
      Telemetry.capture(.messageSendFailed(retried: false))
      // A queue add that never landed is as invisible as a send that didn't:
      // the computer's queue is the only record, and it has no row for this.
      failedByAgent[agentId, default: []].append(
        FailedSend(
          id: "failed-\(UUID().uuidString)", body: message, displayText: displayText,
          images: images))
    }
  }

  func loadQueue(agentId: String) async {
    guard let transport else { return }
    struct Params: Encodable { let agent_id: String }
    struct Result: Decodable { let messages: [RemoteQueuedMessage] }
    guard let result = try? await transport.request(
      .agentsQueueList, Params(agent_id: agentId), as: Result.self) else { return }
    queuedByAgent[agentId] = result.messages
  }

  func removeQueued(agentId: String, id: String) async {
    guard let transport else { return }
    struct Params: Encodable {
      let agent_id: String
      let id: String
    }
    do {
      try await transport.request(
        .agentsQueueRemove, Params(agent_id: agentId, id: id), as: IgnoredResult.self)
      await loadQueue(agentId: agentId)
    } catch { report(error) }
  }

  func updateQueued(agentId: String, id: String, message: String) async {
    guard let transport else { return }
    struct Params: Encodable {
      let agent_id: String
      let id: String
      let message: String
    }
    do {
      try await transport.request(
        .agentsQueueUpdate, Params(agent_id: agentId, id: id, message: message),
        as: IgnoredResult.self)
      await loadQueue(agentId: agentId)
    } catch { report(error) }
  }

  // MARK: Permissions

  func respond(
    agentId: String, toolUseId: String, decision: String, message: String? = nil,
    fromNotification: Bool = false
  ) async {
    Telemetry.capture(
      .permissionAnswered(approved: decision == "allow", fromNotification: fromNotification))
    // Clear the inline form at once; the round trip only confirms it.
    answered.insert(promptKey(agentId, toolUseId))
    prompts.removeValue(forKey: promptKey(agentId, toolUseId))

    guard let transport else {
      queueOfflineDecision(agentId: agentId, toolUseId: toolUseId, decision: decision)
      return
    }
    struct Params: Encodable {
      let agent_id: String
      let tool_use_id: String
      let decision: String
      let message: String?
    }
    do {
      try await transport.request(
        .permissionRespond,
        Params(
          agent_id: agentId, tool_use_id: toolUseId, decision: decision, message: message),
        as: IgnoredResult.self)
      await loadTranscript(agentId: agentId)
    } catch {
      queueOfflineDecision(agentId: agentId, toolUseId: toolUseId, decision: decision)
    }
  }

  // MARK: Agent lifecycle

  func interrupt(agentId: String) async {
    guard let transport else { return }
    Telemetry.capture(.agentControlled(action: .interrupt))
    struct Params: Encodable { let agent_id: String }
    try? await transport.request(
      .agentsInterrupt, Params(agent_id: agentId), as: IgnoredResult.self)
  }

  func stopAgent(agentId: String) async {
    guard let transport else { return }
    Telemetry.capture(.agentControlled(action: .stop))
    struct Params: Encodable { let agent_id: String }
    do {
      try await transport.request(
        .agentsStop, Params(agent_id: agentId), as: IgnoredResult.self)
    } catch { report(error) }
  }

  func loadCapabilities(agentId: String) async {
    guard let transport else { return }
    struct Params: Encodable { let agent_id: String }
    struct Result: Decodable { let capabilities: RemoteAgentCapabilities }
    guard let result = try? await transport.request(
      .agentsCapabilities, Params(agent_id: agentId), as: Result.self)
    else { return }
    capabilitiesByAgent[agentId] = result.capabilities
  }

  func setModel(agentId: String, model: String) async {
    guard let transport else { return }
    Telemetry.capture(.agentControlled(action: .model))
    struct Params: Encodable {
      let agent_id: String
      let model: String
    }
    do {
      try await transport.request(
        .agentsSetModel, Params(agent_id: agentId, model: model), as: IgnoredResult.self)
      await loadAgentStatus(agentId: agentId)
    } catch { report(error) }
  }

  func setPermissionMode(agentId: String, mode: RemotePermissionMode) async {
    guard let transport else { return }
    Telemetry.capture(.agentControlled(action: .permissionMode))
    struct Params: Encodable {
      let agent_id: String
      let mode: String
    }
    do {
      try await transport.request(
        .agentsSetPermissionMode, Params(agent_id: agentId, mode: mode.rawValue),
        as: IgnoredResult.self)
      await loadAgentStatus(agentId: agentId)
    } catch { report(error) }
  }

  /// Approving a plan drops the CLI out of plan mode, but that only reaches us
  /// on the next status poll — move the chip now so it doesn't lie. A pre-plan
  /// mode other than `auto` is restored by the next snapshot.
  func noteLeftPlanMode(agentId: String) {
    guard statusByAgent[agentId]?.permissionMode == RemotePermissionMode.plan.rawValue else {
      return
    }
    statusByAgent[agentId]?.permissionMode = RemotePermissionMode.auto.rawValue
  }

  func setEffort(agentId: String, level: String?) async {
    guard let transport else { return }
    Telemetry.capture(.agentControlled(action: .effort))
    struct Params: Encodable {
      let agent_id: String
      let level: String?
    }
    // The monitor snapshot doesn't carry effort, so remember the choice here.
    if let level { effortByAgent[agentId] = level } else { effortByAgent[agentId] = nil }
    do {
      try await transport.request(
        .agentsSetEffort, Params(agent_id: agentId, level: level), as: IgnoredResult.self)
    } catch { report(error) }
  }

  @discardableResult
  func spawnAgent(
    sessionId: String, model: String? = nil, permissionMode: RemotePermissionMode? = nil,
    resumeSessionId: String? = nil, runnerId: String? = nil
  ) async -> RemoteAgentStatus? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let session_id: String
      let model: String?
      let permission_mode: String?
      let resume_session_id: String?
      let runner_id: String?
    }
    struct Result: Decodable { let agent: RemoteAgentStatus }
    do {
      let agent = try await transport.request(
        .agentsSpawn,
        Params(
          session_id: sessionId, model: model, permission_mode: permissionMode?.rawValue,
          resume_session_id: resumeSessionId, runner_id: runnerId),
        as: Result.self
      ).agent
      statusByAgent[agent.agentId] = agent
      return agent
    } catch {
      report(error)
      return nil
    }
  }

  // MARK: Sessions

  @discardableResult
  func createSession(
    repoRoot: String, branch: String, description: String,
    useExistingBranch: Bool? = nil, baseBranch: String? = nil
  ) async -> RemoteSession? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let repo_root: String
      let branch: String
      let description: String
      let use_existing_branch: Bool?
      let base_branch: String?
    }
    struct Result: Decodable { let session: RemoteSession }
    do {
      return try await transport.request(
        .sessionsCreate,
        Params(
          repo_root: repoRoot, branch: branch, description: description,
          use_existing_branch: useExistingBranch, base_branch: baseBranch),
        as: Result.self
      ).session
    } catch {
      report(error)
      return nil
    }
  }

  /// Hand a plan to a fresh session: create it, wait for its worktree, then
  /// start an agent on the plan. The desktop seeds the prompt renderer-side
  /// once the session turns ready; there is no host-side equivalent, so the
  /// wait happens here.
  func handOffPlan(repoRoot: String, plan: String) async {
    let prompt = "Implement the following plan:\n\n\(plan)"
    guard let session = await createSession(repoRoot: repoRoot, branch: "", description: prompt)
    else { return }

    // Spawning before the worktree exists would give the agent the wrong cwd.
    var ready = session.status == .ready
    for _ in 0..<60 where !ready {
      try? await Task.sleep(for: .seconds(2))
      await loadSessions(repoRoot: repoRoot)
      guard let current = sessionsByRepo[repoRoot]?.first(where: { $0.id == session.id }) else {
        break
      }
      if current.status == .error {
        lastError = "The new session failed to set up, so the plan wasn't handed off."
        return
      }
      ready = current.status == .ready
    }
    guard ready else {
      lastError = "The new session is still setting up — start the plan from it once it's ready."
      return
    }

    guard let agent = await spawnAgent(sessionId: session.id) else { return }
    await sendMessage(agentId: agent.agentId, message: prompt)
    await loadAgents(repoRoot: repoRoot)
  }

  // MARK: Landing work

  /// Stage everything and commit. Returns git's own output, or nil when it
  /// refused — the message is already on `lastError` by then.
  func commit(sessionId: String, message: String) async -> String? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let session_id: String
      let message: String
    }
    struct Result: Decodable { let output: String }
    do {
      let output = try await transport.request(
        .sessionsCommit, Params(session_id: sessionId, message: message),
        as: Result.self
      ).output
      Telemetry.capture(.workLanded(action: .commit, success: true))
      await loadGitStatus(sessionId: sessionId)

      return output
    } catch {
      report(error, scope: "session:commit")
      Telemetry.capture(.workLanded(action: .commit, success: false))

      return nil
    }
  }

  struct PushResult: Decodable {
    let branch: String
    let remote: String
    /// GitHub's "create a PR" link, when the push printed one.
    let pr_url: String?
  }

  @discardableResult
  func push(sessionId: String) async -> PushResult? {
    guard let transport else { return nil }
    struct Params: Encodable { let session_id: String }
    do {
      let result = try await transport.request(
        .sessionsPush, Params(session_id: sessionId), as: PushResult.self)
      Telemetry.capture(.workLanded(action: .push, success: true))
      await loadGitStatus(sessionId: sessionId)

      return result
    } catch {
      report(error, scope: "session:push")
      Telemetry.capture(.workLanded(action: .push, success: false))

      return nil
    }
  }

  /// Empty means the merge would go through.
  func mergeBlockers(sessionId: String) async -> [String] {
    guard let transport else { return [] }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let blockers: [String] }
    guard let result = try? await transport.request(
      .sessionsMergeBlockers, Params(session_id: sessionId), as: Result.self) else { return [] }

    return result.blockers
  }

  @discardableResult
  func mergeIntoBase(sessionId: String) async -> Bool {
    guard let transport else { return false }
    struct Params: Encodable { let session_id: String }
    do {
      try await transport.request(
        .sessionsMergeBase, Params(session_id: sessionId), as: IgnoredResult.self)
      Telemetry.capture(.workLanded(action: .merge, success: true))
      await loadGitStatus(sessionId: sessionId)

      return true
    } catch {
      report(error, scope: "session:merge")
      Telemetry.capture(.workLanded(action: .merge, success: false))

      return false
    }
  }

  func deleteSession(id: String, repoRoot: String, deleteBranch: Bool = false) async {
    guard let transport else { return }
    struct Params: Encodable {
      let id: String
      let delete_branch: Bool
    }
    do {
      try await transport.request(
        .sessionsDelete, Params(id: id, delete_branch: deleteBranch),
        as: IgnoredResult.self)
      await loadSessions(repoRoot: repoRoot)
      await loadAgents(repoRoot: repoRoot)
    } catch { report(error) }
  }

  func renameSession(id: String, repoRoot: String, name: String) async {
    guard let transport else { return }
    struct Params: Encodable {
      let id: String
      let display_name: String
    }
    do {
      try await transport.request(
        .sessionsRename, Params(id: id, display_name: name), as: IgnoredResult.self)
      Telemetry.capture(.sessionRenamed(target: "session"))
      await loadSessions(repoRoot: repoRoot)
    } catch { report(error) }
  }

  func renameSessionBranch(id: String, repoRoot: String, branch: String) async {
    guard let transport else { return }
    struct Params: Encodable {
      let id: String
      let branch: String
    }
    do {
      try await transport.request(
        .sessionsRenameBranch, Params(id: id, branch: branch), as: IgnoredResult.self)
      Telemetry.capture(.sessionRenamed(target: "branch"))
      await loadSessions(repoRoot: repoRoot)
    } catch { report(error) }
  }

  // MARK: Branches

  enum CheckoutOutcome { case ok, dirty, failed }

  func checkoutBranch(
    sessionId: String, repoRoot: String, branch: String, dirty: String? = nil
  ) async -> CheckoutOutcome {
    guard let transport else { return .failed }
    struct Params: Encodable {
      let session_id: String
      let branch: String
      let dirty: String?
    }
    struct Result: Decodable {
      let accepted: Bool
      let blocked_by: String?
    }
    do {
      let result = try await transport.request(
        .sessionsCheckout, Params(session_id: sessionId, branch: branch, dirty: dirty),
        as: Result.self)
      if result.blocked_by == "dirty" { return .dirty }
      if result.accepted { Telemetry.capture(.branchActed(action: .checkout)) }
      await loadGitStatus(sessionId: sessionId)
      await loadSessions(repoRoot: repoRoot)
      return result.accepted ? .ok : .failed
    } catch {
      report(error)
      return .failed
    }
  }

  func createBranch(
    sessionId: String, repoRoot: String, name: String, checkout: Bool, startPoint: String? = nil
  ) async {
    guard let transport else { return }
    struct Params: Encodable {
      let session_id: String
      let name: String
      let checkout: Bool
      let start_point: String?
    }
    do {
      try await transport.request(
        .sessionsCreateBranch,
        Params(session_id: sessionId, name: name, checkout: checkout, start_point: startPoint),
        as: IgnoredResult.self)
      Telemetry.capture(.branchActed(action: .create))
      await loadGitStatus(sessionId: sessionId)
    } catch { report(error) }
  }

  enum DeleteBranchOutcome { case ok, unmerged, failed }

  func deleteBranch(sessionId: String, name: String, force: Bool = false) async
    -> DeleteBranchOutcome
  {
    guard let transport else { return .failed }
    struct Params: Encodable {
      let session_id: String
      let name: String
      let force: Bool
    }
    struct Result: Decodable {
      let accepted: Bool
      let blocked_by: String?
    }
    do {
      let result = try await transport.request(
        .sessionsDeleteBranch, Params(session_id: sessionId, name: name, force: force),
        as: Result.self)
      if result.blocked_by == "unmerged" { return .unmerged }
      if result.accepted { Telemetry.capture(.branchActed(action: .delete)) }
      return result.accepted ? .ok : .failed
    } catch {
      report(error)
      return .failed
    }
  }

  // MARK: Mentions

  func listFiles(sessionId: String) async -> [String] {
    guard let transport else { return [] }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let files: [String] }
    let result = try? await transport.request(
      .sessionsFiles, Params(session_id: sessionId), as: Result.self)
    return result?.files ?? []
  }

  func resolveMentionPath(sessionId: String, query: String) async -> RemoteMentionPathResult? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let session_id: String
      let query: String
    }
    return try? await transport.request(
      .sessionsResolveMentionPath, Params(session_id: sessionId, query: query),
      as: RemoteMentionPathResult.self)
  }

  // MARK: Devices

  func watchDevice(deviceId: String, platform: RemotePlatform) async -> UInt16? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
    }
    struct Result: Decodable { let stream_id: Int }
    let result = try? await transport.request(
      .devicesWatch, Params(device_id: deviceId, platform: platform.rawValue), as: Result.self)
    return result.map { UInt16(truncatingIfNeeded: $0.stream_id) }
  }

  func unwatchDevice(deviceId: String) async {
    guard let transport else { return }
    struct Params: Encodable { let device_id: String }
    try? await transport.request(
      .devicesUnwatch, Params(device_id: deviceId), as: IgnoredResult.self)
  }

  /// How the device is being held. Null on Android, which rotates its own
  /// framebuffer and has no hinge to report.
  func deviceState(deviceId: String, platform: RemotePlatform) async -> RemoteDeviceState? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
    }
    struct Result: Decodable { let state: RemoteDeviceState? }
    let result = try? await transport.request(
      .devicesState, Params(device_id: deviceId, platform: platform.rawValue), as: Result.self)
    return result?.state
  }

  @discardableResult
  func setDeviceOrientation(
    deviceId: String, platform: RemotePlatform, orientation: RemoteDeviceOrientation
  ) async -> RemoteDeviceState? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let orientation: String
    }
    struct Result: Decodable { let state: RemoteDeviceState? }
    let result = try? await transport.request(
      .devicesSetOrientation,
      Params(
        device_id: deviceId, platform: platform.rawValue, orientation: orientation.rawValue),
      as: Result.self)
    return result?.state
  }

  @discardableResult
  func setDeviceFold(
    deviceId: String, platform: RemotePlatform, pose: RemoteFoldPose
  ) async -> RemoteDeviceState? {
    guard let transport else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let pose: String
    }
    struct Result: Decodable { let state: RemoteDeviceState? }
    let result = try? await transport.request(
      .devicesSetFold,
      Params(device_id: deviceId, platform: platform.rawValue, pose: pose.rawValue),
      as: Result.self)
    return result?.state
  }

  /// Fire-and-forget: a touch that waits for a round trip feels broken.
  func deviceTouch(
    deviceId: String, platform: RemotePlatform, x: Double, y: Double, eventType: Int
  ) {
    guard let transport else { return }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let x: Double
      let y: Double
      let event_type: Int
    }
    Task {
      try? await transport.request(
        .devicesTouch,
        Params(
          device_id: deviceId, platform: platform.rawValue,
          x: min(max(x, 0), 0.9999), y: min(max(y, 0), 0.9999), event_type: eventType),
        as: IgnoredResult.self)
    }
  }

  // MARK: Device claims
  //
  // Two clients may watch one screen; both injecting touches into it is
  // nonsense, so the host arbitrates. Taking the claim up front means the
  // phone can say who is driving instead of silently dropping taps.

  /// Take the device. `force` steals it from whoever holds it.
  @discardableResult
  func claimDevice(deviceId: String, force: Bool = false) async -> Bool {
    guard let transport else { return false }
    struct Params: Encodable {
      let device_id: String
      let force: Bool
    }
    struct Result: Decodable {
      let granted: Bool
      let holder: RemoteDeviceClaim?
    }
    guard let result = try? await transport.request(
      .devicesClaim, Params(device_id: deviceId, force: force), as: Result.self)
    else { return false }
    deviceClaims[deviceId] = RemoteDeviceClaimState(
      deviceId: deviceId, holder: result.holder, waiting: [])

    return result.granted
  }

  func releaseDevice(deviceId: String) async {
    guard let transport else { return }
    struct Params: Encodable { let device_id: String }
    try? await transport.request(
      .devicesRelease, Params(device_id: deviceId), as: IgnoredResult.self)
    deviceClaims.removeValue(forKey: deviceId)
  }

  /// Who holds the device — and, as a side effect, this connection's own id,
  /// which the host reports nowhere else.
  func loadClaimStatus(deviceId: String) async {
    guard let transport else { return }
    struct Params: Encodable { let device_id: String }
    struct Result: Decodable {
      let holder: RemoteDeviceClaim?
      let connection_id: String
    }
    guard let result = try? await transport.request(
      .devicesClaimStatus, Params(device_id: deviceId), as: Result.self) else { return }
    connectionId = result.connection_id
    deviceClaims[deviceId] = RemoteDeviceClaimState(
      deviceId: deviceId, holder: result.holder, waiting: [])
  }

  func deviceButton(deviceId: String, platform: RemotePlatform, button: String) {
    guard let transport else { return }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let button: String
    }
    Task {
      try? await transport.request(
        .devicesButton,
        Params(device_id: deviceId, platform: platform.rawValue, button: button),
        as: IgnoredResult.self)
    }
  }

  func deviceKeyboard(
    deviceId: String, platform: RemotePlatform, keyCode: Int, modifiers: Int, isDown: Bool
  ) {
    guard let transport else { return }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let key_code: Int
      let modifiers: Int
      let is_down: Bool
    }
    Task {
      try? await transport.request(
        .devicesKeyboard,
        Params(
          device_id: deviceId, platform: platform.rawValue, key_code: keyCode,
          modifiers: modifiers, is_down: isDown),
        as: IgnoredResult.self)
    }
  }
}
