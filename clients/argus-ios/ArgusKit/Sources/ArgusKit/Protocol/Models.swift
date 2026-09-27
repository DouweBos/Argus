import Foundation

/// Monitor-scoped mirrors of desktop data, ported from
/// `packages/remote-protocol/src/models.ts` — the authoritative schema.
///
/// Wire keys are snake_case except where the desktop's own camelCase leaked
/// through (`displayName`, `activeForm`, `argumentHint`, …), so every type
/// spells its `CodingKeys` out rather than relying on a blanket strategy.

// MARK: - Projects, sessions, agents

public struct RemoteProject: Codable, Hashable, Sendable, Identifiable {
  public var repoRoot: String
  public var name: String
  public var accent: String?

  public var id: String { repoRoot }

  enum CodingKeys: String, CodingKey {
    case repoRoot = "repo_root"
    case name, accent
  }
}

public enum RemoteSessionKind: String, Codable, Sendable {
  case automationHost = "automation_host"
  case projectRoot = "project_root"
  case worktree
}

public enum RemoteSessionStatus: String, Codable, Sendable {
  case deleting, initializing, ready, error
}

public struct RemoteSession: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var repoRoot: String
  public var kind: RemoteSessionKind
  public var branch: String
  public var displayName: String?
  /// The branch a merge lands on. Nil on older computers.
  public var baseBranch: String?
  public var status: RemoteSessionStatus
  /// Whether the computer can currently reach this session's files. Separate
  /// from `status` — the usual cause is an external drive unplugged from the
  /// computer, which the phone can only report, not fix. Absent on older
  /// computers, which is why it defaults to available.
  public var availability: RemoteSessionAvailability?
  /// The drive to reconnect, by name.
  public var unavailableVolume: String?

  public var isUnavailable: Bool { availability == .unavailable }

  enum CodingKeys: String, CodingKey {
    case id
    case repoRoot = "repo_root"
    case kind, branch
    case displayName = "display_name"
    case baseBranch = "base_branch"
    case status, availability
    case unavailableVolume = "unavailable_volume"
  }
}

public enum RemoteSessionAvailability: String, Codable, Sendable {
  case available, unavailable
}

public enum RemoteAgentState: String, Codable, Sendable {
  case error, idle, running, stopped
  case requiresAction = "requires_action"
}

/// What an agent is blocked on the user for, derived host-side so a client can
/// flag it without holding the transcript.
public enum RemoteAwaiting: String, Codable, Sendable {
  case permission, question, plan
}

public struct RemoteAgentStatus: Codable, Hashable, Sendable, Identifiable {
  public var agentId: String
  public var sessionId: String
  public var sessionLabel: String?
  public var projectName: String?
  public var title: String?
  public var status: RemoteAgentState
  public var model: String?
  /// Context window the CLI last reported, in tokens.
  public var contextWindow: Int?
  public var permissionMode: String?
  public var parentAgentId: String?
  public var createdAt: Double?
  public var lastActivityAt: Double?
  public var awaiting: RemoteAwaiting?

  public var id: String { agentId }

  enum CodingKeys: String, CodingKey {
    case agentId = "agent_id"
    case sessionId = "session_id"
    case sessionLabel = "session_label"
    case projectName = "project_name"
    case title, status, model
    case contextWindow = "context_window"
    case permissionMode = "permission_mode"
    case parentAgentId = "parent_agent_id"
    case createdAt = "created_at"
    case lastActivityAt = "last_activity_at"
    case awaiting
  }
}

/// A finished conversation from the project's saved chat history. Addressed by
/// `historyId` rather than an agent id — the agent process is long gone.
public struct RemoteStoppedAgent: Codable, Hashable, Sendable, Identifiable {
  public var historyId: String
  public var runnerSessionId: String
  public var title: String
  public var branch: String
  public var description: String?
  public var model: String?
  public var messageCount: Int
  public var startedAt: Double
  public var endedAt: Double

