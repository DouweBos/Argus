import XCTest

@testable import ArgusKit

final class ToolGroupsTests: XCTestCase {
  private func message(_ id: String, text: [String] = [], tools: [String] = []) -> RemoteMessage {
    RemoteMessage(
      id: id, role: .assistant, textBlocks: text,
      toolCalls: tools.enumerated().map { i, name in
        RemoteToolCall(
          id: "\(id)-\(i)", name: name, input: [:], resultBlocks: [], status: .done)
      })
  }

  func testDropsMessagesWithNothingToShow() {
    let segments = ToolGroups.group([message("a", text: ["hi"]), message("b", text: ["  "])])
    XCTAssertEqual(segments.map(\.id), ["a"])
  }

  func testEmptyMessagesDoNotSplitAToolRun() {
    let segments = ToolGroups.group([
      message("1", tools: ["Bash"]), message("e1"),
      message("2", tools: ["Bash"]), message("e2"),
      message("3", tools: ["Bash"]),
    ])
    XCTAssertEqual(segments.map(\.id), ["group-1"])
  }
}
