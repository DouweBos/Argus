import Foundation

/// Automations, their runs and the reports they write. Ported from
/// `packages/remote-protocol/src/{models,report}.ts`.
///
/// The list shape stays small; `RemoteAutomationDetail` carries the playbook,
/// guardrails and sources, and is only fetched for the one being edited.

public enum RemoteAutonomy: String, Codable, Sendable, CaseIterable {
  case autoMerge = "auto_merge"
  case draft, pr, propose

  /// Weakest first, the order the desktop ladder reads in.
  public static let allRungs: [RemoteAutonomy] = [.propose, .draft, .pr, .autoMerge]

  /// What picking this rung lets a run do.
  public var caption: String {
    switch self {
    case .propose: "Write a proposal into the inbox; touch nothing."
    case .draft: "Create the worktree, implement, commit — then stop."
    case .pr: "Draft, then push and open a draft PR."
    case .autoMerge: "PR, then merge once CI is green."
    }
  }

  public var label: String {
    switch self {
    case .autoMerge: "Auto-merge"
    case .draft: "Draft"
    case .pr: "Pull request"
    case .propose: "Propose"
    }
  }
}

public struct RemoteAutomation: Codable, Hashable, Sendable, Identifiable {
  public enum TriggerKind: String, Codable, Sendable {
    case manual, schedule
  }

  public var id: String
  public var name: String
  public var description: String
  public var enabled: Bool
  public var triggerKind: TriggerKind
  /// 5-field cron and its IANA zone — only for `.schedule`.
  public var cron: String?
  public var timezone: String?
  /// Null means it inherits the computer's default rung.
  public var autonomy: RemoteAutonomy?
  /// Project names, not paths — a path means nothing on a phone.
  public var projects: [String]
  public var lastRunAt: Double?
  public var nextRunAt: Double?
  public var running: Bool

  enum CodingKeys: String, CodingKey {
    case id, name, description, enabled, cron, timezone, autonomy, projects, running
    case triggerKind = "trigger_kind"
    case lastRunAt = "last_run_at"
    case nextRunAt = "next_run_at"
  }
}

/// The limits a run is held to, whatever its playbook says.
public struct RemoteAutomationGuardrails: Codable, Hashable, Sendable {
  public var confidenceThreshold: Double
  public var maxConcurrentSessions: Double
  public var maxFilesChanged: Double
  public var maxCostUsdPerRun: Double
  public var maxRunMinutes: Double
  public var pathDenylist: [String]
  public var requireCleanCi: Bool
  public var retryOtherAccounts: Bool

  public init(
    confidenceThreshold: Double = 0.8, maxConcurrentSessions: Double = 2,
    maxFilesChanged: Double = 25, maxCostUsdPerRun: Double = 0,
    maxRunMinutes: Double = 20, pathDenylist: [String] = [],
    requireCleanCi: Bool = true, retryOtherAccounts: Bool = true
  ) {
    self.confidenceThreshold = confidenceThreshold
    self.maxConcurrentSessions = maxConcurrentSessions
    self.maxFilesChanged = maxFilesChanged
    self.maxCostUsdPerRun = maxCostUsdPerRun
    self.maxRunMinutes = maxRunMinutes
    self.pathDenylist = pathDenylist
    self.requireCleanCi = requireCleanCi
    self.retryOtherAccounts = retryOtherAccounts
  }

  // Hand-written so a host that predates `retry_other_accounts` still decodes.
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    confidenceThreshold = try c.decode(Double.self, forKey: .confidenceThreshold)
    maxConcurrentSessions = try c.decode(Double.self, forKey: .maxConcurrentSessions)
    maxFilesChanged = try c.decode(Double.self, forKey: .maxFilesChanged)
    maxCostUsdPerRun = try c.decode(Double.self, forKey: .maxCostUsdPerRun)
    maxRunMinutes = try c.decode(Double.self, forKey: .maxRunMinutes)
    pathDenylist = try c.decode([String].self, forKey: .pathDenylist)
    requireCleanCi = try c.decode(Bool.self, forKey: .requireCleanCi)
    retryOtherAccounts = try c.decodeIfPresent(Bool.self, forKey: .retryOtherAccounts) ?? true
  }

  enum CodingKeys: String, CodingKey {
    case confidenceThreshold = "confidence_threshold"
    case maxConcurrentSessions = "max_concurrent_sessions"
    case maxFilesChanged = "max_files_changed"
    case maxCostUsdPerRun = "max_cost_usd_per_run"
    case maxRunMinutes = "max_run_minutes"
    case pathDenylist = "path_denylist"
    case requireCleanCi = "require_clean_ci"
    case retryOtherAccounts = "retry_other_accounts"
  }
}