  public var id: String { historyId }

  enum CodingKeys: String, CodingKey {
    case historyId = "history_id"
    case runnerSessionId = "runner_session_id"
    case title, branch, description, model
    case messageCount = "message_count"
    case startedAt = "started_at"
    case endedAt = "ended_at"
  }
}

// MARK: - Transcript

public struct RemoteImageAttachment: Codable, Hashable, Sendable {
  /// Base64, with no data-URL prefix.
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

public struct RemoteImageRef: Codable, Hashable, Sendable {
  public var imageId: String
  public var mediaType: String

  public init(imageId: String, mediaType: String) {
    self.imageId = imageId
    self.mediaType = mediaType
  }

  enum CodingKeys: String, CodingKey {
    case imageId = "image_id"
    case mediaType = "media_type"
  }
}

public enum RemoteToolResultBlock: Codable, Hashable, Sendable {
  case text(String)
  case image(imageId: String, mediaType: String)

  enum CodingKeys: String, CodingKey {
    case type, text
    case imageId = "image_id"
    case mediaType = "media_type"
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .type) {
    case "text":
      self = .text(try c.decode(String.self, forKey: .text))
    case "image":
      self = .image(
        imageId: try c.decode(String.self, forKey: .imageId),
        mediaType: try c.decode(String.self, forKey: .mediaType))
    case let other:
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: c, debugDescription: "unknown result block \(other)")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .text(let t):
      try c.encode("text", forKey: .type)
      try c.encode(t, forKey: .text)
    case .image(let id, let mt):
      try c.encode("image", forKey: .type)
      try c.encode(id, forKey: .imageId)
      try c.encode(mt, forKey: .mediaType)
    }
  }
}

public enum RemoteToolStatus: String, Codable, Sendable {
  case done, error, pending, running
}

/// Sub-agent output nested under a Task/Agent tool call.
public indirect enum RemoteToolCallChild: Codable, Hashable, Sendable {
  case text(String)
  case toolUse(RemoteToolCall)

  enum CodingKeys: String, CodingKey {
    case kind, text
    case toolCall = "tool_call"
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "text":
      self = .text(try c.decode(String.self, forKey: .text))
    case "tool_use":
      self = .toolUse(try c.decode(RemoteToolCall.self, forKey: .toolCall))
    case let other:
      throw DecodingError.dataCorruptedError(
        forKey: .kind, in: c, debugDescription: "unknown child \(other)")
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

public struct RemoteToolCall: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var name: String
  public var input: [String: JSONValue]
  public var resultBlocks: [RemoteToolResultBlock]
  public var children: [RemoteToolCallChild]?
  public var pendingPermission: Bool?
  public var isError: Bool?
  public var status: RemoteToolStatus

  enum CodingKeys: String, CodingKey {
    case id, name, input, children, status
    case resultBlocks = "result_blocks"
    case pendingPermission = "pending_permission"
    case isError = "is_error"
  }
}

public struct RemoteMessageSource: Codable, Hashable, Sendable {
  public var kind: String
  public var tool: String
  public var parentAgentId: String?
  public var parentLabel: String?

  enum CodingKeys: String, CodingKey {
    case kind, tool
    case parentAgentId = "parent_agent_id"
    case parentLabel = "parent_label"
  }
}

public struct RemoteTokenUsage: Codable, Hashable, Sendable {
  public var inputTokens: Int
  public var outputTokens: Int
  public var cacheReadInputTokens: Int?
  public var cacheCreationInputTokens: Int?

  enum CodingKeys: String, CodingKey {
    case inputTokens = "input_tokens"
    case outputTokens = "output_tokens"
    case cacheReadInputTokens = "cache_read_input_tokens"
    case cacheCreationInputTokens = "cache_creation_input_tokens"
  }
}

public enum RemoteMessageRole: String, Codable, Sendable {
  case assistant, system, user
}

public struct RemoteMessage: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var role: RemoteMessageRole
  public var textBlocks: [String]
  public var toolCalls: [RemoteToolCall]
  public var images: [RemoteImageRef]?
  public var source: RemoteMessageSource?
  public var author: String?
  public var isError: Bool?
  public var timestamp: Double?
  public var usage: RemoteTokenUsage?

  public init(
    id: String,
    role: RemoteMessageRole,
    textBlocks: [String],
    toolCalls: [RemoteToolCall] = [],
    images: [RemoteImageRef]? = nil,
    source: RemoteMessageSource? = nil,
    author: String? = nil,
    isError: Bool? = nil,
    timestamp: Double? = nil,
    usage: RemoteTokenUsage? = nil
  ) {
    self.id = id
    self.role = role
    self.textBlocks = textBlocks
    self.toolCalls = toolCalls
    self.images = images
    self.source = source
    self.author = author
    self.isError = isError
    self.timestamp = timestamp
    self.usage = usage
  }

  enum CodingKeys: String, CodingKey {
    case id, role, images, source, author, timestamp, usage
    case textBlocks = "text_blocks"
    case toolCalls = "tool_calls"
    case isError = "is_error"
  }
}

