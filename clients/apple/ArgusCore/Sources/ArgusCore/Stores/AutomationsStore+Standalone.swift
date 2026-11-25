import ArgusKit

extension AutomationsStore {
  /// The automations that aren't a teammate's duty: duties live on their teammate's page.
  public var standaloneAutomations: [RemoteAutomation] {
    automations.filter { $0.teammateId == nil }
  }

  /// Runs, minus those of a teammate's duty.
  public var standaloneRuns: [RemoteAutomationRun] {
    let duties = Set(automations.lazy.filter { $0.teammateId != nil }.map(\.id))
    return duties.isEmpty ? runs : runs.filter { !duties.contains($0.automationId) }
  }
}
