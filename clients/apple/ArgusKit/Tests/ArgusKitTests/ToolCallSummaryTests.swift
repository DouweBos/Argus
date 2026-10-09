import XCTest

@testable import ArgusKit

final class ToolCallSummaryTests: XCTestCase {
  private func call(_ id: String, _ name: String, children: [RemoteToolCallChild]? = nil) -> RemoteToolCall {
    RemoteToolCall(
      id: id, name: name, input: [:], resultBlocks: [], children: children, status: .running)
  }

  func testPreviewKeepsTheNewestCallsAndCountsTheRest() {
    let children: [RemoteToolCallChild] =
      [.text("Looking around.")] + (1...8).map { .toolUse(call("c\($0)", "Read")) }
    let preview = ToolCallSummary.subagentPreview(call("a", "Agent", children: children))
    XCTAssertEqual(preview.calls.map(\.id), ["c4", "c5", "c6", "c7", "c8"])
    XCTAssertEqual(preview.earlier, 3)
  }

  func testPreviewOfASubagentWithNoCallsIsEmpty() {
    let preview = ToolCallSummary.subagentPreview(call("a", "Agent", children: [.text("Thinking.")]))
    XCTAssertTrue(preview.calls.isEmpty)
    XCTAssertEqual(preview.earlier, 0)
  }

  func testAnAgentCallGoesByItsSubagentType() {
    XCTAssertEqual(ToolCallSummary.label(name: "Agent", input: ["subagent_type": .string("Explore")]), "Explore")
    XCTAssertEqual(ToolCallSummary.label(name: "Agent", input: [:]), "Agent")
    XCTAssertEqual(ToolCallSummary.label(name: "Read", input: [:]), "Read")
  }
}
