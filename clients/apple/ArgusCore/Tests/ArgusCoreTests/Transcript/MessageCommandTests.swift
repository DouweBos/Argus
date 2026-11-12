import Testing

@testable import ArgusCore

@Suite("MessageCommand")
struct MessageCommandTests {
  @Test("the bubble shows the arguments under the chip, copy keeps what was typed")
  func body() {
    var message = RemoteMessage(id: "m", role: .user, textBlocks: ["/compact keep the plan"])
    #expect(message.bodyBlocks == ["/compact keep the plan"])
    message.command = RemoteMessageCommand(name: "compact", args: "keep the plan")
    #expect(message.command?.label == "/compact")
    #expect(message.bodyBlocks == ["keep the plan"])
    #expect(message.copyText == "/compact keep the plan")
    message.command = RemoteMessageCommand(name: "review")
    #expect(message.bodyBlocks.isEmpty)
  }
}
