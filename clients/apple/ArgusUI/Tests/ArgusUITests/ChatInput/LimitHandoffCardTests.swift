import ArgusCore
import ArgusKit
import Foundation
import Testing

@testable import ArgusUI

@Suite("Limit handoff card")
struct LimitHandoffCardTests {
  private func status(_ state: String, stalled: Bool?) throws -> RemoteAgentStatus {
    var json: [String: Any] = ["agent_id": "a", "session_id": "s", "status": state]
    json["limit_stalled"] = stalled
    return try JSONDecoder().decode(
      RemoteAgentStatus.self, from: JSONSerialization.data(withJSONObject: json))
  }

  @Test("only a live agent stuck on the limit offers a handoff")
  func stalled() throws {
    #expect(LimitHandoffCard.isStalled(try status("idle", stalled: true)))
    #expect(!LimitHandoffCard.isStalled(try status("idle", stalled: false)))
    #expect(!LimitHandoffCard.isStalled(try status("idle", stalled: nil)))
    #expect(!LimitHandoffCard.isStalled(try status("stopped", stalled: true)))
    #expect(!LimitHandoffCard.isStalled(nil))
  }

  @Test("usage reads as what's left, with the reset when known")
  func caption() {
    let now = Date(timeIntervalSince1970: 1_000_000)
    let window = ArgusProtocol.UsageLimitWindow(
      id: "weekly", kind: .weekly, label: "Weekly", usedPercent: 42.4,
      resetsAt: (now.timeIntervalSince1970 + 2 * 3600) * 1000, windowMinutes: 10_080, pace: nil)
    #expect(LimitHandoffCard.usageCaption(window, now: now) == "Weekly 57% left · Resets in 2h 0m")
    var noReset = window
    noReset.resetsAt = nil
    #expect(LimitHandoffCard.usageCaption(noReset, now: now) == "Weekly 57% left")
    #expect(LimitHandoffCard.usageCaption(nil, now: now) == "Usage unknown")
  }
}