/// A signal source an automation can subscribe to, and whether it works on the
/// computer this phone is paired with.
public struct RemoteSignalSource: Codable, Hashable, Sendable, Identifiable {
  public enum Mode: String, Codable, Sendable {
    case agent, native
  }

  public var id: String
  public var label: String
  public var mode: Mode
  /// False when the source has nothing to answer with — no `gh`, no MCP.
  public var available: Bool
}

/// An LLM runner an automation can be pinned to.
public struct RemoteRunner: Codable, Hashable, Sendable, Identifiable {
  public struct Model: Codable, Hashable, Sendable {
    public var value: String
    public var displayName: String
    public var description: String?

    enum CodingKeys: String, CodingKey {
      case value, description
      case displayName = "display_name"
    }
  }

  public var id: String
  public var displayName: String
  public var isCustom: Bool
  /// Model applied when the automation pins none.
  public var defaultModel: String?
  /// Empty for runners that only learn their models from a live handshake.
  public var models: [Model]
  /// What the runner's CLI last reported, kept by the host; nil from older hosts.
  public var reportedModels: [RemoteModelInfo]?

  enum CodingKeys: String, CodingKey {
    case id, models
    case reportedModels = "reported_models"
    case displayName = "display_name"
    case isCustom = "is_custom"
    case defaultModel = "default_model"
  }
}

/// Everything needed to edit one automation.
public struct RemoteAutomationDetail: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var name: String
  public var description: String
  public var enabled: Bool
  public var triggerKind: RemoteAutomation.TriggerKind
  public var cron: String?
  public var timezone: String?
  public var catchUp: Bool
  /// Full repo paths: an editor has to write them back unchanged.
  public var repoRoots: [String]
  public var sourceIds: [String]
  public var playbook: String
  /// The user's additions, appended after the playbook on every run. Nil from
  /// a computer too old to have them.
  public var extraInstructions: String?
  public var autonomy: RemoteAutonomy?
  public var model: String?
  /// Runner the run's agent is pinned to; nil follows the app default.
  public var runner: String?
  public var guardrails: RemoteAutomationGuardrails

  public init(
    id: String = "", name: String = "", description: String = "",
    enabled: Bool = true, triggerKind: RemoteAutomation.TriggerKind = .schedule,
    cron: String? = "0 9 * * 1-5", timezone: String? = TimeZone.current.identifier,
    catchUp: Bool = true, repoRoots: [String] = [], sourceIds: [String] = [],
    playbook: String = "", extraInstructions: String? = nil,
    autonomy: RemoteAutonomy? = nil, model: String? = nil,
    runner: String? = nil,
    guardrails: RemoteAutomationGuardrails = .init()
  ) {
    self.id = id
    self.name = name
    self.description = description
    self.enabled = enabled
    self.triggerKind = triggerKind
    self.cron = cron
    self.timezone = timezone
    self.catchUp = catchUp
    self.repoRoots = repoRoots
    self.sourceIds = sourceIds
    self.playbook = playbook
    self.extraInstructions = extraInstructions
    self.autonomy = autonomy
    self.model = model
    self.runner = runner
    self.guardrails = guardrails
  }

  enum CodingKeys: String, CodingKey {
    case id, name, description, enabled, cron, timezone, playbook, autonomy, model, runner
    case guardrails
    case triggerKind = "trigger_kind"
    case catchUp = "catch_up"
    case repoRoots = "repo_roots"
    case sourceIds = "source_ids"
    case extraInstructions = "extra_instructions"
  }
}

/// The editable half of an automation, as the gateway wants it: create sends
/// it whole, update sends the same shape and the host patches what it gets.
public struct RemoteAutomationInput: Codable, Hashable, Sendable {
  public var name: String
  public var description: String
  public var enabled: Bool
  public var triggerKind: RemoteAutomation.TriggerKind
  public var cron: String
  public var timezone: String
  public var catchUp: Bool
  public var repoRoots: [String]
  public var sourceIds: [String]
  public var playbook: String
  public var extraInstructions: String?
  public var autonomy: RemoteAutonomy?
  public var model: String?
  public var runner: String?
  public var guardrails: RemoteAutomationGuardrails

