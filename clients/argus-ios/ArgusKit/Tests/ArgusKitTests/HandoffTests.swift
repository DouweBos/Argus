import Foundation
import Testing

@testable import ArgusKit

/// The desktop writes this `userInfo` from JavaScript, so the keys and the
/// base64 spelling of the host key are a contract, not an implementation
/// detail — a mismatch silently drops every handoff.
@Suite("Handoff")
struct HandoffTests {

  private let key = Data((0..<32).map { UInt8($0) })

  @Test("round-trips through userInfo")
  func roundTrip() {
    let handoff = Handoff(
      hostKey: ArgusBase64.encodeURL(key),
      sessionId: "s1",
      agentId: "a1",
      label: "Fix login",
      projectName: "Argus",
      repoRoot: "/Users/me/Argus")

    #expect(Handoff(userInfo: handoff.userInfo) == handoff)
  }

  @Test("a session alone is enough; a missing one is not")
  func minimal() {
    let info = ["hostKey": "abc", "sessionId": "s1"]
    #expect(Handoff(userInfo: info)?.agentId == nil)
    #expect(Handoff(userInfo: ["hostKey": "abc"]) == nil)
    #expect(Handoff(userInfo: nil) == nil)
  }

  @Test("matches a pairing's key across base64 spellings")
  func hostMatching() {
    let handoff = Handoff(hostKey: ArgusBase64.encodeURL(key), sessionId: "s1")

    #expect(handoff.names(desktopKey: ArgusBase64.encode(key)))
    #expect(!handoff.names(desktopKey: ArgusBase64.encode(Data(repeating: 9, count: 32))))
  }
}
