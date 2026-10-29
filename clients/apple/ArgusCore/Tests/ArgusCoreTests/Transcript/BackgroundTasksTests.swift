import ArgusCore
import Foundation
import Testing

@Suite("Background tasks")
struct BackgroundTasksTests {
  private func message(_ calls: [(name: String, background: String?)]) -> RemoteMessage {
    let json = calls.enumerated().map { index, call in
      let background = call.background.map { #","background":{"status":"\#($0)","started_at":1000,"duration_ms":5000}"# } ?? ""
      return #"{"id":"c\#(index)","name":"\#(call.name)","input":{},"result_blocks":[],"status":"done"\#(background)}"#
    }.joined(separator: ",")
    let body = #"{"id":"m","role":"assistant","text_blocks":[],"tool_calls":[\#(json)]}"#
    return try! JSONDecoder().decode(RemoteMessage.self, from: Data(body.utf8))
  }

  @Test("a background call decodes with its timing")
  func decodes() {
    let call = message([("Agent", "completed")]).toolCalls[0]
    #expect(call.background == RemoteBackgroundTask(status: .completed, startedAt: 1000, durationMs: 5000))
  }

  @Test("an unknown status still settles the task")
  func unknownStatus() {
    #expect(message([("Bash", "killed")]).toolCalls[0].background?.status == .stopped)
  }

  @Test("only calls still running in the background count")
  func running() {
    let messages = [message([("Agent", "running"), ("Agent", "completed"), ("Read", nil)])]
    #expect(BackgroundTasks.running(in: messages).map(\.id) == ["c0"])
  }

  @Test("labels name agents, else background tasks")
  func labels() {
    let agents = BackgroundTasks.running(in: [message([("Agent", "running"), ("Task", "running")])])
    #expect(BackgroundTasks.stillRunningLabel(Array(agents.prefix(1))) == "1 agent still running")
    #expect(BackgroundTasks.stillRunningLabel(agents) == "2 agents still running")
    let mixed = BackgroundTasks.running(in: [message([("Agent", "running"), ("Bash", "running")])])
    #expect(BackgroundTasks.stillRunningLabel(mixed) == "2 background tasks still running")
    #expect(BackgroundTasks.stillRunningLabel([]) == nil)
  }
}
