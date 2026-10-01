import Foundation

// Mirrors the renderer's `AgentConversation` (app/stores/conversationStore.ts).
// Encodes to the same JSON the renderer publishes through `publish_agent_snapshot`
// and saves through `save_chat_history`: an absent field is omitted, a field the
// renderer sets to `null` is written as `null`.

/// A value that is present but may be JSON `null`. `Nullable<T>?` gives the
/// three states a JS property has: absent (`nil`), `null`, or a value.
public enum Nullable<Wrapped> {
  case null
  case value(Wrapped)

  public var value: Wrapped? {
    if case .value(let v) = self { return v }
    return nil
  }
}

extension Nullable: Sendable where Wrapped: Sendable {}
extension Nullable: Equatable where Wrapped: Equatable {}
extension Nullable: Hashable where Wrapped: Hashable {}

extension KeyedDecodingContainer {
  func decodeNullable<T: Decodable>(_: T.Type, forKey key: Key) throws -> Nullable<T>? {
    guard contains(key) else { return nil }
    if try decodeNil(forKey: key) { return .null }
    return .value(try decode(T.self, forKey: key))
  }

  /// A raw value where JSON `null` is kept as `.null` rather than dropped.
  func decodeRaw(forKey key: Key) throws -> JSONValue? {
    contains(key) ? try decode(JSONValue.self, forKey: key) : nil
  }
}

extension KeyedEncodingContainer {
  mutating func encodeNullable<T: Encodable>(_ value: Nullable<T>?, forKey key: Key) throws {
    switch value {
    case nil: break
    case .null?: try encodeNil(forKey: key)
    case .value(let v)?: try encode(v, forKey: key)
    }
  }
}

public struct ConversationImage: Codable, Hashable, Sendable {
  public var data: String
  public var mediaType: String

  public init(data: String, mediaType: String) {
    self.data = data
    self.mediaType = mediaType
  }

  enum CodingKeys: String, CodingKey {
    case data
    case mediaType = "media_type"
  }
}

/// Where a system message came from. Only MCP-injected prompts carry one today.
public struct ConversationMessageSource: Codable, Hashable, Sendable {
  public var kind: String
  public var tool: String
  public var parentAgentId: String?
  public var parentLabel: String?

  public init(kind: String = "mcp", tool: String, parentAgentId: String? = nil, parentLabel: String? = nil) {
    self.kind = kind
    self.tool = tool
    self.parentAgentId = parentAgentId
    self.parentLabel = parentLabel
  }
}

/// A tool result: plain text, or content blocks (text and raw base64 image blocks).
public enum ConversationToolResult: Codable, Hashable, Sendable {
  case text(String)
  case blocks([JSONValue])

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let s = try? c.decode(String.self) {
      self = .text(s)
    } else {
      self = .blocks(try c.decode([JSONValue].self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .text(let s): try c.encode(s)
    case .blocks(let b): try c.encode(b)
    }
  }
}

/// Sub-agent output nested under its Task/Agent call.
public indirect enum ConversationToolCallChild: Codable, Hashable, Sendable {
  case text(String)
  case toolUse(ConversationToolCall)

  enum CodingKeys: String, CodingKey {
    case kind, text, toolCall
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if try c.decode(String.self, forKey: .kind) == "text" {
      self = .text(try c.decode(String.self, forKey: .text))
    } else {
      self = .toolUse(try c.decode(ConversationToolCall.self, forKey: .toolCall))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .text(let t):
      try c.encode("text", forKey: .kind)
      try c.encode(t, forKey: .text)
    case .toolUse(let call):
      try c.encode("tool_use", forKey: .kind)
      try c.encode(call, forKey: .toolCall)
    }
  }
}

/// The renderer's `ToolCallInfo`. `id`/`name`/`input` are optional because a
/// sub-agent's non-text block (e.g. `thinking`) becomes a call without them.
public struct ConversationToolCall: Codable, Hashable, Sendable {
  public var children: [ConversationToolCallChild]?
  public var id: String?
  public var input: [String: JSONValue]?
  public var isError: Bool?
  public var name: String?
  public var pendingPermission: Bool?
  public var result: ConversationToolResult?

