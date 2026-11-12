import Foundation
import Testing

@testable import ArgusKit

@Suite("RemoteMessage command")
struct RemoteMessageCommandTests {
  @Test("decodes a runner command and leaves plain messages without one")
  func decodes() throws {
    let json = """
      [{"id":"m1","role":"user","text_blocks":["/compact keep the plan"],"tool_calls":[],
        "command":{"name":"compact","args":"keep the plan"}},
       {"id":"m2","role":"user","text_blocks":["/nope"],"tool_calls":[]}]
      """
    let messages = try JSONDecoder().decode([RemoteMessage].self, from: Data(json.utf8))
    #expect(messages[0].command == RemoteMessageCommand(name: "compact", args: "keep the plan"))
    #expect(messages[1].command == nil)
  }
}
