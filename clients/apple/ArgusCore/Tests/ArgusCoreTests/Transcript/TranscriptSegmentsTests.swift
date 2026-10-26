import ArgusCore
import Foundation
import Testing

@Suite("Transcript segments")
struct TranscriptSegmentsTests {
  private func text(_ id: String, _ body: String = "hi") -> RemoteMessage {
    RemoteMessage(id: id, role: .assistant, textBlocks: [body], toolCalls: [])
  }

  private func tool(_ id: String, _ name: String = "Read") -> RemoteMessage {
    let json = #"{"id":"\#(id)","role":"assistant","text_blocks":[],"tool_calls":[{"id":"c-\#(id)","name":"\#(name)","input":{},"result_blocks":[],"status":"done"}]}"#
    return try! JSONDecoder().decode(RemoteMessage.self, from: Data(json.utf8))
  }

  private func hidden(_ id: String) -> RemoteMessage {
    RemoteMessage(id: id, role: .assistant, textBlocks: [], toolCalls: [])
  }

  private func expectMatchesFullGrouping(_ segments: TranscriptSegments, _ messages: [RemoteMessage]) {
    let full = ToolGroups.group(messages)
    #expect(segments.segments.map(\.id) == full.map(\.id))
    #expect(segments.segments.map(\.messages) == full.map(\.messages))
  }

  @Test("appending to a tool run reloads the group instead of rebuilding")
  func appendToRun() {
    var segments = TranscriptSegments()
    var messages = [text("a"), tool("b"), tool("c")]
    segments.update(messages)
    messages.append(tool("d"))
    let change = segments.update(messages)
    expectMatchesFullGrouping(segments, messages)
    #expect(change.removed.isEmpty && change.inserted.isEmpty)
    #expect(change.reloaded == [1])
  }

  @Test("streaming into the last message reloads one segment")
  func streamLast() {
    var segments = TranscriptSegments()
    var messages = (0..<50).map { text("m\($0)") }
    segments.update(messages)
    messages[49] = text("m49", "hi there")
    let change = segments.update(messages)
    #expect(change.removed.isEmpty && change.inserted.isEmpty)
    #expect(change.reloaded == [49])
  }

  @Test("an older page prepends rows and leaves the rest alone")
  func prependPage() {
    var segments = TranscriptSegments()
    let tail = (10..<20).map { text("m\($0)") }
    segments.update(tail)
    let page = (0..<10).map { text("m\($0)") }
    let change = segments.update(page + tail)
    expectMatchesFullGrouping(segments, page + tail)
    #expect(change.removed == 0..<0)
    #expect(change.inserted == 0..<10)
    #expect(change.reloaded.isEmpty)
  }

  @Test("a page whose last tool call joins the first run above merges them")
  func prependJoinsRun() {
    var segments = TranscriptSegments()
    let tail = [tool("t1"), tool("t2"), text("x")]
    segments.update(tail)
    let all = [text("a"), tool("t0")] + tail
    segments.update(all)
    expectMatchesFullGrouping(segments, all)
    #expect(segments.segments.map(\.id) == ["a", "group-t0", "x"])
  }

  @Test("finds the segment holding a message folded into a group")
  func holding() {
    var segments = TranscriptSegments()
    segments.update([text("a"), tool("b"), hidden("h"), tool("c"), text("d")])
    #expect(segments.segmentIndex(holding: "c") == 1)
    #expect(segments.segmentIndex(holding: "d") == 2)
    #expect(segments.segmentIndex(holding: "h") == nil)
  }

  private func user(_ id: String) -> RemoteMessage {
    RemoteMessage(id: id, role: .user, textBlocks: ["go"], toolCalls: [])
  }

  @Test("a reply landing after a turn's work keeps the work folded")
  func turnReply() {
    var segments = TranscriptSegments(folding: .turns)
    var messages = [user("u"), text("a", "looking"), tool("b")]
    segments.update(messages)
    #expect(segments.segments.map(\.id) == ["u", "group-a"])
    messages.append(text("r", "done"))
    let change = segments.update(messages)
    #expect(segments.segments.map(\.id) == ["u", "group-a", "r"])
    #expect(change.removed.isEmpty && change.inserted == 2..<3)
  }

  @Test(
    "random edits always match grouping the whole chat",
    arguments: [ToolGroups.Folding.runs, .turns])
  func randomEdits(folding: ToolGroups.Folding) {
    var rng = SystemRandomNumberGenerator()
    for _ in 0..<200 {
      var segments = TranscriptSegments(folding: folding)
      var messages: [RemoteMessage] = []
      var next = 0
      func make() -> RemoteMessage {
        next += 1
        switch Int.random(in: 0..<7, using: &rng) {
        case 0, 1: return text("n\(next)")
        case 2: return hidden("n\(next)")
        case 3: return tool("n\(next)", "Edit")
        case 4: return user("n\(next)")
        default: return tool("n\(next)")
        }
      }
      for _ in 0..<30 {
        let before = segments.segments
        switch Int.random(in: 0..<6, using: &rng) {
        case 0: messages.append(contentsOf: (0..<Int.random(in: 1...4, using: &rng)).map { _ in make() })
        case 1: messages.insert(contentsOf: (0..<Int.random(in: 1...12, using: &rng)).map { _ in make() }, at: 0)
        case 2 where !messages.isEmpty:
          let index = Int.random(in: 0..<messages.count, using: &rng)
          let replacement = make()
          messages[index] = RemoteMessage(
            id: messages[index].id, role: replacement.role, textBlocks: replacement.textBlocks,
            toolCalls: replacement.toolCalls)
        case 3 where !messages.isEmpty:
          messages.remove(at: Int.random(in: 0..<messages.count, using: &rng))
        case 4 where !messages.isEmpty:
          messages.insert(make(), at: Int.random(in: 0..<messages.count, using: &rng))
        default: messages.append(make())
        }
        let change = segments.update(messages)
        if folding == .turns {
          let full = ToolGroups.groupTurns(messages)
          #expect(segments.segments.map(\.id) == full.map(\.id))
          #expect(segments.segments.map(\.messages) == full.map(\.messages))
        } else {
          expectMatchesFullGrouping(segments, messages)
        }
        // The change, applied to the old ids, gives the new ones.
        var ids = before.map(\.id)
        ids.replaceSubrange(change.removed, with: segments.segments[change.inserted].map(\.id))
        #expect(ids == segments.segments.map(\.id))
      }
    }
  }
}
