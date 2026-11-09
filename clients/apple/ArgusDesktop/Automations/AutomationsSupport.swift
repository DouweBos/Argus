import ArgusCore
import ArgusUI
import Foundation

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

  /// Opens the paused copy straight away so it can be pointed elsewhere.
  static func duplicate(_ model: DesktopModel, id: String) async {
    guard let copy = await model.automations.duplicate(id: id) else { return }
    model.navigate(.automation(id: copy, runId: nil))
  }

  /// A quick run has no automation to hang off, so it opens under quick runs.
  static func openRun(_ model: DesktopModel, automationId: String, runId: String) {
    let quick = model.inbox.runs.contains { $0.id == runId && $0.scratch != nil }
      || model.automations.runs.contains { $0.id == runId && $0.isQuick }
    model.navigate(quick ? .quickRun(runId: runId) : .automation(id: automationId, runId: runId))
  }
}