  public init(_ detail: RemoteAutomationDetail) {
    name = detail.name
    description = detail.description
    enabled = detail.enabled
    triggerKind = detail.triggerKind
    cron = detail.cron ?? ""
    timezone = detail.timezone ?? TimeZone.current.identifier
    catchUp = detail.catchUp
    repoRoots = detail.repoRoots
    sourceIds = detail.sourceIds
    playbook = detail.playbook
    extraInstructions = detail.extraInstructions
    autonomy = detail.autonomy
    model = detail.model
    runner = detail.runner
    guardrails = detail.guardrails
  }

  enum CodingKeys: String, CodingKey {
    case name, description, enabled, cron, timezone, playbook, autonomy, model, runner
    case guardrails
    case triggerKind = "trigger_kind"
    case catchUp = "catch_up"
    case repoRoots = "repo_roots"
    case sourceIds = "source_ids"
    case extraInstructions = "extra_instructions"
  }

  // `autonomy` and `model` go out as null rather than missing: null is
  // "inherit", which the host requires on create and needs to clear a patch.
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(description, forKey: .description)
    try c.encode(enabled, forKey: .enabled)
    try c.encode(triggerKind, forKey: .triggerKind)
    try c.encode(cron, forKey: .cron)
    try c.encode(timezone, forKey: .timezone)
    try c.encode(catchUp, forKey: .catchUp)
    try c.encode(repoRoots, forKey: .repoRoots)
    try c.encode(sourceIds, forKey: .sourceIds)
    try c.encode(playbook, forKey: .playbook)
    try c.encodeIfPresent(extraInstructions, forKey: .extraInstructions)
    try c.encode(autonomy, forKey: .autonomy)
    try c.encode(model, forKey: .model)
    try c.encode(runner, forKey: .runner)
    try c.encode(guardrails, forKey: .guardrails)
  }
}

public enum RemoteAutomationRunStatus: String, Codable, Sendable {
  case cancelled, failed, queued, running, skipped, succeeded
}

public struct RemoteAutomationRun: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var automationId: String
  public var automationName: String
  /// True for an ad-hoc run: nothing is persisted behind it.
  public var isQuick: Bool
  public var status: RemoteAutomationRunStatus
  public var triggerReason: String
  public var startedAt: Double
  public var finishedAt: Double?
  public var costUsd: Double?
  public var error: String?
  /// It wrote a report, nobody has read it, and nothing newer has replaced it.
  public var unreadReport: Bool
  /// Opened or dismissed. Absent from older computers, which never said.
  public var reportRead: Bool?
  /// First line of the report, truncated. Absent from older computers and runs without one.
  public var reportPreview: String?
  public var hostSessionId: String?
  public var hostAgentId: String?

  /// What a list row says under the name: the report, else why the run fired.
  public var summary: String {
    if let reportPreview, !reportPreview.isEmpty { return reportPreview }
    return triggerReason
  }

  /// Queued or running — the two states a Cancel button applies to.
  public var isActive: Bool {
    status == .queued || status == .running
  }

  enum CodingKeys: String, CodingKey {
    case id, status, error
    case automationId = "automation_id"
    case automationName = "automation_name"
    case isQuick = "is_quick"
    case triggerReason = "trigger_reason"
    case startedAt = "started_at"
    case finishedAt = "finished_at"
    case costUsd = "cost_usd"
    case unreadReport = "unread_report"
    case reportRead = "report_read"
    case reportPreview = "report_preview"
    case hostSessionId = "host_session_id"
    case hostAgentId = "host_agent_id"
  }
}

public enum RemoteReportTone: String, Codable, Sendable {
  case critical, info, positive, warning
}

/// A table cell: the schema allows a string or a number in the same column.
public enum RemoteCell: Codable, Hashable, Sendable {
  case string(String)
  case number(Double)

