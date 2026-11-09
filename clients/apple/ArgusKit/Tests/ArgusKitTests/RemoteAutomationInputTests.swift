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
    #expect(json?["run_at"] == nil)
  }

  @Test("a run-once trigger sends its time, and an unknown kind reads as manual")
  func onceTrigger() throws {
    let input = RemoteAutomationInput(
      RemoteAutomationDetail(name: "A", triggerKind: .once, runAt: "2026-11-10T09:00", playbook: "p"))
    let json = try JSONSerialization.jsonObject(with: ProtocolCodec.encoder.encode(input)) as? [String: Any]
    #expect(json?["trigger_kind"] as? String == "once")
    #expect(json?["run_at"] as? String == "2026-11-10T09:00")

    let kind = try ProtocolCodec.decoder.decode(
      [RemoteAutomation.TriggerKind].self, from: Data(#"["once","webhook"]"#.utf8))
    #expect(kind == [.once, .manual])
    #expect(OnceTime.date("2026-11-10T09:00", timezone: "UTC") == Date(timeIntervalSince1970: 1_794_301_200))
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
