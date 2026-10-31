import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Message actions")
struct MessageActionsTests {
  private static let preamble = LinkedProjects.buildPreamble(paths: ["/repo/other"], message: "")

  private static func message(_ text: String, role: RemoteMessageRole = .user) -> RemoteMessage {
    RemoteMessage(id: "m-1", role: role, textBlocks: [text], toolCalls: [])
  }

  @Test("copy and edit see the words, not the linked-projects preamble")
  func textWithoutPreamble() {
    let message = Self.message(Self.preamble + "fix the bug")
    #expect(message.copyText == "fix the bug")
    #expect(message.editableText == "fix the bug")
    #expect(Self.message("  \n").copyText == nil)
  }

  @Test("an edit goes back with the preamble it came with")
  func rewindRestoresPreamble() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.agentsRewind, #"{"accepted":true}"#)
    await store.attach(backend)

    try await store.rewind(agentId: "a-1", message: Self.message(Self.preamble + "old"), edited: "new")

    let params = try #require(backend.params(.agentsRewind))
    #expect(params["agent_id"] as? String == "a-1")
    #expect(params["message_id"] as? String == "m-1")
    #expect(params["text"] as? String == Self.preamble + "new")
  }

  @Test("a fork leaves a blank branch for the host to name")
  func forkSendsTarget() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(
      .agentsFork, #"{"session_id":"s-2","agent":{"agent_id":"a-2","session_id":"s-2","status":"idle","created_at":1}}"#)
    await store.attach(backend)

    let forked = try await store.fork(
      agentId: "a-1", message: Self.message("hi"), into: .session, description: " try it ", branch: "  ")

    let params = try #require(backend.params(.agentsFork))
    #expect(params["into"] as? String == "session")
    #expect(params["description"] as? String == "try it")
    #expect(params["branch"] == nil)
    #expect(forked.sessionId == "s-2")
    #expect(store.statusByAgent["a-2"] != nil)
  }

  @Test("a refused rewind throws for the sheet to show")
  func rewindThrows() async {
    let store = HostStore()
    let backend = FakeBackend()
    backend.fail(.agentsRewind)
    await store.attach(backend)

    await #expect(throws: (any Error).self) {
      try await store.rewind(agentId: "a-1", message: Self.message("old"), edited: "new")
    }
  }
}