  public var text: String {
    switch self {
    case .string(let s): s
    case .number(let n): n == n.rounded() ? String(Int(n)) : String(n)
    }
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let n = try? c.decode(Double.self) {
      self = .number(n)
    } else {
      self = .string(try c.decode(String.self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let s): try c.encode(s)
    case .number(let n): try c.encode(n)
    }
  }
}

public struct RemoteStatItem: Codable, Hashable, Sendable {
  public var label: String
  public var value: String
  /// Signed change vs the previous period; the sign picks the tone.
  public var delta: Double?
}

public struct RemoteListItem: Codable, Hashable, Sendable {
  public var text: String
  public var href: String?
  public var tone: RemoteReportTone?
}

/// The closed block union a run's report is built from. The computer validates
/// these, so anything that arrives here is well-formed.
public enum RemoteReportBlock: Codable, Hashable, Sendable {
  case heading(String)
  case markdown(String)
  case stats([RemoteStatItem])
  case table(columns: [String], rows: [[RemoteCell]])
  case list([RemoteListItem])
  case series(kind: String, labels: [String], values: [Double], label: String?)
  case proposals(ids: [String])
  case sessions(ids: [String])

  enum CodingKeys: String, CodingKey {
    case type, text, items, columns, rows, kind, labels, values, label, ids
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .type) {
    case "heading":
      self = .heading(try c.decode(String.self, forKey: .text))
    case "markdown":
      self = .markdown(try c.decode(String.self, forKey: .text))
    case "stats":
      self = .stats(try c.decode([RemoteStatItem].self, forKey: .items))
    case "table":
      self = .table(
        columns: try c.decode([String].self, forKey: .columns),
        rows: try c.decode([[RemoteCell]].self, forKey: .rows))
    case "list":
      self = .list(try c.decode([RemoteListItem].self, forKey: .items))
    case "series":
      self = .series(
        kind: try c.decode(String.self, forKey: .kind),
        labels: try c.decode([String].self, forKey: .labels),
        values: try c.decode([Double].self, forKey: .values),
        label: try c.decodeIfPresent(String.self, forKey: .label))
    case "proposals":
      self = .proposals(ids: try c.decode([String].self, forKey: .ids))
    case "sessions":
      self = .sessions(ids: try c.decode([String].self, forKey: .ids))
    case let other:
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: c, debugDescription: "unknown report block \(other)")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .heading(let t):
      try c.encode("heading", forKey: .type); try c.encode(t, forKey: .text)
    case .markdown(let t):
      try c.encode("markdown", forKey: .type); try c.encode(t, forKey: .text)
    case .stats(let items):
      try c.encode("stats", forKey: .type); try c.encode(items, forKey: .items)
    case .table(let columns, let rows):
      try c.encode("table", forKey: .type)
      try c.encode(columns, forKey: .columns); try c.encode(rows, forKey: .rows)
    case .list(let items):
      try c.encode("list", forKey: .type); try c.encode(items, forKey: .items)
    case .series(let kind, let labels, let values, let label):
      try c.encode("series", forKey: .type)
      try c.encode(kind, forKey: .kind)
      try c.encode(labels, forKey: .labels)
      try c.encode(values, forKey: .values)
      try c.encodeIfPresent(label, forKey: .label)
    case .proposals(let ids):
      try c.encode("proposals", forKey: .type); try c.encode(ids, forKey: .ids)
    case .sessions(let ids):
      try c.encode("sessions", forKey: .type); try c.encode(ids, forKey: .ids)
    }
  }
}

/// A note the user left on a run's report, and what it was allowed to do.
public struct RemoteRunFeedback: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  /// The user's words, verbatim.
  public var note: String
  /// The turn could withdraw or supersede proposals while answering this.
  public var allowClearing: Bool
  public var createdAt: Double

  enum CodingKeys: String, CodingKey {
    case id
    case note
    case allowClearing = "allow_clearing"
    case createdAt = "created_at"
  }
}

public struct RemoteAutomationRunDetail: Codable, Sendable {
  public var run: RemoteAutomationRun
  public var reportBlocks: [RemoteReportBlock]?
  public var reportMarkdown: String?
  /// What the user pushed back on after reading the report, oldest first.
  public var feedback: [RemoteRunFeedback]?

  enum CodingKeys: String, CodingKey {
    case run
    case reportBlocks = "report_blocks"
    case reportMarkdown = "report_markdown"
    case feedback
  }
}

// MARK: - Proposals

