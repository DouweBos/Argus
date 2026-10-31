import ArgusCore
import Foundation
import Testing

@Suite("Pending prompts")
struct PendingPromptsTests {
  private func message(_ id: String, calls: [(id: String, name: String, input: String)]) -> RemoteMessage {
    let toolCalls = calls.map {
      #"{"id":"\#($0.id)","name":"\#($0.name)","input":\#($0.input),"result_blocks":[],"status":"pending"}"#
    }
    let json =
      #"{"id":"\#(id)","role":"assistant","text_blocks":[],"tool_calls":[\#(toolCalls.joined(separator: ","))]}"#
    return try! JSONDecoder().decode(RemoteMessage.self, from: Data(json.utf8))
  }

  private func call(_ name: String, _ input: String = "{}") -> RemoteToolCall {
    message("m", calls: [("c", name, input)]).toolCalls[0]
  }

  @Test("collects pending calls in order and skips answered ones")
  func collects() {
    let messages = [
      message("a", calls: [("1", "Bash", "{}"), ("2", "Read", "{}")]),
      message("b", calls: [("3", "Edit", "{}")]),
    ]
    let pending = PendingPrompts.calls(in: messages) { $0.id != "2" }
    #expect(pending.map(\.id) == ["1", "3"])
  }

  @Test("only walks the tail of the transcript")
  func window() {
    let messages = (0..<50).map { message("m\($0)", calls: [("c\($0)", "Bash", "{}")]) }
    let pending = PendingPrompts.calls(in: messages) { _ in true }
    #expect(pending.count == 40)
    #expect(pending.first?.id == "c10")
  }

  @Test("titles follow the form the call gets")
  func titles() {
    #expect(PendingPrompts.title(for: call("Bash")) == "Permission needed")
    #expect(PendingPrompts.title(for: call("ExitPlanMode", #"{"plan":"Do it"}"#)) == "Plan ready for review")
    let question = #"{"questions":[{"question":"Which database?","header":"Storage","options":[{"label":"Postgres"}]}]}"#
    #expect(PendingPrompts.title(for: call("AskUserQuestion", question)) == "Question from the agent")
  }
}
