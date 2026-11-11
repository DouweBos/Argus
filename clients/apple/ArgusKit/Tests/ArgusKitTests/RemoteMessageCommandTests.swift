import Foundation
import Testing

@testable import ArgusKit

@Suite("RemoteMessage command")
struct RemoteMessageCommandTests {
  @Test("decodes a recognized command and leaves plain messages without one")
  func decodes() throws {
    let json = """
      [{"id":"m1","role":"user","text_blocks":["/implement-ticket ENG-1 hi"],"tool_calls":[],
        "command":{"name":"implement-ticket","kind":"argus","argument":"ENG-1","notes":"hi","prompt":"# Implement"}},
       {"id":"m2","role":"user","text_blocks":["/nope"],"tool_calls":[]}]
      """
    let messages = try JSONDecoder().decode([RemoteMessage].self, from: Data(json.utf8))
    #expect(
      messages[0].command
        == RemoteMessageCommand(
          name: "implement-ticket", kind: .argus, argument: "ENG-1", notes: "hi", prompt: "# Implement"))
    #expect(messages[1].command == nil)
  }
}