public struct RemoteProposalCta: Codable, Hashable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case deleteBranch = "delete_branch"
    case deleteSession = "delete_session"
    case openUrl = "open_url"
    case startSession = "start_session"
  }

  public var kind: Kind
  public var label: String
  public var url: String?
  public var branch: String?
  /// `git branch -D` rather than `-d`.
  ///
  /// Absent, not null, when the automation never asked for it: the MCP tool
  /// that writes a proposal leaves this optional, and the gateway does not
  /// re-validate results against the stricter protocol schema on the way out.
  /// Decoding it as required fails the whole inbox on one such proposal.
  private var forceFlag: Bool?
  public var sessionId: String?

  public var force: Bool { forceFlag ?? false }

  enum CodingKeys: String, CodingKey {
    case kind, label, url, branch
    case forceFlag = "force"
    case sessionId = "session_id"
  }
}

public enum RemoteProposalStatus: String, Codable, Sendable {
  case accepted
  case autoStarted = "auto_started"
  case dismissed, pending
  /// You did what it asked, outside Argus. Agreement, not rejection.
  case resolved
  /// Cleared by a later run of the same automation, not by the user.
  case superseded, withdrawn
}

public struct RemoteProposal: Codable, Hashable, Sendable, Identifiable {
  /// How far a start has got; the host only reports it while one is in flight.
  public enum StartStage: String, Codable, Hashable, Sendable {
    case creatingWorktree = "creating_worktree"
    case settingUp = "setting_up"
    case startingAgent = "starting_agent"
  }

  public var id: String
  public var automationId: String
  public var automationName: String
  /// The run that raised it. Absent from computers older than this field.
  public var runId: String?
  public var title: String
  /// What the work is, in markdown.
  public var summary: String
  /// Why the run ranked it where it did.
  public var rationale: String
  /// 0..1, self-reported by the run's agent.
  public var confidence: Double
  public var cta: RemoteProposalCta?
  public var status: RemoteProposalStatus
  /// Project name, never a path.
  public var project: String?
  public var sourceLabel: String?
  public var sourceUrl: String?
  public var sessionId: String?
  /// The agent working it, once running. The start fields below are absent
  /// from computers older than them, so all three decode as optional.
  public var agentId: String?
  /// Non-nil only while a start is in flight.
  public var startStage: StartStage?
  /// Why the last start failed, readable. Cleared when a new start begins.
  public var startError: String?
  public var createdAt: Double
  /// The record behind a decision; absent from computers older than them.
  public var acceptedNote: String?
  public var dismissedReason: String?
  public var resolvedNote: String?
  /// A rework asked for and not yet picked up by a run.
  public var revisionRequest: String?
  public var clearedReason: String?
  public var clearedAt: Double?
  public var supersededBy: String?

  enum CodingKeys: String, CodingKey {
    case id, title, summary, rationale, confidence, cta, status, project
    case automationId = "automation_id"
    case automationName = "automation_name"
    case runId = "run_id"
    case sourceLabel = "source_label"
    case sourceUrl = "source_url"
    case sessionId = "session_id"
    case agentId = "agent_id"
    case startStage = "start_stage"
    case startError = "start_error"
    case createdAt = "created_at"
    case acceptedNote = "accepted_note"
    case dismissedReason = "dismissed_reason"
    case resolvedNote = "resolved_note"
    case revisionRequest = "revision_request"
    case clearedReason = "cleared_reason"
    case clearedAt = "cleared_at"
    case supersededBy = "superseded_by"
  }
}

/// One file in an automation's memory: what a run carried forward for the next.
public struct RemoteAutomationMemory: Codable, Hashable, Sendable, Identifiable {
  public enum Kind: String, Codable, Hashable, Sendable, CaseIterable {
    case project, feedback, user, reference
  }

  public var name: String
  public var description: String
  public var type: Kind
  public var body: String
  public var updatedAt: Double

  public var id: String { name }

  public init(
    name: String = "", description: String = "", type: Kind = .project, body: String = "",
    updatedAt: Double = 0
  ) {
    self.name = name
    self.description = description
    self.type = type
    self.body = body
    self.updatedAt = updatedAt
  }

  enum CodingKeys: String, CodingKey {
    case name, description, type, body
    case updatedAt = "updated_at"
  }
}
