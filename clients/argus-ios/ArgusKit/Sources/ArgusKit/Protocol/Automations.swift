import Foundation

/// Automations, their runs and the reports they write. Ported from
/// `packages/remote-protocol/src/{models,report}.ts`.
///
/// Authoring stays on the desktop — a phone views these and fires them, so the
/// playbook, guardrails and signal sources are deliberately absent.

public enum RemoteAutonomy: String, Codable, Sendable {
  case autoMerge = "auto_merge"
  case draft, pr, propose

  public var label: String {
    switch self {
    case .autoMerge: "auto merge"
    case .draft: "draft"
    case .pr: "pr"
    case .propose: "propose"
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
  public var hostSessionId: String?
  public var hostAgentId: String?

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

public struct RemoteAutomationRunDetail: Codable, Sendable {
  public var run: RemoteAutomationRun
  public var reportBlocks: [RemoteReportBlock]?
  public var reportMarkdown: String?

  enum CodingKeys: String, CodingKey {
    case run
    case reportBlocks = "report_blocks"
    case reportMarkdown = "report_markdown"
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
  public var id: String
  public var automationId: String
  public var automationName: String
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
  public var createdAt: Double

  enum CodingKeys: String, CodingKey {
    case id, title, summary, rationale, confidence, cta, status, project
    case automationId = "automation_id"
    case automationName = "automation_name"
    case sourceLabel = "source_label"
    case sourceUrl = "source_url"
    case sessionId = "session_id"
    case createdAt = "created_at"
  }
}
