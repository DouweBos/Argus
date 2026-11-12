@testable import ArgusAuth
import ArgusKit
import Testing

@Suite("Account auth")
struct AccountAuthTests {
  @Test("signed out only once configured and loaded, with no session")
  func sessionState() {
    #expect(AccountAuth.sessionState(configured: false, loaded: true, hasSession: false) == .unknown)
    #expect(AccountAuth.sessionState(configured: true, loaded: false, hasSession: false) == .unknown)
    #expect(AccountAuth.sessionState(configured: true, loaded: true, hasSession: false) == .signedOut)
    #expect(AccountAuth.sessionState(configured: true, loaded: true, hasSession: true) == .signedIn)
  }

  @Test("an ended session's status names why it went")
  func lossReason() {
    #expect(AccountAuth.lossReason(.expired) == .expired)
    #expect(AccountAuth.lossReason(.abandoned) == .inactive)
    #expect(AccountAuth.lossReason(.revoked) == .endedElsewhere)
    #expect(AccountAuth.lossReason(.ended) == .endedElsewhere)
    #expect(AccountAuth.lossReason(.active) == nil)
  }
}
