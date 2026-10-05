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
    if ownsConversations, let live, live.agents[agentId] != nil {
      await sendLive(
        live, agentId: agentId, message: message, images: images, displayText: displayText,
        isRetry: isRetry)
      return
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
      await loadTranscript(agentId: agentId)
    } catch {
      report(error, scope: "agent:send")
      markFailed(agentId: agentId, localId: localId, message: message, displayText: displayText,
        images: images, isRetry: isRetry)
    }
  }

  /// The local send: the bubble goes straight into the live conversation, so
  /// there is no optimistic copy to reconcile.
  private func sendLive(
    _ live: LiveAgents, agentId: String, message: String, images: [RemoteImageAttachment],
    displayText: String?, isRetry: Bool
  ) async {
    do {
      switch try await live.send(
        agentId: agentId, message: message, images: images, author: huddleAuthor?(agentId)) {
      case .sent:
        hooks.track(
          .messageSent(queued: false, hasImages: !images.isEmpty, length: message.count))
      case .busy:
        await queueMessage(
          agentId: agentId, message: message, images: images,
          displayText: displayText ?? message)
      }
    } catch {
      report(error, scope: "agent:send")
      hooks.track(.messageSendFailed(retried: isRetry))
      failedByAgent[agentId, default: []].append(
        FailedSend(
          id: "failed-\(UUID().uuidString)", body: message, displayText: displayText,
          images: images))
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
  // is shared with the desktop — which is also what drains it. There is
  // deliberately no local mirror; state comes back on `agent.queue`.

  public func queueMessage(
    agentId: String, message: String, images: [RemoteImageAttachment], displayText: String
  ) async {
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
    guard let backend else { return }
    struct Params: Encodable { let agent_id: String }
    struct Result: Decodable { let messages: [RemoteQueuedMessage] }
    guard let result = try? await backend.request(
      .agentsQueueList, Params(agent_id: agentId), as: Result.self) else { return }
    queuedByAgent[agentId] = result.messages
  }

  public func removeQueued(agentId: String, id: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      let agent_id: String
      let id: String
    }
    do {
      try await backend.request(
        .agentsQueueRemove, Params(agent_id: agentId, id: id), as: IgnoredResult.self)
      await loadQueue(agentId: agentId)
    } catch { report(error) }
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

  // MARK: Permissions

  /// `alwaysAllow` is an "Always allow" rule for the rest of the session. Only
  /// a local backend can pass one — the remote method has no field for it.
  public func respond(
    agentId: String, toolUseId: String, decision: String, message: String? = nil,
    alwaysAllow: String? = nil, fromNotification: Bool = false
  ) async {
    hooks.track(
      .permissionAnswered(approved: decision == "allow", fromNotification: fromNotification))
    // Clear the inline form at once; the round trip only confirms it.
    let key = promptKey(agentId, toolUseId)
    let prompt = prompts.removeValue(forKey: key)
    answered.insert(key)

    guard let backend else {
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
    }
    do {
      try await backend.request(
        .permissionRespond,
        Params(
          agent_id: agentId, tool_use_id: toolUseId, decision: decision, message: message),
        as: IgnoredResult.self)
      await loadTranscript(agentId: agentId)
    } catch {
      // Refused or lost: put the prompt back so it can be answered again.
      answered.remove(key)
      if let prompt { prompts[key] = prompt }
      lastError = Self.refusedAnswerMessage(error)
      hooks.decisionUndelivered(agentId, toolUseId, decision)
    }
  }

  /// Why an answer didn't land, in words: the host's own reason otherwise.
  public nonisolated static func refusedAnswerMessage(_ error: Error) -> String {
    let reason = describe(error)
    guard reason.contains("no such outstanding prompt") else { return "Your answer didn't reach the agent: \(reason)" }
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
    // Save while the conversation is still whole.
    if ownsConversations { await live?.save(agentId) }
    struct Params: Encodable { let agent_id: String }
    do {
      try await backend.request(
        .agentsStop, Params(agent_id: agentId), as: IgnoredResult.self)
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
    guard let backend else { return }
    hooks.track(.agentControlled(action: .effort))
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
    resumeSessionId: String? = nil, runnerId: String? = nil
  ) async -> RemoteAgentStatus? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let model: String?
      let permission_mode: String?
      let resume_session_id: String?
      let runner_id: String?
    }
    struct Result: Decodable { let agent: RemoteAgentStatus }
    do {
      let agent = try await backend.request(
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
}
