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

  private func user(_ id: String) -> RemoteMessage {
    RemoteMessage(id: id, role: .user, textBlocks: ["do it"], toolCalls: [])
  }

  func testTurnsFoldWorkAndKeepTheReply() {
    let segments = ToolGroups.groupTurns([
      user("u"), message("1", text: ["Let me look"]), message("2", tools: ["Read"]),
      message("3", tools: ["Edit"]), message("r", text: ["Done"]),
    ])
    XCTAssertEqual(segments.map(\.id), ["u", "group-1", "r"])
    guard case .collapsed(let work) = segments[1] else { return XCTFail("not folded") }
    XCTAssertEqual(work.map(\.id), ["1", "2", "3"])
  }

  func testTurnsLeaveTextOnlyTurnsAlone() {
    let segments = ToolGroups.groupTurns([user("u"), message("1", text: ["Hi"]), message("2", text: ["There"])])
    XCTAssertEqual(segments.map(\.id), ["u", "1", "2"])
  }

  func testTurnsKeepErrorsAndDecisionsOpen() {
    var pending = message("p", tools: ["Bash"])
    pending.toolCalls[0].status = .pending
    var error = message("e", text: ["boom"])
    error.isError = true
    let segments = ToolGroups.groupTurns([
      user("u"), message("1", tools: ["Read"]), error, message("2", tools: ["Bash"]), pending,
    ])
    XCTAssertEqual(segments.map(\.id), ["u", "group-1", "e", "group-2", "p"])
  }

  func testTurnsFoldARunningTurnWhole() {
    let segments = ToolGroups.groupTurns([
      user("u"), message("1", tools: ["Read"]), user("v"), message("2", text: ["Ok"]),
      message("3", tools: ["Bash"]),
    ])
    XCTAssertEqual(segments.map(\.id), ["u", "group-1", "v", "group-2"])
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
