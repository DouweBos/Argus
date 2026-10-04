import ArgusKit
import Foundation

/// Turn bookkeeping and the queue drain — the renderer's `onTurnOver`,
/// `trySendNextQueued` and `trySetIdle`, plus its chat-input send.
extension LiveAgents {

  /// The host reports the turn over: send the next queued message or settle.
  func onTurnOver(_ agentId: String) {
    inflight.remove(agentId)
    let finished = finishedTurns.removeValue(forKey: agentId)
    if trySendNextQueued(agentId) { return }
    trySetIdle(agentId)
    if let finished {
      notifyAgentFinished(agentId, durationMs: finished.durationMs, failed: finished.failed)
    }
  }

  /// Settle on idle — unless a message is in flight, whose idle is still to come.
  func trySetIdle(_ agentId: String) {
    guard !inflight.contains(agentId) else { return }
    setStatus(agentId, .idle)
  }

  /// Pop the next queued message and send it. False when nothing went out.
  ///
  /// Bails while a message is in flight, so overlapping signals don't drain
  /// several queued messages into one turn. Decides from the mirrored queue,
  /// then claims `inflight` before the first await.
  @discardableResult
  func trySendNextQueued(_ agentId: String) -> Bool {
    guard !inflight.contains(agentId), let backend,
      !(store?.queuedByAgent[agentId] ?? []).isEmpty
    else { return false }
    inflight.insert(agentId)
    setStatus(agentId, .running)

    let sessionId = agents[agentId]?.sessionId
    Task { @MainActor [weak self] in
      let next = (try? await backend.request(
        ArgusProtocol.Commands.DequeueMessage.self, .init(agentId: agentId))) ?? nil
      guard let self else { return }
      guard let next else {
        self.inflight.remove(agentId)
        self.trySetIdle(agentId)
        return
      }
      let checkpointId = await self.checkpoint(sessionId)
      let images = next.images?.map { ConversationImage(data: $0.data, mediaType: $0.mediaType) }
      self.mutate(agentId) {
        $0.addUserMessage(next.text, images: images, checkpointId: checkpointId, author: next.author)
      }
      _ = try? await backend.request(
        ArgusProtocol.Commands.SendAgentMessage.self,
        .init(agentId: agentId, message: next.text, images: next.images))
      self.scheduleSave(agentId)
    }
    return true
  }

  /// A worktree snapshot taken right before a prompt goes out, so the user can
  /// revert to it. Best-effort: a git failure never blocks the send.
  func checkpoint(_ sessionId: String?) async -> String? {
    guard let sessionId, let backend else { return nil }
    return try? await backend.request(
      ArgusProtocol.Commands.CreateCheckpoint.self, .init(sessionId: sessionId)
    ).id
  }

  // MARK: Sending

  public enum SendOutcome: Sendable, Equatable {
    case sent
    /// The agent was busy; the caller queues it.
    case busy
  }

  /// The chat input's send: a busy agent gets `.busy` back for the caller to
  /// queue; an idle one gets a checkpoint, the user bubble and the message.
  /// On failure the bubble comes back out, so the caller can offer a retry.
  func send(
    agentId: String, message: String, images: [RemoteImageAttachment], author: String? = nil
  ) async throws -> SendOutcome {
    guard let backend else { throw Transport.TransportError.notReady }
    maybeGenerateTitle(agentId, firstMessage: message)
    if agents[agentId]?.status == .running { return .busy }

    let checkpointId = await checkpoint(agents[agentId]?.sessionId)
    let conversationImages = images.map { ConversationImage(data: $0.data, mediaType: $0.mediaType) }
    let messageId = mutate(agentId) { reducer -> String? in
      reducer.addUserMessage(message, images: conversationImages, checkpointId: checkpointId, author: author)
      return reducer.conversation?.messages.last?.id
    }
    inflight.insert(agentId)
    scheduleSave(agentId)
    setStatus(agentId, .running)
    do {
      try await backend.request(
        ArgusProtocol.Commands.SendAgentMessage.self,
        .init(
          agentId: agentId, message: message,
          images: images.isEmpty
            ? nil : images.map { ArgusProtocol.ImageAttachment(data: $0.data, mediaType: $0.mediaType) }))
      return .sent
    } catch {
      mutate(agentId) { reducer in
        reducer.conversation?.messages.removeAll { $0.id == messageId }
      }
      inflight.remove(agentId)
      trySetIdle(agentId)
      throw error
    }
  }
}
