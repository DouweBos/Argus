import ArgusKit
import Testing

@testable import ArgusCore

struct SetupChecksTests {
  private func result(
    _ id: PrereqId, _ status: ArgusProtocol.PrereqStatus, fixable: Bool? = nil,
    reason: ArgusProtocol.ClaudeAuthReason? = nil
  ) -> (PrereqId, PrereqResult) {
    (id, PrereqResult(id: id, status: status, fixable: fixable, authReason: reason))
  }

  @Test func showsNothingWhenEverythingPasses() {
    let results = Dictionary(uniqueKeysWithValues: SetupChecks.core.map { result($0, .pass) })
    #expect(SetupChecks.cards(results).isEmpty)
  }

  @Test func authWaitsOnTheCli() {
    let results = Dictionary(uniqueKeysWithValues: [
      result(.claudeCli, .fail, fixable: true), result(.claudeAuth, .fail), result(.gitCli, .pass),
    ])
    #expect(SetupChecks.cards(results) == [.claudeCliMissing(fixable: true, detail: nil)])
  }

  @Test func wordsAuthByReason() {
    let results = Dictionary(uniqueKeysWithValues: [
      result(.claudeCli, .pass), result(.claudeAuth, .warn, reason: .selectedRateLimited),
      result(.gitIdentity, .warn),
    ])
    let cards = SetupChecks.cards(results)
    #expect(cards.count == 2)
    guard case .claudeAuth(let copy) = cards.first else {
      Issue.record("no auth card")
      return
    }
    #expect(copy.action == "Switch account")
    #expect(!copy.signsIn)
    #expect(cards.last == .gitIdentity)
  }

  @Test func unknownReasonAsksToSignIn() {
    #expect(SetupChecks.authCopy(nil).signsIn)
  }

  @Test func validatesIdentity() {
    #expect(SetupChecks.isValidIdentity(name: "Ada", email: "ada@example.com"))
    #expect(!SetupChecks.isValidIdentity(name: " ", email: "ada@example.com"))
    #expect(!SetupChecks.isValidIdentity(name: "Ada", email: "ada@example"))
  }

  @Test func resumesFromTheHostThenTheLocalStep() {
    #expect(OnboardingStepId.resume(hostStep: .welcome, local: "project") == .welcome)
    #expect(OnboardingStepId.resume(hostStep: .telemetry, local: nil) == .privacy)
    #expect(OnboardingStepId.resume(hostStep: .telemetry, local: "project") == .project)
    #expect(OnboardingStepId.resume(hostStep: .telemetry, local: "welcome") == .privacy)
    #expect(OnboardingStepId.setup.next == .project)
    #expect(OnboardingStepId.project.next == nil)
  }
}
