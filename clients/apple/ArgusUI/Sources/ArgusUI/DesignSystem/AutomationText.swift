import ArgusKit
import Foundation

/// Labels the automation and inbox screens share, worded as the desktop app's.
public enum AutomationText {
  public static func timestamp(_ millis: Double) -> String {
    Date(timeIntervalSince1970: millis / 1000).formatted(date: .abbreviated, time: .shortened)
  }

  /// What the list shows under "next run".
  public static func nextRun(_ automation: RemoteAutomation) -> String {
    guard automation.triggerKind == .schedule else { return "Manual" }
    guard automation.enabled else { return "Paused" }
    guard let next = automation.nextRunAt else { return "—" }
    return "\(timestamp(next)) (\(Labels.until(next) ?? "now"))"
  }

  public static func plural(_ count: Int, _ noun: String) -> String {
    "\(count) \(noun)\(count == 1 ? "" : "s")"
  }

  public static func actionLabel(_ action: ArgusProtocol.ProposalAction) -> String {
    switch action {
    case .ignore: "suggests ignoring"
    case .needsInfo: "needs info"
    case .review: "worth a review"
    default: "ready to start"
    }
  }

  public static func actionTone(_ action: ArgusProtocol.ProposalAction) -> Tone {
    switch action {
    case .ignore: .muted
    case .needsInfo: .warning
    case .review: .accent
    default: .success
    }
  }

  /// How far a proposal's start has got. Both wire shapes share the raw values.
  public static func stage(_ rawValue: String?) -> String {
    switch rawValue {
    case "creating_worktree": "Creating worktree…"
    case "setting_up": "Running setup…"
    case "starting_agent": "Starting agent…"
    default: "Starting…"
    }
  }

  public static func project(_ repoRoot: String?) -> String? {
    repoRoot.map { URL(fileURLWithPath: $0).lastPathComponent }
  }

  /// A run's outcome as a tone. Both wire shapes share the raw values.
  public static func runTone(_ rawValue: String) -> Tone {
    switch rawValue {
    case "running", "queued": .accent
    case "succeeded": .success
    case "skipped": .warning
    default: .danger
    }
  }

  /// What happened to a proposal nobody can act on any more. A withdrawal
  /// names the automation: it was Argus's call, and the reason is its evidence.
  public static func decidedNote(
    status: String, automation: String, acceptedNote: String?, dismissedReason: String?,
    resolvedNote: String?, clearedReason: String?
  ) -> String? {
    let cleared = clearedReason.map { ": \($0)" }
    switch status {
    case "pending": return nil
    case "accepted":
      return acceptedNote.map { "You started this, with the note: \($0)" } ?? "You started this."
    case "auto_started": return "Argus started this itself — the guardrails allowed it."
    case "dismissed":
      return dismissedReason.map { "You dismissed this: \($0)" } ?? "You dismissed this."
    case "resolved":
      return resolvedNote.map { "You marked this done: \($0)" }
        ?? "You marked this done — you handled it yourself."
    case "superseded":
      return "A later run of \(automation) proposed the same work again\(cleared ?? ".")"
    default:
      return "\(automation) withdrew this\(cleared ?? " — the signal behind it went away.")"
    }
  }

  public static func decidedNote(_ proposal: RemoteProposal) -> String? {
    decidedNote(
      status: proposal.status.rawValue, automation: proposal.automationName,
      acceptedNote: proposal.acceptedNote, dismissedReason: proposal.dismissedReason,
      resolvedNote: proposal.resolvedNote, clearedReason: proposal.clearedReason)
  }

  /// The catalog's proposal carries no automation name; the caller resolves it.
  public static func decidedNote(_ proposal: ArgusProtocol.Proposal, automation: String?)
    -> String?
  {
    decidedNote(
      status: proposal.status.rawValue, automation: automation ?? "the automation",
      acceptedNote: proposal.acceptedNote, dismissedReason: proposal.dismissedReason,
      resolvedNote: proposal.resolvedNote, clearedReason: proposal.clearedReason)
  }

  public static let newPlaybook = """
    # New automation

    Describe what this run should do, in markdown. The agent reads the projects in
    scope at their absolute paths and writes its findings as its final message.

    """
}

extension RemoteAutomationRunStatus {
  public var tone: Tone { AutomationText.runTone(rawValue) }
}

extension ArgusProtocol.AutomationRunStatus {
  public var tone: Tone { AutomationText.runTone(rawValue) }
}
