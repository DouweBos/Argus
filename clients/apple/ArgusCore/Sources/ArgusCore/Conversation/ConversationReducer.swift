import Foundation

/// Clock and id source, injectable so a replay is deterministic. The renderer
/// uses `Date.now()` and `crypto.randomUUID()`.
public struct ConversationEnvironment: Sendable {
  public var now: @Sendable () -> Double
  public var makeId: @Sendable () -> String

  public init(now: @escaping @Sendable () -> Double, makeId: @escaping @Sendable () -> String) {
    self.now = now
    self.makeId = makeId
  }

  public static let live = ConversationEnvironment(
    now: { (Date().timeIntervalSince1970 * 1000).rounded(.down) },
    makeId: { UUID().uuidString.lowercased() })
}

/// One agent's slot in the renderer's conversation store: folds the host's
/// `agent:*` events into an `AgentConversation`. `conversation` is nil until
/// something creates it, as an agent missing from the store's map.
///
/// Ports the transcript half of `conversationStore`; drafts, pending images,
/// linked projects, tool drafts and unread tracking are UI state and stay out.
public struct ConversationReducer: Sendable {
  public internal(set) var conversation: AgentConversation?
  public var environment: ConversationEnvironment

  public init(conversation: AgentConversation? = nil, environment: ConversationEnvironment = .live) {
    self.conversation = conversation
    self.environment = environment
  }

  var existing: AgentConversation { conversation ?? AgentConversation() }

  // MARK: Messages

  /// A message typed (or queued, or sent from a remote client) by the user.
  public mutating func addUserMessage(
    _ text: String, images: [ConversationImage]? = nil, checkpointId: String? = nil,
    author: String? = nil
  ) {
    var conv = existing
    let msg = ConversationMessage(
      id: environment.makeId(), role: .user, textBlocks: [text], timestamp: environment.now(),
      author: author, checkpointId: checkpointId,
      images: (images?.isEmpty ?? true) ? nil : images)
    conv.resuming = false
    conv.lastEventType = "user_sent"
    conv.messages.append(msg)
    conversation = conv
  }

  /// stderr lines and CLI diagnostics.
  public mutating func appendSystemMessage(_ msg: ConversationMessage) {
    var conv = existing
    conv.messages.append(msg)
    conversation = conv
  }

  /// A prompt sent on the agent's behalf (spawn_agent, send_agent_message). It
  /// starts a new turn, so nothing after it is a `--resume` replay.
  public mutating func appendInjectedPrompt(_ msg: ConversationMessage) {
    var conv = existing
    conv.resuming = false
    conv.messages.append(msg)
    conversation = conv
  }

  /// Replaces the conversation with saved history, re-deriving todos and tasks.
  public mutating func loadSavedMessages(
    _ messages: [ConversationMessage], model: String? = nil, sessionId: String? = nil,
    resuming: Bool? = nil, title: String? = nil
  ) {
    var conv = AgentConversation(messages: messages)
    conv.model = model
    conv.sessionId = sessionId
    conv.resuming = resuming
    conv.title = title
    conv.todos = ConversationTasks.latestTodos(in: messages).map { .value($0) } ?? .null
    let tasks = ConversationTasks.extract(from: messages)
    conv.tasks = tasks.map { .value($0.tasks) } ?? .null
    conv.taskOrder = tasks?.order
    conversation = conv
  }

  /// The agent was respawned under a new id with this conversation
  /// (`migrateConversation`): drop the CLI's replay until the next result.
  public mutating func markResuming() {
    conversation?.resuming = true
  }

  public mutating func clear() {
    conversation = nil
  }

  // MARK: Metadata

  public mutating func setModel(_ model: String) {
    var conv = existing
    conv.model = model
    conversation = conv
  }

  /// The initialize handshake's capabilities, as the host emits them.
  public mutating func setCapabilities(_ capabilities: JSONValue) {
    var conv = existing
    conv.capabilities = capabilities
    conv.slashCommands = capabilities["commands"]?.arrayValue
    conversation = conv
  }

  public mutating func setTitle(_ title: String) {
    conversation?.title = title
  }

  public mutating func clearTasks() {
    guard conversation != nil else { return }
    conversation?.tasks = .null
    conversation?.taskOrder = nil
  }

  public mutating func clearTodos() {
    conversation?.todos = .null
  }

  // MARK: Permissions

  /// Marks the (possibly nested) tool call as awaiting permission. Returns
  /// false when the call isn't folded in yet — the renderer retries for ~1s.
  @discardableResult
  public mutating func setPermissionPending(toolUseId: String) -> Bool {
    setPendingPermission(toolUseId, true)
  }

  /// `agent:permission-resolved`.
  public mutating func clearPermission(toolUseId: String) {
    setPendingPermission(toolUseId, false)
  }

  /// `agent:permission-cancel`: the CLI withdrew the request.
  public mutating func cancelPermission(toolUseId: String) {
    setPendingPermission(toolUseId, false)
  }

  @discardableResult
  private mutating func setPendingPermission(_ toolUseId: String, _ pending: Bool) -> Bool {
    guard var conv = conversation,
      let messages = ToolCallTree.update(in: conv.messages, id: toolUseId, { tc in
        var next = tc
        next.pendingPermission = pending
        return next
      })
    else { return false }
    conv.messages = messages
    conversation = conv
    return true
  }

  // MARK: Snapshot

  /// The JSON `publish_agent_snapshot` carries.
  public func snapshotJSON() throws -> Data {
    try JSONEncoder().encode(conversation)
  }
}

extension ConversationMessage {
  /// The system message `agent:mcp-message` becomes.
  public static func injectedPrompt(
    _ message: String, tool: String, images: [ConversationImage]? = nil,
    parentAgentId: String? = nil, parentLabel: String? = nil, timestamp: Double? = nil,
    environment: ConversationEnvironment = .live
  ) -> ConversationMessage {
    ConversationMessage(
      id: environment.makeId(), role: .system, textBlocks: [message],
      timestamp: timestamp ?? environment.now(),
      images: (images?.isEmpty ?? true) ? nil : images,
      source: ConversationMessageSource(
        tool: tool, parentAgentId: parentAgentId, parentLabel: parentLabel))
  }
}
