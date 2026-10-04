import ArgusKit
import Foundation
import Testing

@testable import ArgusUI

@Suite("Limit resume banner")
struct LimitResumeBannerTests {
  private func status(_ state: String, resumeAt: Double?) throws -> RemoteAgentStatus {
    var json: [String: Any] = ["agent_id": "a", "session_id": "s", "status": state]
    json["limit_resume_at"] = resumeAt
    return try JSONDecoder().decode(
      RemoteAgentStatus.self, from: JSONSerialization.data(withJSONObject: json))
  }

  @Test("an idle agent with a pending continue shows it")
  func pending() throws {
    #expect(ChatInputView.pendingLimitResume(try status("idle", resumeAt: 1_000)) == 1_000)
  }

  @Test("a stopped agent's stale continue is hidden")
  func stopped() throws {
    #expect(ChatInputView.pendingLimitResume(try status("stopped", resumeAt: 1_000)) == nil)
    #expect(ChatInputView.pendingLimitResume(try status("error", resumeAt: 1_000)) == nil)
    #expect(ChatInputView.pendingLimitResume(nil) == nil)
  }
}
