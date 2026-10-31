import ArgusCore
import Foundation
import Testing

@testable import ArgusUI

@Suite("Work log label")
struct WorkLogLabelTests {
  private func tool(_ id: String, at time: Double?) -> RemoteMessage {
    let stamp = time.map { #","timestamp":\#($0)"# } ?? ""
    let json =
      #"{"id":"\#(id)","role":"assistant","text_blocks":[],"tool_calls":[{"id":"c-\#(id)","name":"Read","input":{},"result_blocks":[],"status":"done"}]\#(stamp)}"#
    return try! JSONDecoder().decode(RemoteMessage.self, from: Data(json.utf8))
  }

  private let now = Date(timeIntervalSince1970: 1_000)

  @Test("finished work reads as its span")
  func worked() {
    let log = WorkLog(id: "l", messages: [tool("a", at: 10_000)], started: 1_000, ended: 330_000)
    #expect(log.label(working: false, now: now) == "Worked for 5m 29s")
  }

  @Test("work still going counts up from the turn's start")
  func working() {
    let log = WorkLog(id: "l", messages: [tool("a", at: 900_000)], started: 988_000)
    #expect(log.label(working: true, now: now) == "Working for 12s")
    #expect(WorkLog(id: "l", messages: []).label(working: true, now: now) == "Working…")
  }

  @Test("no span falls back to its own messages, then the call count")
  func fallback() {
    let spanned = WorkLog(id: "l", messages: [tool("a", at: 1_000), tool("b", at: 4_000)])
    #expect(spanned.label(working: false, now: now) == "Worked for 3s")
    let bare = WorkLog(id: "l", messages: [tool("a", at: nil)])
    #expect(bare.label(working: false, now: now) == "1 tool call")
    #expect(WorkLog(id: "l", messages: [tool("a", at: 1), tool("b", at: 1)]).callCountLabel == "2 tool calls")
  }

  @Test("background work still running is appended")
  func stillRunning() {
    let log = WorkLog(
      id: "l", messages: [tool("a", at: nil)], started: 1_000, ended: 3_000, stillRunning: "1 agent still running")
    #expect(log.label(working: false, now: now) == "Worked for 2s · 1 agent still running")
  }
}
