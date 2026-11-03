import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@Suite("Automation account pin")
struct AutomationAccountPinTests {
  private func account(_ id: String, label: String) throws -> RemoteClaudeAccount {
    let json = #"{"id":"\#(id)","label":"\#(label)","needs_reauth":false,"rate_limited":false,"account_type":"claudeai"}"#
    return try JSONDecoder().decode(RemoteClaudeAccount.self, from: Data(json.utf8))
  }

  @Test("only Claude Code takes a pin")
  func runners() {
    #expect(AutomationAccountPin.applies(toRunner: nil))
    #expect(AutomationAccountPin.applies(toRunner: "claude-code"))
    #expect(!AutomationAccountPin.applies(toRunner: "custom:apex"))
  }

  @Test("lists the default, every account, and a pin to a signed-out one")
  func options() throws {
    let accounts = [try account("w", label: "Work"), try account("h", label: "Home")]
    let options = AutomationAccountPin.options(accounts: accounts, activeId: "h", pinned: "gone")
    #expect(options.map(\.value) == ["", "w", "h", "gone"])
    #expect(options.first?.hint == "Follows the computer: Home")
    #expect(AutomationAccountPin.offered(accounts: [accounts[0]], pinned: "w"))
    #expect(!AutomationAccountPin.offered(accounts: [accounts[0]], pinned: nil))
  }
}
