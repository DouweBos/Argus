import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct AutomationTriggerTests {
  @Test("switching to an event trigger starts from the host's defaults")
  func defaults() {
    var draft = RemoteAutomationDetail(name: "A", playbook: "p")
    draft.setTriggerKind(.signal)
    #expect(draft.signal == RemoteAutomationSignal(on: [.newIssue], labels: [], fire: .each, maxRunsPerHour: 4))
    #expect(draft.hasValidTrigger)
    draft.setTriggerKind(.webhook)
    #expect(draft.webhook == RemoteAutomationWebhook(fire: .each, maxRunsPerHour: 4))
    #expect(draft.schedulePreview() == nil)
  }

  @Test("a signal with no events can't be saved")
  func needsAnEvent() {
    var draft = RemoteAutomationDetail(triggerKind: .signal, signal: .init(on: []))
    #expect(draft.signalError == "Pick at least one event to react to.")
    #expect(!draft.hasValidTrigger)
    draft.signal?.on = [.ciFailed]
    #expect(draft.hasValidTrigger)
  }

  @Test("labels parse from comma-separated text and the cap stays in 1...60")
  func labelsAndCap() {
    #expect(AutomationTriggerText.labels(" bug, ,needs-triage ") == ["bug", "needs-triage"])
    #expect(AutomationTriggerText.clampRuns(0) == 1)
    #expect(AutomationTriggerText.clampRuns(90) == 60)
  }

  @Test("list rows name event triggers")
  func labels() throws {
    let json = #"[{"id":"a","name":"A","description":"","enabled":true,"trigger_kind":"signal","projects":[],"running":false},{"id":"b","name":"B","description":"","enabled":true,"trigger_kind":"webhook","projects":[],"running":false}]"#
    let automations = try ProtocolCodec.decoder.decode([RemoteAutomation].self, from: Data(json.utf8))
    #expect(automations.map(Labels.triggerLabel) == ["On events", "On webhook"])
  }
}