  public init(
    id: String?, name: String?, input: [String: JSONValue]?,
    children: [ConversationToolCallChild]? = nil, isError: Bool? = nil,
    pendingPermission: Bool? = nil, result: ConversationToolResult? = nil
  ) {
    self.id = id
    self.name = name
    self.input = input
    self.children = children
    self.isError = isError
    self.pendingPermission = pendingPermission
    self.result = result
  }
}

public enum ConversationRole: String, Codable, Sendable {
  case assistant, system, user
}

public struct ConversationMessage: Codable, Hashable, Sendable, Identifiable {
  /// Huddle guest who sent this user message; absent for the engineer's own.
  public var author: String?
  /// Worktree snapshot taken right before this user message was sent.
  public var checkpointId: String?
  public var id: String
  public var images: [ConversationImage]?
  /// Legacy saved-message flag the host still reads.
  public var isError: Bool?
  public var role: ConversationRole
  public var source: ConversationMessageSource?
  public var textBlocks: [String]
  public var timestamp: Double
  /// "error" for stderr, "warning" for a CLI diagnostic.
  public var tone: String?
  public var toolCalls: [ConversationToolCall]
  /// Raw usage record from the CLI, kept verbatim.
  public var usage: JSONValue?

  public init(
    id: String, role: ConversationRole, textBlocks: [String], toolCalls: [ConversationToolCall] = [],
    timestamp: Double, author: String? = nil, checkpointId: String? = nil,
    images: [ConversationImage]? = nil, isError: Bool? = nil, source: ConversationMessageSource? = nil,
    tone: String? = nil, usage: JSONValue? = nil
  ) {
    self.id = id
    self.role = role
    self.textBlocks = textBlocks
    self.toolCalls = toolCalls
    self.timestamp = timestamp
    self.author = author
    self.checkpointId = checkpointId
    self.images = images
    self.isError = isError
    self.source = source
    self.tone = tone
    self.usage = usage
  }

  enum CodingKeys: String, CodingKey {
    case author, checkpointId, id, images, isError, role, source, textBlocks, timestamp, tone,
      toolCalls, usage
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    author = try c.decodeIfPresent(String.self, forKey: .author)
    checkpointId = try c.decodeIfPresent(String.self, forKey: .checkpointId)
    id = try c.decode(String.self, forKey: .id)
    images = try c.decodeIfPresent([ConversationImage].self, forKey: .images)
    isError = try c.decodeIfPresent(Bool.self, forKey: .isError)
    role = try c.decode(ConversationRole.self, forKey: .role)
    source = try c.decodeIfPresent(ConversationMessageSource.self, forKey: .source)
    textBlocks = try c.decodeIfPresent([String].self, forKey: .textBlocks) ?? []
    timestamp = try c.decodeIfPresent(Double.self, forKey: .timestamp) ?? 0
    tone = try c.decodeIfPresent(String.self, forKey: .tone)
    toolCalls = try c.decodeIfPresent([ConversationToolCall].self, forKey: .toolCalls) ?? []
    usage = try c.decodeRaw(forKey: .usage)
  }
}

public enum ConversationTaskStatus: String, Codable, Sendable {
  case completed
  case inProgress = "in_progress"
  case pending
}

/// One entry of the Task* tool family's list.
public struct ConversationTask: Codable, Hashable, Sendable, Identifiable {
  public var activeForm: String?
  public var blockedBy: [String]?
  public var blocks: [String]?
  public var description: String?
  public var id: String
  public var metadata: JSONValue?
  public var owner: String?
  public var status: ConversationTaskStatus
  public var subject: String

