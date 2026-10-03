import ArgusKit
import Foundation

/// What the inbox is made of, grouped by what you would do about it rather
/// than by which automation produced it — the desktop's `useInboxItems`.
public struct InboxItems: Sendable {
  public typealias Proposal = ArgusProtocol.Proposal
  public typealias Run = ArgusProtocol.AutomationRun

  /// A failure or a cleared proposal older than this is history, not an inbox item.
  public static let window: Double = 24 * 60 * 60 * 1000
  public static let maxFailedRuns = 5

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
    pending = proposals.filter { $0.status == .pending }
    // A merged or deleted session leaves its proposal started with nothing to open.
    started = proposals.filter {
      ($0.status == .accepted || $0.status == .autoStarted)
        && $0.sessionId.map(sessionIds.contains) == true
    }
    cleared = proposals.filter {
      ($0.status == .superseded || $0.status == .withdrawn)
        && $0.clearedAt.map { now - $0 < Self.window } == true
    }
    failed = Array(
      runs.filter { $0.status == .failed && !$0.reportRead && now - $0.startedAt < Self.window }
        .prefix(Self.maxFailedRuns))
    // A failed run is already listed as a failure; its report would ask twice.
    reports = runs.filter { $0.status != .failed && $0.hasUnreadReport }
  }

  public var isEmpty: Bool {
    pending.isEmpty && reports.isEmpty && started.isEmpty && failed.isEmpty && cleared.isEmpty
  }

  /// How many things are actually waiting on you — what a badge would show.
  public var actionCount: Int { pending.count + failed.count + reports.count }
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
