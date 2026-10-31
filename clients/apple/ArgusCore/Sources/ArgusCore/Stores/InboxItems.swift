import ArgusKit
import Foundation

/// Where a proposal sits in the inbox, whichever wire shape it came in.
public enum InboxProposalPhase: Sendable {
  case pending, started, cleared, decided
}

/// What the inbox needs of a proposal: the catalog's on the Mac, the gateway's on the phone.
public protocol InboxProposal: Sendable {
  var inboxPhase: InboxProposalPhase { get }
  var sessionId: String? { get }
  var clearedAt: Double? { get }
}

/// What the inbox needs of a run.
public protocol InboxRun: Sendable {
  var isFailed: Bool { get }
  /// Opened or dismissed; a failure read this way leaves the inbox.
  var isRead: Bool { get }
  var startedAt: Double { get }
  var hasUnreadReport: Bool { get }
}

/// What the inbox is made of, grouped by what you would do about it rather
/// than by which automation produced it — the desktop's `useInboxItems`.
public struct InboxGroups<Proposal: InboxProposal, Run: InboxRun>: Sendable {
  /// A failure or a cleared proposal older than this is history, not an inbox item.
  public static var window: Double { 24 * 60 * 60 * 1000 }
  public static var maxFailedRuns: Int { 5 }

  /// Decisions waiting on you.
  public var pending: [Proposal]
  /// Finished runs whose report nobody has opened yet.
  public var reports: [Run]
  /// Work Argus already started, whose session still exists.
  public var started: [Proposal]
  /// Recent failures nobody dismissed — the automation needs a look.
  public var failed: [Run]
  /// Taken off your hands by a later run, for information.
  public var cleared: [Proposal]

  /// `now` is in milliseconds, like every host timestamp.
  public init(proposals: [Proposal], runs: [Run], sessionIds: Set<String>, now: Double) {
    pending = proposals.filter { $0.inboxPhase == .pending }
    // A merged or deleted session leaves its proposal started with nothing to open.
    started = proposals.filter {
      $0.inboxPhase == .started && $0.sessionId.map(sessionIds.contains) == true
    }
    cleared = proposals.filter {
      $0.inboxPhase == .cleared && $0.clearedAt.map { now - $0 < Self.window } == true
    }
    failed = Array(
      runs.filter { $0.isFailed && !$0.isRead && now - $0.startedAt < Self.window }
        .prefix(Self.maxFailedRuns))
    // A failed run is already listed as a failure; its report would ask twice.
    reports = runs.filter { !$0.isFailed && $0.hasUnreadReport }
  }

  public var isEmpty: Bool {
    pending.isEmpty && reports.isEmpty && started.isEmpty && failed.isEmpty && cleared.isEmpty
  }

  /// How many things are actually waiting on you — what a badge would show.
  public var actionCount: Int { pending.count + failed.count + reports.count }
}

/// The Mac's inbox, over the host's catalog.
public typealias InboxItems = InboxGroups<ArgusProtocol.Proposal, ArgusProtocol.AutomationRun>
/// The phone's inbox, over the gateway's narrowed shapes.
public typealias RemoteInboxItems = InboxGroups<RemoteProposal, RemoteAutomationRun>

extension InboxProposalPhase {
  fileprivate init(pending: Bool, started: Bool, cleared: Bool) {
    self = pending ? .pending : started ? .started : cleared ? .cleared : .decided
  }
}

extension ArgusProtocol.Proposal: InboxProposal {
  public var inboxPhase: InboxProposalPhase {
    .init(
      pending: status == .pending, started: status == .accepted || status == .autoStarted,
      cleared: status == .superseded || status == .withdrawn)
  }
}

extension RemoteProposal: InboxProposal {
  public var inboxPhase: InboxProposalPhase {
    .init(
      pending: status == .pending, started: status == .accepted || status == .autoStarted,
      cleared: status == .superseded || status == .withdrawn)
  }
}

extension ArgusProtocol.AutomationRun: InboxRun {
  public var isFailed: Bool { status == .failed }
  public var isRead: Bool { reportRead }
}

extension RemoteAutomationRun: InboxRun {
  public var isFailed: Bool { status == .failed }
  /// An older computer never says, so its failures stay until they age out.
  public var isRead: Bool { reportRead ?? false }
  public var hasUnreadReport: Bool { unreadReport && !isActive }
}

extension ArgusProtocol.AutomationRun {
  public var isActive: Bool { status == .queued || status == .running }

  public var hasReport: Bool {
    !(reportBlocks ?? []).isEmpty || !(reportMarkdown ?? "").isEmpty
  }

  public var hasUnreadReport: Bool { !reportRead && !isActive && hasReport }

  /// One line of what the report says, for a row that links to the full one.
  public var reportPreview: String {
    for block in reportBlocks ?? [] {
      guard let text = block["text"]?.stringValue else { continue }
      switch block["type"]?.stringValue {
      case "heading": return text
      case "markdown": if let line = Self.firstLine(text) { return line }
      default: continue
      }
    }
    return Self.firstLine(reportMarkdown ?? "") ?? triggerReason
  }

  private static func firstLine(_ text: String) -> String? {
    text.split(whereSeparator: \.isNewline)
      .map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: ["#", " ", "*", "-"]) }
      .first { !$0.isEmpty }
  }
}
