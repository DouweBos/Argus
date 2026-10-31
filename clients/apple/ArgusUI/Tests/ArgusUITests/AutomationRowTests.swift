import ArgusCore
import Foundation
import Testing

@testable import ArgusUI

@Suite("Automation row")
struct AutomationRowTests {
  private func automation(enabled: Bool = true, running: Bool = false) -> RemoteAutomation {
    let json =
      #"{"id":"a","name":"n","description":"","enabled":\#(enabled),"trigger_kind":"schedule","projects":[],"running":\#(running)}"#
    return try! JSONDecoder().decode(RemoteAutomation.self, from: Data(json.utf8))
  }

  @Test("the dot shows the latest run's outcome")
  func dotTone() {
    #expect(AutomationRow.dotTone(automation(), lastRun: .failed) == .danger)
    #expect(AutomationRow.dotTone(automation(enabled: false), lastRun: .succeeded) == .success)
    #expect(AutomationRow.dotTone(automation(), lastRun: .skipped) == .warning)
    #expect(AutomationRow.dotTone(automation(running: true), lastRun: .failed) == .accent)
  }

  @Test("without runs it says whether the automation is on")
  func neverRan() {
    #expect(AutomationRow.dotTone(automation(), lastRun: nil) == .success)
    #expect(AutomationRow.dotTone(automation(enabled: false), lastRun: nil) == .muted)
  }
}