public enum RemoteTaskStatus: String, Codable, Sendable {
  case completed
  case inProgress = "in_progress"
  case pending
}

public struct RemoteTask: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var subject: String
  public var status: RemoteTaskStatus
  public var description: String?
  /// Wire key is camelCase — the desktop's own naming leaked into the mirror.
  public var activeForm: String?
  public var owner: String?
  public var blocks: [String]?
  public var blockedBy: [String]?
}

public struct RemoteTodo: Codable, Hashable, Sendable {
  public var content: String
  public var status: RemoteTaskStatus
  public var activeForm: String?
}

/// A message waiting for a busy agent's turn to end. The queue lives on the
/// computer, so it survives reinstalling the app and is shared with the desktop.
public struct RemoteQueuedMessage: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var text: String
  public var displayText: String?
  public var author: String?
  public var images: [RemoteImageAttachment]?
  public var queuedAt: Double

  enum CodingKeys: String, CodingKey {
    case id, text, author, images
    case displayText = "display_text"
    case queuedAt = "queued_at"
  }
}

public struct RemoteTranscript: Codable, Sendable {
  public init(
    messages: [RemoteMessage], nextAfter: Double?, prevBefore: Double?, total: Int?,
    tasks: [RemoteTask]?, todos: [RemoteTodo]?, model: String?, pendingToolName: String?
  ) {
    self.messages = messages
    self.nextAfter = nextAfter
    self.prevBefore = prevBefore
    self.total = total
    self.tasks = tasks
    self.todos = todos
    self.model = model
    self.pendingToolName = pendingToolName
  }

  public var messages: [RemoteMessage]
  public var nextAfter: Double?
  public var prevBefore: Double?
  public var total: Int?
  public var tasks: [RemoteTask]?
  public var todos: [RemoteTodo]?
  public var model: String?
  public var pendingToolName: String?

  enum CodingKeys: String, CodingKey {
    case messages, total, tasks, todos, model
    case nextAfter = "next_after"
    case prevBefore = "prev_before"
    case pendingToolName = "pending_tool_name"
  }
}

public struct RemoteImageData: Codable, Sendable {
  public var data: String
  public var mediaType: String

  enum CodingKeys: String, CodingKey {
    case data
    case mediaType = "media_type"
  }

  /// The form the UI caches and renders.
  public var dataURI: String { "data:\(mediaType);base64,\(data)" }
}

// MARK: - Permissions

public struct RemotePermissionRequest: Codable, Hashable, Sendable {
  public var agentId: String
  public var toolUseId: String
  public var toolName: String
  public var toolInput: [String: JSONValue]