  public init(
    id: String, subject: String, status: ConversationTaskStatus, description: String? = nil,
    activeForm: String? = nil, owner: String? = nil, blocks: [String]? = nil,
    blockedBy: [String]? = nil, metadata: JSONValue? = nil
  ) {
    self.id = id
    self.subject = subject
    self.status = status
    self.description = description
    self.activeForm = activeForm
    self.owner = owner
    self.blocks = blocks
    self.blockedBy = blockedBy
    self.metadata = metadata
  }
}

public struct AgentConversation: Codable, Hashable, Sendable {
  /// The initialize handshake's capabilities, verbatim.
  public var capabilities: JSONValue?
  /// Context window the CLI reported on its last `result`, in tokens.
  public var contextWindow: Double?
  /// Type of the most recent CLI event, for thinking-state derivation.
  public var lastEventType: String?
  public var messages: [ConversationMessage]
  public var model: String?
  public var pendingToolInput: JSONValue?
  public var pendingToolName: Nullable<String>?
  /// While true, events replayed by `--resume` are dropped until the first result.
  public var resuming: Bool?
  /// Claude CLI session id from `system:init`, used for `--resume`.
  public var sessionId: String?
  /// Rich commands from initialize, or `{name, description: "", argumentHint: ""}` from init.
  public var slashCommands: [JSONValue]?
  public var taskOrder: [String]?
  /// `null` once dismissed; the next Task* call repopulates it.
  public var tasks: Nullable<[String: ConversationTask]>?
  public var title: String?
  /// The latest TodoWrite list, verbatim. `null` once dismissed.
  public var todos: Nullable<[JSONValue]>?
  public var tools: [String]?
  public var totalCost: Double?
  public var totalDuration: Double?

  public init(messages: [ConversationMessage] = []) {
    self.messages = messages
  }

  /// Tasks in creation order.
  public var orderedTasks: [ConversationTask] {
    guard let tasks = tasks?.value else { return [] }
    return (taskOrder ?? []).compactMap { tasks[$0] }
  }

  enum CodingKeys: String, CodingKey {
    case capabilities, contextWindow, lastEventType, messages, model, pendingToolInput,
      pendingToolName, resuming, sessionId, slashCommands, taskOrder, tasks, title, todos, tools,
      totalCost, totalDuration
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    capabilities = try c.decodeRaw(forKey: .capabilities)
    contextWindow = try c.decodeIfPresent(Double.self, forKey: .contextWindow)
    lastEventType = try c.decodeIfPresent(String.self, forKey: .lastEventType)
    messages = try c.decodeIfPresent([ConversationMessage].self, forKey: .messages) ?? []
    model = try c.decodeIfPresent(String.self, forKey: .model)
    pendingToolInput = try c.decodeRaw(forKey: .pendingToolInput)
    pendingToolName = try c.decodeNullable(String.self, forKey: .pendingToolName)
    resuming = try c.decodeIfPresent(Bool.self, forKey: .resuming)
    sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
    slashCommands = try c.decodeIfPresent([JSONValue].self, forKey: .slashCommands)
    taskOrder = try c.decodeIfPresent([String].self, forKey: .taskOrder)
    tasks = try c.decodeNullable([String: ConversationTask].self, forKey: .tasks)
    title = try c.decodeIfPresent(String.self, forKey: .title)
    todos = try c.decodeNullable([JSONValue].self, forKey: .todos)
    tools = try c.decodeIfPresent([String].self, forKey: .tools)
    totalCost = try c.decodeIfPresent(Double.self, forKey: .totalCost)
    totalDuration = try c.decodeIfPresent(Double.self, forKey: .totalDuration)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encodeIfPresent(capabilities, forKey: .capabilities)
    try c.encodeIfPresent(contextWindow, forKey: .contextWindow)
    try c.encodeIfPresent(lastEventType, forKey: .lastEventType)
    try c.encode(messages, forKey: .messages)
    try c.encodeIfPresent(model, forKey: .model)
    try c.encodeIfPresent(pendingToolInput, forKey: .pendingToolInput)
    try c.encodeNullable(pendingToolName, forKey: .pendingToolName)
    try c.encodeIfPresent(resuming, forKey: .resuming)
    try c.encodeIfPresent(sessionId, forKey: .sessionId)
    try c.encodeIfPresent(slashCommands, forKey: .slashCommands)
    try c.encodeIfPresent(taskOrder, forKey: .taskOrder)
    try c.encodeNullable(tasks, forKey: .tasks)
    try c.encodeIfPresent(title, forKey: .title)
    try c.encodeNullable(todos, forKey: .todos)
    try c.encodeIfPresent(tools, forKey: .tools)
    try c.encodeIfPresent(totalCost, forKey: .totalCost)
    try c.encodeIfPresent(totalDuration, forKey: .totalDuration)
  }
}
