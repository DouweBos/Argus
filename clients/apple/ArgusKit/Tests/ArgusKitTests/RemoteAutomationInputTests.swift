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
      [RemoteAutomation.TriggerKind].self, from: Data(#"["once","webhook","pigeon"]"#.utf8))
    #expect(kind == [.once, .webhook, .manual])
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

  @Test("a signal trigger sends its events, and a webhook only its mode and cap")
  func eventTriggers() throws {
    let signal = RemoteAutomationInput(
      RemoteAutomationDetail(
        name: "A", triggerKind: .signal,
        signal: .init(on: [.ciFailed, .mentioned], labels: ["bug"], fire: .batch, maxRunsPerHour: 6),
        playbook: "p"))
    let json = try JSONSerialization.jsonObject(with: ProtocolCodec.encoder.encode(signal)) as? [String: Any]
    let sent = json?["signal"] as? [String: Any]
    #expect(sent?["on"] as? [String] == ["ci_failed", "mentioned"])
    #expect(sent?["labels"] as? [String] == ["bug"])
    #expect(sent?["fire"] as? String == "batch")
    #expect(sent?["max_runs_per_hour"] as? Double == 6)
    #expect(json?["webhook"] == nil)

    let webhook = RemoteAutomationInput(
      RemoteAutomationDetail(
        name: "A", triggerKind: .webhook, webhook: .init(url: "https://x/hook", hasSecret: true), playbook: "p"))
    let hook = try JSONSerialization.jsonObject(with: ProtocolCodec.encoder.encode(webhook)) as? [String: Any]
    let sentHook = hook?["webhook"] as? [String: Any]
    #expect(sentHook?["fire"] as? String == "each")
    #expect(sentHook?["max_runs_per_hour"] as? Double == 4)
    #expect(sentHook?["url"] == nil && sentHook?["has_secret"] == nil)
    #expect(hook?["signal"] == nil)
  }

  @Test("an event kind this build doesn't know survives the round trip")
  func unknownEvent() throws {
    let detail = try ProtocolCodec.decoder.decode(
      RemoteAutomationSignal.self,
      from: Data(#"{"on":["new_pr","deploy_failed"],"labels":[],"fire":"each","max_runs_per_hour":4}"#.utf8))
    #expect(detail.on == [.newPr, RemoteSignalEvent(rawValue: "deploy_failed")])
    #expect(detail.on.map(\.label) == ["New pull request", "Deploy Failed"])
  }
}
