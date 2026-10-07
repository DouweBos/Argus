import ArgusKit
import Foundation

/// Snapshot publishing, chat-history saves, hydration and titles — the
/// renderer's `saveAgentConversation`, `hydrateFromSnapshot` and
/// `maybeGenerateTitle`.
extension LiveAgents {

  // MARK: Saving

  /// Debounced save, so a burst of events is one write. Writing through on
  /// every exchange means a crash loses at most the turn in flight.
  func scheduleSave(_ agentId: String) {
    saveTimers[agentId]?.cancel()
    let delay = timing.saveDebounce
    saveTimers[agentId] = Task { @MainActor [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled, let self else { return }
      self.saveTimers[agentId] = nil
      await self.save(agentId)
    }
  }

  /// Save now without waiting for it.
  func saveSoon(_ agentId: String) {
    saveTimers.removeValue(forKey: agentId)?.cancel()
    Task { @MainActor [weak self] in await self?.save(agentId) }
  }

  /// Save every conversation. Call before quitting, and await it.
  public func saveAll() async {
    for agentId in Array(conversations.keys) { await save(agentId) }
  }

  /// Publish the snapshot other clients read (`agents.transcript`, MCP
  /// `read_agent_transcript`), then upsert the chat history. History needs a
  /// CLI session id, which arrives with `system:init`; the exit and quit
  /// saves catch anything that ends before then.
  ///
  /// A long chat is megabytes of JSON, so it's encoded off the main actor.
  func save(_ agentId: String) async {
    saveTimers.removeValue(forKey: agentId)?.cancel()
    guard let backend, let conv = conversations[agentId] else { return }
    let generation = (saveGenerations[agentId] ?? 0) + 1
    saveGenerations[agentId] = generation
    let agent = agents[agentId]
    let session = agent.flatMap { sessions[$0.sessionId] }
    let environment = environment

    let (snapshot, saved) = await Task.detached(priority: .utility) {
      let snapshot = (try? JSONEncoder().encode(conv)).flatMap { String(data: $0, encoding: .utf8) }
      let saved = agent.flatMap { agent in
        session.flatMap {
          Self.savedConversation(agentId, conv: conv, agent: agent, session: $0, environment: environment)
        }
      }
      return (snapshot, saved)
    }.value
    // A later save holds newer state; publishing this one after it would undo it.
    guard saveGenerations[agentId] == generation else { return }

    if let snapshot {
      _ = try? await backend.request(
        ArgusProtocol.Commands.PublishAgentSnapshot.self, .init(agentId: agentId, snapshot: snapshot))
    }
    guard let saved, let repoRoot = session?.repoRoot else { return }
    _ = try? await backend.request(
      ArgusProtocol.Commands.SaveChatHistory.self,
      .init(repoRoot: repoRoot, conversation: saved))
  }

  /// The renderer's `SavedConversation`, or nil when there is nothing to save yet.
  nonisolated static func savedConversation(
    _ agentId: String, conv: AgentConversation, agent: LiveAgent, session: LiveSession,
    environment: ConversationEnvironment
  ) -> ArgusProtocol.SavedConversation? {
    guard !conv.messages.isEmpty, let sessionId = conv.sessionId,
      let messages = try? JSONDecoder().decode(
        [JSONValue].self, from: JSONEncoder().encode(conv.messages))
    else { return nil }
    let now = environment.now()
    return ArgusProtocol.SavedConversation(
      agentId: agentId, argusSessionId: agent.sessionId,
      createdAt: conv.messages.first?.timestamp ?? now, endedAt: now, id: environment.makeId(),
      messageCount: Double(conv.messages.count), model: conv.model,
      parentAgentId: agent.parentAgentId, runnerId: agent.runnerId,
      sessionBranch: session.branch, sessionDescription: session.description,
      sessionId: sessionId, title: conv.title ?? Self.deriveTitle(conv.messages),
      totalCost: conv.totalCost, totalDuration: conv.totalDuration, messages: messages)
  }

  /// `deriveTitle` from `chatHistory.ts`.
  nonisolated static func deriveTitle(_ messages: [ConversationMessage]) -> String {
    guard let text = messages.first(where: { $0.role == .user })?.textBlocks.first else {
      return "Untitled conversation"
    }
    // JS string length counts UTF-16 units.
    let units = Array(text.utf16)
    guard units.count > 80 else { return text }
    return (String(utf16CodeUnits: Array(units.prefix(77)), count: 77)) + "..."
  }

  // MARK: Hydration

  /// A saved chat's messages, as the transcript reads them. Megabytes for a
  /// long chat — call it off the main actor, or through `decodeMessages`.
  public nonisolated static func messages(of saved: ArgusProtocol.SavedConversation) -> [ConversationMessage] {
    guard let data = try? JSONEncoder().encode(saved.messages) else { return [] }
    return (try? JSONDecoder().decode([ConversationMessage].self, from: data)) ?? []
  }

  /// `messages(of:)` on a background thread.
  public nonisolated static func decodeMessages(of saved: ArgusProtocol.SavedConversation) async
    -> [ConversationMessage]
  {
    await Task.detached(priority: .userInitiated) { messages(of: saved) }.value
  }

  /// A resumed chat starts with its saved transcript — the renderer's
  /// `loadSavedMessages(…, resuming: true)` — published so other clients see it.
  public func restore(_ agentId: String, from saved: ArgusProtocol.SavedConversation) async {
    let messages = await Self.decodeMessages(of: saved)
    guard !messages.isEmpty, conversations[agentId]?.messages.isEmpty ?? true else { return }
    mutate(agentId) {
      $0.loadSavedMessages(
        messages, model: saved.model, sessionId: saved.sessionId, resuming: true, title: saved.title)
    }
    await save(agentId)
  }

  /// Seed an agent's transcript from the snapshot the host holds for it — the
  /// conversation a resume spawn carries, or what this app published before a
  /// reconnect. Never overwrites a chat already under way.
  func hydrateFromSnapshot(_ agentId: String) async {
    guard conversations[agentId]?.messages.isEmpty ?? true, let backend,
      let raw = (try? await backend.request(
        ArgusProtocol.Commands.GetAgentSnapshot.self, .init(agentId: agentId))) ?? nil,
      let conv = await Task.detached(priority: .userInitiated, operation: {
        try? JSONDecoder().decode(AgentConversation.self, from: Data(raw.utf8))
      }).value,
      !conv.messages.isEmpty,
      conversations[agentId]?.messages.isEmpty ?? true
    else { return }
    mutate(agentId) {
      $0.loadSavedMessages(
        conv.messages, model: conv.model, sessionId: conv.sessionId, resuming: conv.resuming,
        title: conv.title)
    }
  }

  // MARK: Titles

  /// Ask the host for a title once per agent, from its first message.
  func maybeGenerateTitle(_ agentId: String, firstMessage: String) {
    guard !titleRequested.contains(agentId) else { return }
    // A resumed conversation already carries one.
    if conversations[agentId]?.title != nil {
      titleRequested.insert(agentId)
      return
    }
    let text = firstMessage.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, let backend else { return }
    titleRequested.insert(agentId)
    Task { @MainActor [weak self] in
      do {
        let title = try await backend.request(
          ArgusProtocol.Commands.GenerateSessionTitle.self, .init(firstMessage: text))
        // A prompted spawn can be titled before its first event arrives.
        guard let self, let title, !title.isEmpty, self.conversations[agentId]?.title == nil
        else { return }
        self.mutate(agentId) { reducer in
          if reducer.conversation == nil { reducer.conversation = AgentConversation() }
          reducer.setTitle(title)
        }
        // The host reads titles off the snapshot.
        self.scheduleSave(agentId)
      } catch {
        // Let the next message try again.
        self?.titleRequested.remove(agentId)
      }
    }
  }
}
