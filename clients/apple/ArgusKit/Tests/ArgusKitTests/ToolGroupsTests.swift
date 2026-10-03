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

  func testNeverFoldsACallAwaitingApproval() {
    var pending = message("2", tools: ["Bash"])
    pending.toolCalls[0].status = .pending
    let segments = ToolGroups.group([
      message("1", tools: ["Bash"]), pending, message("3", tools: ["Bash"]),
      message("4", tools: ["Bash"]),
    ])
    XCTAssertEqual(segments.map(\.id), ["1", "2", "group-3"])
  }

  func testFoldsAPairButLeavesALoneCall() {
    let segments = ToolGroups.group([
      message("1", tools: ["Bash"]), message("2", tools: ["Read"]), message("t", text: ["done"]),
      message("3", tools: ["Bash"]),
    ])
    XCTAssertEqual(segments.map(\.id), ["group-1", "t", "3"])
  }

  func testNeverFoldsAPushNotification() {
    let segments = ToolGroups.group([
      message("1", tools: ["Bash"]), message("2", tools: ["mcp__argus__push_notification"]),
      message("3", tools: ["Bash"]),
    ])
    XCTAssertEqual(segments.map(\.id), ["1", "2", "3"])
  }

  func testHoistsImageReadsOnlyWhenTheyShowOpen() {
    var image = message("2", tools: ["Read"])
    image.toolCalls[0].resultBlocks = [.image(imageId: "img", mediaType: "image/png")]
    let run = [message("1", tools: ["Bash"]), image, message("3", tools: ["Bash"])]

    XCTAssertEqual(ToolGroups.group(run).map(\.id), ["group-1"])
    XCTAssertEqual(ToolGroups.group(run, hoistImageReads: true).map(\.id), ["1", "2", "3"])
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