  enum CodingKeys: String, CodingKey {
    case agentId = "agent_id"
    case toolUseId = "tool_use_id"
    case toolName = "tool_name"
    case toolInput = "tool_input"
  }
}

public struct RemotePermissionCancel: Codable, Hashable, Sendable {
  public var agentId: String
  public var toolUseId: String

  enum CodingKeys: String, CodingKey {
    case agentId = "agent_id"
    case toolUseId = "tool_use_id"
  }
}

// MARK: - Devices

public enum RemotePlatform: String, Codable, Sendable {
  case ios, android
}

public struct RemoteDevice: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var platform: RemotePlatform
  public var name: String
  public var runtime: String?
  public var booted: Bool
  /// TV form factor (Apple TV / Android TV) — driven by the dpad, not touch.
  public var isTv: Bool
  public var capturing: Bool
  public var width: Int?
  public var height: Int?

  enum CodingKeys: String, CodingKey {
    case id, platform, name, runtime, booted, capturing, width, height
    case isTv = "is_tv"
  }
}

/// Who is driving a device. The paired phone or Mac holding it, not the
/// simulator being held.
public struct RemoteDeviceClaim: Codable, Hashable, Sendable {
  public var connectionId: String
  public var deviceId: String
  public var label: String

  enum CodingKeys: String, CodingKey {
    case connectionId = "connection_id"
    case deviceId = "device_id"
    case label
  }
}

/// A claim as the host publishes it: who holds the device, and who has been
/// tapping at a picture that isn't answering them.
public struct RemoteDeviceClaimState: Codable, Hashable, Sendable {
  public var deviceId: String
  public var holder: RemoteDeviceClaim?
  public var waiting: [RemoteDeviceClaim]

  public init(deviceId: String, holder: RemoteDeviceClaim?, waiting: [RemoteDeviceClaim] = []) {
    self.deviceId = deviceId
    self.holder = holder
    self.waiting = waiting
  }

  enum CodingKeys: String, CodingKey {
    case deviceId = "device_id"
    case holder, waiting
  }
}

/// Named hinge poses, matching conductor's vocabulary.
public enum RemoteFoldPose: String, Codable, Sendable {
  case book, closed, open, partial
}

public enum RemoteDeviceOrientation: String, Codable, Sendable, CaseIterable {
  case portrait
  case landscapeLeft
  case landscapeRight
  case portraitUpsideDown

  /// The order the rotate button walks, matching the desktop's.
  public var next: RemoteDeviceOrientation {
    switch self {
    case .portrait: .landscapeLeft
    case .landscapeLeft: .portraitUpsideDown
    case .portraitUpsideDown: .landscapeRight
    case .landscapeRight: .portrait
    }
  }
}

public struct RemoteFoldState: Codable, Hashable, Sendable {
  /// Hinge angle in degrees: 0 is shut, 180 is flat open.
  public var angle: Double
  public var pose: RemoteFoldPose
}

public struct RemoteDisplayInfo: Codable, Hashable, Sendable {
  public var width: Int
  public var height: Int
  /// Clockwise degrees the client must rotate the stream by to sit upright.
  public var rotation: Int
  public var screenId: Int

  enum CodingKeys: String, CodingKey {
    case width, height, rotation
    case screenId = "screen_id"
  }
}

/// How the device is being held. The framebuffer is panel-native, so a rotated
/// device arrives sideways and a folded Duo lights a different panel.
public struct RemoteDeviceState: Codable, Hashable, Sendable {
  public var deviceId: String
  public var fold: RemoteFoldState?
  public var orientation: RemoteDeviceOrientation
  public var display: RemoteDisplayInfo?

  enum CodingKeys: String, CodingKey {
    case fold, orientation, display
    case deviceId = "device_id"
  }
}

// MARK: - Agent capabilities

