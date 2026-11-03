import Foundation
import Testing

@testable import ArgusKit

@Suite("Automation input")
struct RemoteAutomationInputTests {
  @Test("inherit and the default model go out as null, which create requires")
  func nullsAreSent() throws {
    let input = RemoteAutomationInput(RemoteAutomationDetail(name: "A", playbook: "p"))
    let json = try JSONSerialization.jsonObject(with: ProtocolCodec.encoder.encode(input)) as? [String: Any]
    #expect(json?["autonomy"] is NSNull)
    #expect(json?["model"] is NSNull)
    #expect(json?["extra_instructions"] == nil)
    #expect(json?["trigger_kind"] as? String == "schedule")
    #expect(json?["claude_account_id"] is NSNull)
  }

  @Test("a computer from before account pins reads as unpinned, and a pin round-trips")
  func accountPin() throws {
    var old = try JSONSerialization.jsonObject(
      with: ProtocolCodec.encoder.encode(RemoteAutomationDetail(name: "A", claudeAccountId: "x"))
    ) as? [String: Any] ?? [:]
    old["claude_account_id"] = nil
    let detail = try ProtocolCodec.decoder.decode(
      RemoteAutomationDetail.self, from: JSONSerialization.data(withJSONObject: old))
    #expect(detail.claudeAccountId == nil)

    let pinned = RemoteAutomationInput(RemoteAutomationDetail(name: "A", claudeAccountId: "work"))
    let json = try JSONSerialization.jsonObject(with: ProtocolCodec.encoder.encode(pinned)) as? [String: Any]
    #expect(json?["claude_account_id"] as? String == "work")
  }
}
