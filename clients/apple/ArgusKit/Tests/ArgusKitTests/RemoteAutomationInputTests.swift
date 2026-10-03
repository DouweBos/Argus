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
  }
}
