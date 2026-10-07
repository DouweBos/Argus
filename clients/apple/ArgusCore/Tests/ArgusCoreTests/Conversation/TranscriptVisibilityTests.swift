import Foundation
import Testing

@testable import ArgusCore

// Distilled from a real transcript: 504 of 1,443 messages were thinking-only,
// and ToolSearch loading deferred tools rendered as empty cards.
private func msg(
  _ id: String = "m", role: ConversationRole = .assistant, text: [String] = [],
  calls: [ConversationToolCall] = [], images: [ConversationImage]? = nil
) -> ConversationMessage {
  ConversationMessage(id: id, role: role, textBlocks: text, toolCalls: calls, timestamp: 0, images: images)
}

private func call(
  _ id: String = "t", name: String? = "Bash", result: ConversationToolResult? = .text("ok"),
  pending: Bool? = nil, children: [ConversationToolCallChild]? = nil
) -> ConversationToolCall {
  ConversationToolCall(
    id: id, name: name, input: [:], children: children, pendingPermission: pending, result: result)
}

private let toolSearch = call("ts", name: "ToolSearch", result: .blocks([.object(["type": .string("text"), "text": .string("Read")])]))

@Suite struct TranscriptVisibilityTests {
  @Test func hidesThinkingOnlyTurnsAndStubs() {
    #expect(TranscriptVisibility.visibleMessage(msg(text: ["", " \n"])) == nil)
    #expect(TranscriptVisibility.visibleMessage(msg(text: ["No response requested."])) == nil)
  }

  @Test func hidesToolSearchAndKeepsTheRest() {
    #expect(TranscriptVisibility.visibleMessage(msg(calls: [toolSearch])) == nil)
    let bash = call()
    #expect(TranscriptVisibility.visibleMessage(msg(calls: [toolSearch, bash]))?.toolCalls == [bash])
    var pending = toolSearch
    pending.pendingPermission = true
    #expect(TranscriptVisibility.visibleMessage(msg(calls: [pending]))?.toolCalls == [pending])
  }

  @Test func keepsRealContentUntouched() {
    let m = msg(text: ["Done."], calls: [call(name: "ListAgents")])
    #expect(TranscriptVisibility.visibleMessage(m) == m)
    let image = msg(role: .user, text: [""], images: [ConversationImage(data: "x", mediaType: "image/png")])
    #expect(TranscriptVisibility.visibleMessage(image) == image)
  }

  @Test func dropsNamelessAndBlankChildren() {
    let read = call("r", name: "Read")
    let agent = call(
      name: "Agent",
      children: [.toolUse(call("", name: nil)), .text(" "), .toolUse(toolSearch), .toolUse(read), .text("Found it.")])
    let shown = TranscriptVisibility.visibleMessage(msg(calls: [agent]))
    #expect(shown?.toolCalls.first?.children == [.toolUse(read), .text("Found it.")])
  }

  @Test func marksResultlessCallsInterruptedOnceSettled() {
    let m = msg(calls: [call(result: nil)])
    #expect(TranscriptVisibility.visibleMessage(m) == m)
    let settled = TranscriptVisibility.visibleMessage(m, settled: true)?.toolCalls.first
    #expect(settled?.result == .text(TranscriptVisibility.interruptedResult))
    #expect(settled?.isError == true)
    let pending = msg(calls: [call(result: nil, pending: true)])
    #expect(TranscriptVisibility.visibleMessage(pending, settled: true) == pending)
  }

  @Test func pagesKeepRawCursors() throws {
    let conv = AgentConversation(messages: [msg("a", text: ["hi"]), msg("b"), msg("c", calls: [toolSearch])])
    let page = try RemoteTranscriptBuilder.transcript(conv, limit: 2)
    #expect(page.messages.isEmpty)
    #expect(page.prevBefore == 1)
    #expect(page.total == 3)
    #expect(try RemoteTranscriptBuilder.messages(conv).map(\.id) == ["a"])
  }
}
