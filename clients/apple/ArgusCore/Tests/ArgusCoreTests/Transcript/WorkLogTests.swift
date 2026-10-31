import ArgusCore
import Foundation
import Testing

@Suite("Work logs")
struct WorkLogTests {
  private func user(_ id: String, at time: Double? = nil, _ body: String = "do it") -> RemoteMessage {
    RemoteMessage(id: id, role: .user, textBlocks: [body], timestamp: time)
  }

  private func reply(_ id: String, at time: Double? = nil, _ body: String = "done") -> RemoteMessage {
    RemoteMessage(id: id, role: .assistant, textBlocks: [body], timestamp: time)
  }

  private func tool(
    _ id: String, at time: Double? = nil, background: String? = nil, text: String? = nil, name: String = "Agent"
  ) -> RemoteMessage {
    let bg = background.map { #","background":{"status":"\#($0)","started_at":1000}"# } ?? ""
    let stamp = time.map { #","timestamp":\#($0)"# } ?? ""
    let blocks = text.map { #"["\#($0)"]"# } ?? "[]"
    let json =
      #"{"id":"\#(id)","role":"assistant","text_blocks":\#(blocks),"tool_calls":[{"id":"c-\#(id)","name":"\#(name)","input":{},"result_blocks":[],"status":"done"\#(bg)}]\#(stamp)}"#
    return try! JSONDecoder().decode(RemoteMessage.self, from: Data(json.utf8))
  }

  private func logs(_ messages: [RemoteMessage]) -> [WorkLog] {
    var items = TranscriptItems()
    items.update(messages)
    return items.items.compactMap {
      if case .work(let log) = $0 { return log }
      return nil
    }
  }

  @Test("a log spans from the message before it to the reply after")
  func span() {
    let log = logs([user("u", at: 1000), tool("a", at: 2000), tool("b", at: 3000), reply("r", at: 9000)])
    #expect(log.map(\.id) == ["group-a"])
    #expect(log[0].started == 1000)
    #expect(log[0].ended == 9000)
    #expect(log[0].messages.map(\.id) == ["a", "b"])
  }

  @Test("the newest work has no end yet")
  func open() {
    let log = logs([user("u", at: 1000), tool("a", at: 2000)])
    #expect(log[0].ended == nil)
  }

  @Test("work cut off by the next user message ends at its own last message")
  func interrupted() {
    let log = logs([user("u", at: 1000), tool("a", at: 2000), tool("b", at: 3000), user("v", at: 8000)])
    #expect(log[0].ended == 3000)
  }

  @Test("the first log in a chat has no start")
  func noStart() {
    #expect(logs([tool("a", at: 2000), reply("r", at: 3000)])[0].started == nil)
  }

  @Test("background work anywhere in the turn counts, the next turn's doesn't")
  func stillRunning() {
    let log = logs([
      user("u"), tool("a", background: "running"), reply("r"),
      user("v"), tool("b", background: "running"), tool("c", background: "running"),
    ])
    #expect(log.map(\.stillRunning) == ["1 agent still running", "2 agents still running"])
    #expect(logs([user("u"), tool("a", background: "completed"), reply("r")])[0].stillRunning == nil)
  }

  @Test("a run fold has no work log")
  func runs() {
    var items = TranscriptItems(folding: .runs)
    items.update([tool("a", name: "Read"), tool("b", name: "Read")])
    #expect(items.items == [.run(items.segments.segments[0].messages)])
  }

  @Test("a reply landing after the log gives it an end")
  func replyEnds() {
    var items = TranscriptItems()
    var messages = [user("u", at: 1000), tool("a", at: 2000), tool("b", at: 3000)]
    items.update(messages)
    messages.append(reply("r", at: 7000))
    let change = items.update(messages)
    #expect(change.reloaded.contains(1))
    guard case .work(let log) = items.items[1] else { Issue.record("no work log"); return }
    #expect(log.ended == 7000)
  }

  @Test("a background task settling in the reply reloads the turn's log")
  func settles() {
    var items = TranscriptItems()
    items.update([user("u"), tool("a"), tool("b", background: "running"), reply("r")])
    let change = items.update([user("u"), tool("a"), tool("b", background: "completed"), reply("r")])
    #expect(change.reloaded.contains(1))
    guard case .work(let log) = items.items[1] else { Issue.record("no work log"); return }
    #expect(log.stillRunning == nil)
  }

  @Test("incremental rows always match a fresh build", arguments: 0..<30)
  func matchesFresh(seed: Int) {
    var generator = SeededGenerator(seed: UInt64(seed + 1))
    var items = TranscriptItems()
    var messages: [RemoteMessage] = []
    for step in 0..<40 {
      let time = Double(step * 1000)
      switch Int.random(in: 0..<6, using: &generator) {
      case 0: messages.append(user("u\(step)", at: time))
      case 1: messages.append(reply("r\(step)", at: time))
      case 2: messages.append(tool("t\(step)", at: time, background: "running"))
      case 3 where !messages.isEmpty:
        let index = Int.random(in: 0..<messages.count, using: &generator)
        messages[index] = tool(messages[index].id, at: time, background: "completed")
      case 4 where messages.count > 3:
        messages.removeFirst(2)
      default: messages.append(tool("t\(step)", at: time, text: "looking"))
      }
      items.update(messages)
      var fresh = TranscriptItems()
      fresh.update(messages)
      #expect(items.items == fresh.items)
    }
  }
}

@Suite("Message display text")
struct MessageDisplayTextTests {
  @Test("blank blocks are dropped")
  func blank() {
    let message = RemoteMessage(id: "a", role: .assistant, textBlocks: ["hi", "  \n", "there"])
    #expect(message.displayBlocks == ["hi", "there"])
  }

  @Test("the linked-projects preamble is stripped from the user's words")
  func preamble() {
    let text = LinkedProjects.buildPreamble(paths: ["/repo/a"], message: "look here")
    #expect(RemoteMessage(id: "u", role: .user, textBlocks: [text]).displayBlocks == ["look here"])
  }

  @Test("a message that only links projects has nothing to show")
  func linkOnly() {
    let text = LinkedProjects.buildPreamble(paths: ["/repo/a"], message: "")
    #expect(RemoteMessage(id: "u", role: .user, textBlocks: [text]).displayBlocks.isEmpty)
  }
}

private struct SeededGenerator: RandomNumberGenerator {
  var state: UInt64
  init(seed: UInt64) { state = seed }
  mutating func next() -> UInt64 {
    state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return state ^ (state >> 33)
  }
}