public struct RemoteModelInfo: Codable, Hashable, Sendable, Identifiable {
  public var value: String
  public var displayName: String
  public var description: String
  public var supportsEffort: Bool?
  public var supportedEffortLevels: [String]?
  public var supportsFastMode: Bool?

  public var id: String { value }
}

public struct RemoteSlashCommand: Codable, Hashable, Sendable, Identifiable {
  public var name: String
  public var description: String
  public var argumentHint: String

  public var id: String { name }
}

public struct RemoteSubagentType: Codable, Hashable, Sendable, Identifiable {
  public var name: String
  public var description: String
  public var model: String?

  public var id: String { name }
}

public struct RemoteAgentCapabilities: Codable, Hashable, Sendable {
  public var models: [RemoteModelInfo]
  public var commands: [RemoteSlashCommand]
  public var agents: [RemoteSubagentType]

  public static let empty = RemoteAgentCapabilities(models: [], commands: [], agents: [])
}

/// Only these four reach the wire — `trusted` (bypassPermissions) is excluded
/// at the schema level on the host and re-checked there, so offering it here
/// would only produce a refusal.
public enum RemotePermissionMode: String, Codable, Sendable, CaseIterable {
  case auto, ask, plan, review

  public var label: String {
    switch self {
    case .auto: "Auto"
    case .ask: "Ask"
    case .plan: "Plan"
    case .review: "Review"
    }
  }
}

public struct RemoteMentionEntry: Codable, Hashable, Sendable, Identifiable {
  public var name: String
  public var isDir: Bool

  public var id: String { name }

  enum CodingKeys: String, CodingKey {
    case name
    case isDir = "is_dir"
  }
}

public struct RemoteMentionPathResult: Codable, Sendable {
  public var entries: [RemoteMentionEntry]
  public var resolvedPath: String

  enum CodingKeys: String, CodingKey {
    case entries
    case resolvedPath = "resolved_path"
  }
}

// MARK: - Git

public struct RemoteGitInProgress: Codable, Hashable, Sendable {
  public var kind: String
  public var head: String
  public var onto: String?
}

public struct RemoteGitStatus: Codable, Hashable, Sendable {
  public var branch: String
  public var upstream: String?
  public var ahead: Int
  public var behind: Int
  public var dirtyCount: Int
  public var stashCount: Int
  public var conflictCount: Int
  public var detached: Bool
  public var lastFetchAt: Double?
  public var inProgress: RemoteGitInProgress?
  public var diffAdditions: Int?
  public var diffDeletions: Int?

  enum CodingKeys: String, CodingKey {
    case branch, upstream, ahead, behind, detached
    case dirtyCount = "dirty_count"
    case stashCount = "stash_count"
    case conflictCount = "conflict_count"
    case lastFetchAt = "last_fetch_at"
    case inProgress = "in_progress"
    case diffAdditions = "diff_additions"
    case diffDeletions = "diff_deletions"
  }
}

public struct RemoteGitBranch: Codable, Hashable, Sendable, Identifiable {
  public var name: String
  public var scope: Scope
  public var remote: String?
  public var isCurrent: Bool
  public var upstream: String?
  public var ahead: Int
  public var behind: Int
  public var lastCommitSubject: String?
  public var lastCommitAt: Double?

  public enum Scope: String, Codable, Sendable {
    case local, remote
  }

  public var id: String { "\(scope.rawValue):\(name)" }

  enum CodingKeys: String, CodingKey {
    case name, scope, remote, upstream, ahead, behind
    case isCurrent = "is_current"
    case lastCommitSubject = "last_commit_subject"
    case lastCommitAt = "last_commit_at"
  }
}

// MARK: - Endpoints

