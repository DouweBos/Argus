import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Pinned chats")
struct PinnedChatsTests {
  private func attached(status: String = "idle", pinned: Bool = false) async -> (HostStore, FakeBackend) {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(
      .agentsStatus,
      #"{"agent":{"agent_id":"a-0","session_id":"s-1","status":"\#(status)","runner_session_id":"cli-0","pinned":\#(pinned)}}"#
    )
    backend.reply(
      .agentsStopped,
      #"{"agents":[{"history_id":"h1","runner_session_id":"r-1","title":"t","branch":"feat/a","message_count":1,"started_at":0,"ended_at":1}]}"#
    )
    await store.attach(backend)
    await store.loadAgentStatus(agentId: "a-0")
    return (store, backend)
  }

  @Test("pinning a live agent asks the host and shows what it answered")
  func pinsAgent() async throws {
    let (store, backend) = await attached()
    backend.reply(.agentsSetPinned, #"{"pinned":true}"#)
    #expect(store.canTogglePin(agentId: "a-0"))
    #expect(!store.isPinned(agentId: "a-0"))

    await store.setPinned(agentId: "a-0", pinned: true)

    let params = try #require(backend.params(.agentsSetPinned))
    #expect(params["agent_id"] as? String == "a-0")
    #expect(params["pinned"] as? Bool == true)
    #expect(store.isPinned(agentId: "a-0"))
  }

  @Test("a stopped agent can be unpinned, not pinned")
  func stoppedAgent() async {
    let (stopped, _) = await attached(status: "stopped")
    #expect(!stopped.canTogglePin(agentId: "a-0"))
    let (pinned, _) = await attached(status: "stopped", pinned: true)
    #expect(pinned.canTogglePin(agentId: "a-0"))
  }

  @Test("a refused pin leaves the agent as it was")
  func refused() async {
    let (store, backend) = await attached()
    backend.fail(.agentsSetPinned)

    await store.setPinned(agentId: "a-0", pinned: true)

    #expect(!store.isPinned(agentId: "a-0"))
  }

  @Test("pinning a saved chat names it by repo and history id")
  func pinsSavedChat() async throws {
    let (store, backend) = await attached()
    backend.reply(.agentsSetPinned, #"{"pinned":true}"#)
    await store.loadStoppedAgents(repoRoot: "/repo")
    let chat = try #require(store.stoppedChat(repoRoot: "/repo", historyId: "h1"))

    await store.setPinned(chat: chat, repoRoot: "/repo", pinned: true)

    let params = try #require(backend.params(.agentsSetPinned))
    #expect(params["repo_root"] as? String == "/repo")
    #expect(params["history_id"] as? String == "h1")
    #expect(store.stoppedChat(repoRoot: "/repo", historyId: "h1")?.isPinned == true)
  }

  @Test("resuming a pinned agent by hand moves the pin to the new one")
  func resumeMovesPin() async {
    let (store, backend) = await attached(status: "stopped", pinned: true)
    backend.reply(
      .agentsSpawn, #"{"agent":{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1,"pinned":true}}"#)

    let resumed = await store.resumeAgent("a-0")

    #expect(resumed?.isPinned == true)
    #expect(!store.isPinned(agentId: "a-0"))
  }
}
