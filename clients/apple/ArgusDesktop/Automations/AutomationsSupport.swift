import ArgusCore
import ArgusUI
import Foundation

/// Labels the automation and inbox screens share, worded as the desktop app's.
enum AutomationText {
  static func timestamp(_ millis: Double) -> String {
    Date(timeIntervalSince1970: millis / 1000).formatted(date: .abbreviated, time: .shortened)
  }

  /// What the list shows under "next run".
  static func nextRun(_ automation: RemoteAutomation) -> String {
    guard automation.triggerKind == .schedule else { return "Manual" }
    guard automation.enabled else { return "Paused" }
    guard let next = automation.nextRunAt else { return "—" }
    return "\(timestamp(next)) (\(Labels.until(next) ?? "now"))"
  }

  static func plural(_ count: Int, _ noun: String) -> String {
    "\(count) \(noun)\(count == 1 ? "" : "s")"
  }

  static func actionLabel(_ action: ArgusProtocol.ProposalAction) -> String {
    switch action {
    case .ignore: "suggests ignoring"
    case .needsInfo: "needs info"
    case .review: "worth a review"
    default: "ready to start"
    }
  }

  static func actionTone(_ action: ArgusProtocol.ProposalAction) -> Tone {
    switch action {
    case .ignore: .muted
    case .needsInfo: .warning
    case .review: .accent
    default: .success
    }
  }

  static func stage(_ stage: ArgusProtocol.ProposalStartStage?) -> String {
    switch stage {
    case .creatingWorktree?: "Creating worktree…"
    case .settingUp?: "Running setup…"
    case .startingAgent?: "Starting agent…"
    default: "Starting…"
    }
  }

  static func autonomy(_ rung: RemoteAutonomy) -> String {
    switch rung {
    case .propose: "Propose"
    case .draft: "Draft"
    case .pr: "Pull request"
    case .autoMerge: "Auto-merge"
    }
  }

  static func project(_ repoRoot: String?) -> String? {
    repoRoot.map { URL(fileURLWithPath: $0).lastPathComponent }
  }

  static let newPlaybook = """
    # New automation

    Describe what this run should do, in markdown. The agent reads the projects in
    scope at their absolute paths and writes its findings as its final message.

    """
}

extension ArgusProtocol.AutomationRunStatus {
  var tone: Tone {
    switch self {
    case .running, .queued: .accent
    case .succeeded: .success
    case .skipped: .warning
    default: .danger
    }
  }
}

@MainActor
enum AutomationActions {
  /// A paused, weekday-morning automation with a starter playbook, opened
  /// straight away — the desktop's "New automation".
  static func createNew(_ model: DesktopModel) async {
    let draft = RemoteAutomationDetail(
      name: "New automation", enabled: false, playbook: AutomationText.newPlaybook)
    guard let id = await model.automations.save(id: nil, input: RemoteAutomationInput(draft))
    else { return }
    model.navigate(.automation(id: id, runId: nil))
  }

  /// A quick run has no automation to hang off, so it opens under quick runs.
  static func openRun(_ model: DesktopModel, automationId: String, runId: String) {
    let quick = model.inbox.runs.contains { $0.id == runId && $0.scratch != nil }
      || model.automations.runs.contains { $0.id == runId && $0.isQuick }
    model.navigate(quick ? .quickRun(runId: runId) : .automation(id: automationId, runId: runId))
  }
}