public struct RemoteEndpoint: Codable, Hashable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case lan, tailscale, cloudflare

    /// Lower is simpler; probed in this order.
    public var priority: Int {
      switch self {
      case .lan: 0
      case .tailscale: 1
      case .cloudflare: 2
      }
    }

    public var label: String {
      switch self {
      case .lan: "Local network"
      case .tailscale: "Tailscale"
      case .cloudflare: "Cloudflare tunnel"
      }
    }
  }

  public var kind: Kind
  public var url: String
  public var priority: Int

  public init(kind: Kind, url: String, priority: Int) {
    self.kind = kind
    self.url = url
    self.priority = priority
  }
}

// MARK: - Notifications

public struct RemoteNotificationAction: Codable, Hashable, Sendable {
  public var id: String
  public var title: String

  public init(id: String, title: String) {
    self.id = id
    self.title = title
  }
}

public struct RemoteNotification: Codable, Hashable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case failed, finished, permission, push
  }

  public var agentId: String?
  public var sessionId: String?
  /// The prompt an action answers; only set for `kind: .permission`.
  public var toolUseId: String?
  public var kind: Kind
  public var title: String
  public var body: String
  public var actions: [RemoteNotificationAction]

  public init(
    agentId: String?, sessionId: String?, toolUseId: String?,
    kind: Kind, title: String, body: String, actions: [RemoteNotificationAction]
  ) {
    self.agentId = agentId
    self.sessionId = sessionId
    self.toolUseId = toolUseId
    self.kind = kind
    self.title = title
    self.body = body
    self.actions = actions
  }

  enum CodingKeys: String, CodingKey {
    case kind, title, body, actions
    case agentId = "agent_id"
    case sessionId = "session_id"
    case toolUseId = "tool_use_id"
  }

  /// What this notification replaces, or nil to let it stack. Mirrors
  /// `collapseSubject` on the desktop: turn results supersede per agent,
  /// pending approvals are distinct decisions, MCP pushes never replace.
  public var collapseIdentifier: String? {
    switch kind {
    case .finished, .failed: agentId.map { "agent-\($0)" }
    case .permission: toolUseId.map { "prompt-\($0)" }
    case .push: nil
    }
  }
}

// MARK: - Claude accounts

/// A signed-in Claude account on the computer, and which of its two problems is
/// currently blocking it. `rateLimited` and `needsReauth` are deliberately not
/// one flag: a spent quota has healthy credentials and fixes itself, an expired
/// sign-in needs the user to sign in again.
public struct RemoteClaudeAccount: Codable, Hashable, Sendable, Identifiable {
  public enum AccountType: String, Codable, Sendable {
    case claudeai, console
  }

  public var id: String
  public var label: String?
  public var email: String?
  public var orgName: String?
  public var subscriptionType: String?
  public var needsReauth: Bool
  public var rateLimited: Bool
  public var accountType: AccountType

  /// What the list shows as its primary line.
  public var displayName: String { label ?? email ?? id }

  /// "Max · Acme" — the plan and org, whichever are known.
  public var subtitle: String {
    [subscriptionType, orgName]
      .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
      .joined(separator: " · ")
  }

  enum CodingKeys: String, CodingKey {
    case id, label, email
    case orgName = "org_name"
    case subscriptionType = "subscription_type"
    case needsReauth = "needs_reauth"
    case rateLimited = "rate_limited"
    case accountType = "account_type"
  }
}

/// Where an interactive sign-in has got to. The browser opens on the computer,
/// so a phone can only finish over the paste-a-code path — `needsCode` is what
/// tells it that path is the one available.
public struct RemoteClaudeLoginState: Codable, Hashable, Sendable {
  public var pending: Bool
  public var needsCode: Bool
  /// Set once the attempt is over: how it ended.
  public var ok: Bool?
  public var error: String?

  public init(
    pending: Bool, needsCode: Bool, ok: Bool? = nil, error: String? = nil
  ) {
    self.pending = pending
    self.needsCode = needsCode
    self.ok = ok
    self.error = error
  }

  enum CodingKeys: String, CodingKey {
    case pending, ok, error
    case needsCode = "needs_code"
  }
}
