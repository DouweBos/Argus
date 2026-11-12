import ArgusKit
import Foundation

/// Control-scoped actions. Every one of these is refused by the gateway
/// without the `control` grant — `hasControl` only decides whether the UI
/// offers the button, it is not the enforcement.
extension HostStore {

  // MARK: Messaging

  public func sendMessage(
    agentId: String, message: String, images: [RemoteImageAttachment] = [],
    displayText: String? = nil, isRetry: Bool = false
  ) async {
    if shouldHoldReply {
      return holdReply(agentId: agentId, message: message, displayText: displayText, images: images)
    }
    let localId = appendOptimistic(agentId: agentId, text: displayText ?? message, images: images)
    // No socket at all still has to land somewhere the user can see and retry,
    // or the message is gone the moment the lock screen took the connection.
    guard let backend else {
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
      let result = try await backend.request(
        .agentsSend,
        Params(
          agent_id: agentId, message: message, display_text: displayText,
          images: images.isEmpty ? nil : images),
        as: Result.self)
      hooks.track(
        .messageSent(
          queued: result.queued == true, hasImages: !images.isEmpty, length: message.count))
      // The computer queues a send that arrived mid-turn. Drop the bubble and
      // let the queue show it, or it reads as already delivered.
      if result.queued == true {
        await loadQueue(agentId: agentId)
        optimisticByAgent[agentId]?.removeAll { $0.id == localId }

        return
      }
      await refreshTranscript(agentId: agentId)
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
    hooks.track(.messageSendFailed(retried: isRetry))
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
  public func retryFailed(agentId: String, id: String) async {
    guard let pending = failedByAgent[agentId]?.first(where: { $0.id == id }) else { return }
    discardFailed(agentId: agentId, id: id)
    await sendMessage(
      agentId: agentId, message: pending.body, images: pending.images,
      displayText: pending.displayText, isRetry: true)
  }

  public func discardFailed(agentId: String, id: String) {
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
    let id = Self.optimisticId()
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

  /// Bubbles that exist only on this phone so far, drawn as "sending".
  public static func isOptimistic(id: String) -> Bool { id.hasPrefix("optimistic-") }

  private static func optimisticId() -> String {
    "optimistic-\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 0..<10000))"
  }

  // MARK: Queue
  //
  // The queue lives on the computer, so it survives reinstalling this app and
  // is shared with the desktop — which is also what drains it. The host's
  // list is authoritative; it comes back on `agent.queue` and `loadQueue`.

  public func queueMessage(
    agentId: String, message: String, images: [RemoteImageAttachment], displayText: String
  ) async {
    // Sent as a plain message on reconnect: the computer queues one that arrives mid-turn.
    if shouldHoldReply {
      return holdReply(agentId: agentId, message: message, displayText: displayText, images: images)
    }
    guard let backend else {
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
    let sending = RemoteQueuedMessage(
      id: Self.optimisticId(), text: message, displayText: displayText,
      images: images.isEmpty ? nil : images,
      queuedAt: Date().timeIntervalSince1970 * 1000)
    sendingQueuedByAgent[agentId, default: []].append(sending)
    defer {
      sendingQueuedByAgent[agentId]?.removeAll { $0.id == sending.id }
      if sendingQueuedByAgent[agentId]?.isEmpty == true { sendingQueuedByAgent[agentId] = nil }
    }
    do {
      try await backend.request(
        .agentsQueueAdd,
        Params(
          agent_id: agentId, message: message, display_text: displayText,
          images: images.isEmpty ? nil : images),
        as: IgnoredResult.self)
      hooks.track(
        .messageSent(queued: true, hasImages: !images.isEmpty, length: message.count))
      await loadQueue(agentId: agentId)
    } catch {
      report(error, scope: "agent:queue")
      hooks.track(.messageSendFailed(retried: false))
      // A queue add that never landed is as invisible as a send that didn't:
      // the computer's queue is the only record, and it has no row for this.
      failedByAgent[agentId, default: []].append(
        FailedSend(
          id: "failed-\(UUID().uuidString)", body: message, displayText: displayText,
          images: images))
    }
  }

  public func loadQueue(agentId: String) async {
    guard let backend, !holdsFresher(queuedByAgent[agentId] != nil) else { return }
    struct Params: Encodable { let agent_id: String }
    struct Result: Decodable { let messages: [RemoteQueuedMessage] }
    guard
      let (result, seq) = try? await backend.sequencedRequest(
        .agentsQueueList, Params(agent_id: agentId), as: Result.self)
    else { return }
    applyQueue(result.messages, agentId: agentId, seq: seq)
  }

  /// Take the host's queue unless something newer already landed: a list
  /// answered before the agent drained it can reach us after the drain's event.
  func applyQueue(_ messages: [RemoteQueuedMessage], agentId: String, seq: Int) {
    if seq != Int.min {
      if let held = queueSeq[agentId], held > seq { return }
      queueSeq[agentId] = seq
    }
    queuedByAgent[agentId] = messages
  }

  /// Queue events missed while the connection was down are gone; re-read every
  /// queue on screen or still showing entries.
  public func resyncQueues() {
    let agents = Set(queuedByAgent.filter { !$0.value.isEmpty }.keys)
      .union(watchedAgents)
    for agentId in agents {
      queueSeq[agentId] = nil
      Task { await loadQueue(agentId: agentId) }
    }
  }

  public func removeQueued(agentId: String, id: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      let agent_id: String
      let id: String
    }
    // Gone at once; the re-read below puts it back if the host kept it.
    queuedByAgent[agentId]?.removeAll { $0.id == id }
    do {
      try await backend.request(
        .agentsQueueRemove, Params(agent_id: agentId, id: id), as: IgnoredResult.self)
    } catch { report(error) }
    await loadQueue(agentId: agentId)
  }

  public func updateQueued(agentId: String, id: String, message: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      let agent_id: String
      let id: String
      let message: String
    }
    do {
      try await backend.request(
        .agentsQueueUpdate, Params(agent_id: agentId, id: id, message: message),
        as: IgnoredResult.self)
      await loadQueue(agentId: agentId)
    } catch { report(error) }
  }

  /// Send one queued message ahead of the rest. A busy agent takes it into its
  /// running turn rather than being interrupted.
  public func sendQueuedNow(agentId: String, id: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      let agent_id: String
      let id: String
    }
    do {
      try await backend.request(
        .agentsQueueSendNow, Params(agent_id: agentId, id: id), as: IgnoredResult.self)
    } catch { report(error, scope: "agent:queue") }
    await loadQueue(agentId: agentId)
  }

  // MARK: Permissions

  /// The agent's open permission prompt, subscribing just long enough for the
  /// gateway to replay it — it only takes answers to prompts it forwarded here.
  public func awaitPendingPrompt(agentId: String, timeout: Duration = .seconds(4)) async -> RemotePermissionRequest? {
    func current() -> RemotePermissionRequest? { prompts.values.first { $0.agentId == agentId } }
    if let prompt = current() { return prompt }
    let alreadyWatched = watchedAgents.contains(agentId)
    if !alreadyWatched { await watchAgent(agentId, on: true) }
    let deadline = ContinuousClock.now.advanced(by: timeout)
    while current() == nil, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(150)) }
    let prompt = current()
    // The replay registered the prompt with this connection; the subscription can go.
    if !alreadyWatched { await watchAgent(agentId, on: false) }
    return prompt
  }

  /// `alwaysAllow` is an "Always allow" rule for the rest of the session. The
  /// gateway derives the same rule itself, so a phone only asks for one.
  public func respond(
    agentId: String, toolUseId: String, decision: String, message: String? = nil,
    alwaysAllow: String? = nil, fromNotification: Bool = false
  ) async {
    hooks.track(
      .permissionAnswered(
        approved: decision == "allow", alwaysAllow: alwaysAllow != nil,
        fromNotification: fromNotification))
    // Clear the inline form at once; the round trip only confirms it.
    let key = promptKey(agentId, toolUseId)
    let prompt = prompts.removeValue(forKey: key)
    answered.insert(key)

    // Offline, the answer waits for the connection like a notification's does.
    guard let backend, !shouldHoldReply else {
      hooks.decisionUndelivered(agentId, toolUseId, decision)
      return
    }
    if let alwaysAllow, backend.kind == .local {
      do {
        _ = try await backend.request(
          ArgusProtocol.Commands.RespondToPermission.self,
          .init(
            agentId: agentId, toolUseId: toolUseId, decision: .allow, allowRule: alwaysAllow,
            allowAll: true))
      } catch {
        hooks.decisionUndelivered(agentId, toolUseId, decision)
      }
      return
    }
    struct Params: Encodable {
      let agent_id: String
      let tool_use_id: String
      let decision: String
      let message: String?
      let always_allow: Bool?
    }
    struct Result: Decodable { let allow_rule: String? }
    do {
      let result = try await backend.request(
        .permissionRespond,
        Params(
          agent_id: agentId, tool_use_id: toolUseId, decision: decision, message: message,
          always_allow: alwaysAllow != nil ? true : nil),
        as: Result.self)
      if alwaysAllow != nil, result.allow_rule == nil {
        lastError = Self.alwaysAllowUnsupported
      }
      await refreshTranscript(agentId: agentId)
    } catch {
      lastError = Self.refusedAnswerMessage(error)
      // The host has nothing waiting there, so a retry can only fail again.
      if Self.isPromptGone(error) {
        await refreshTranscript(agentId: agentId)
        return
      }
      // Refused or lost: put the prompt back so it can be answered again.
      answered.remove(key)
      if let prompt { prompts[key] = prompt }
      hooks.decisionUndelivered(agentId, toolUseId, decision)
    }
  }

  nonisolated static func isPromptGone(_ error: Error) -> Bool {
    describe(error).contains("no such outstanding prompt")
  }

  /// An older computer ignores the request and allows the call just once.
  public nonisolated static let alwaysAllowUnsupported =
    "Allowed once. Update Argus on your computer to always allow from here."

  /// Why an answer didn't land, in words: the host's own reason otherwise.
  public nonisolated static func refusedAnswerMessage(_ error: Error) -> String {
    let reason = describe(error)
    guard isPromptGone(error) else { return "Your answer didn't reach the agent: \(reason)" }
    return "That prompt is no longer waiting — the agent may have stopped or someone else answered it."
  }

  // MARK: Agent lifecycle

  public func interrupt(agentId: String) async {
    guard let backend else { return }
    hooks.track(.agentControlled(action: .interrupt))
    struct Params: Encodable { let agent_id: String }
    _ = try? await backend.request(
      .agentsInterrupt, Params(agent_id: agentId), as: IgnoredResult.self)
  }

  /// Cancel the continue scheduled after a usage limit; the host captures it.
  public func dismissLimitResume(agentId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let agent_id: String }
    _ = try? await backend.request(
      .agentsDismissLimitResume, Params(agent_id: agentId), as: IgnoredResult.self)
  }

  public func stopAgent(agentId: String) async {
    guard let backend else { return }
    hooks.track(.agentControlled(action: .stop))
    struct Params: Encodable { let agent_id: String }
    do {
      try await backend.request(
        .agentsStop, Params(agent_id: agentId), as: IgnoredResult.self)
      // The host forgets a stopped agent rather than announcing it.
      agentExited(agentId, code: 0)
    } catch { report(error) }
  }

  public func loadCapabilities(agentId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let agent_id: String }
    struct Result: Decodable { let capabilities: RemoteAgentCapabilities }
    guard let result = try? await backend.request(
      .agentsCapabilities, Params(agent_id: agentId), as: Result.self)
    else { return }
    capabilitiesByAgent[agentId] = result.capabilities
  }

  public func setModel(agentId: String, model: String) async {
    guard let backend else { return }
    hooks.track(.agentControlled(action: .model))
    struct Params: Encodable {
      let agent_id: String
      let model: String
    }
    do {
      try await backend.request(
        .agentsSetModel, Params(agent_id: agentId, model: model), as: IgnoredResult.self)
      await loadAgentStatus(agentId: agentId)
    } catch { report(error) }
  }

  public func setPermissionMode(agentId: String, mode: RemotePermissionMode) async {
    guard let backend else { return }
    hooks.track(.agentControlled(action: .permissionMode))
    struct Params: Encodable {
      let agent_id: String
      let mode: String
    }
    do {
      try await backend.request(
        .agentsSetPermissionMode, Params(agent_id: agentId, mode: mode.rawValue),
        as: IgnoredResult.self)
      await loadAgentStatus(agentId: agentId)
    } catch { report(error) }
  }

  /// Approving a plan drops the CLI out of plan mode, but that only reaches us
  /// on the next status poll — move the chip now so it doesn't lie. A pre-plan
  /// mode other than `auto` is restored by the next snapshot.
  public func noteLeftPlanMode(agentId: String) {
    guard statusByAgent[agentId]?.permissionMode == RemotePermissionMode.plan.rawValue else {
      return
    }
    statusByAgent[agentId]?.permissionMode = RemotePermissionMode.auto.rawValue
  }

  public func setEffort(agentId: String, level: String?) async {
    hooks.track(.agentControlled(action: .effort))
    await applyEffort(agentId: agentId, level: level)
  }

  /// `setEffort` without counting it as the user's: a resume carrying the old one over.
  func applyEffort(agentId: String, level: String?) async {
    guard let backend else { return }
    struct Params: Encodable {
      let agent_id: String
      let level: String?
    }
    // The monitor snapshot doesn't carry effort, so remember the choice here.
    if let level { effortByAgent[agentId] = level } else { effortByAgent[agentId] = nil }
    do {
      try await backend.request(
        .agentsSetEffort, Params(agent_id: agentId, level: level), as: IgnoredResult.self)
    } catch { report(error) }
  }

  @discardableResult
  public func spawnAgent(
    sessionId: String, model: String? = nil, permissionMode: RemotePermissionMode? = nil,
    resumeSessionId: String? = nil, runnerId: String? = nil, claudeAccountId: String? = nil
  ) async -> RemoteAgentStatus? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let model: String?
      let permission_mode: String?
      let resume_session_id: String?
      let runner_id: String?
      /// `""` follows the computer's default; nil leaves the session's pin.
      let claude_account_id: String?
    }
    struct Result: Decodable { let agent: RemoteAgentStatus }
    do {
      let agent = try await backend.request(
        .agentsSpawn,
        Params(
          session_id: sessionId, model: model, permission_mode: permissionMode?.rawValue,
          resume_session_id: resumeSessionId, runner_id: runnerId, claude_account_id: claudeAccountId),
        as: Result.self
      ).agent
      statusByAgent[agent.agentId] = agent
      // The tab can't hang on `agent:started` alone: a missed event loses it.
      if let repoRoot = repoRoot(forSessionId: sessionId) { await loadAgents(repoRoot: repoRoot) }
      return agent
    } catch {
      report(error)
      return nil
    }
  }
}
