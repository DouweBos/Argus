import ArgusCore
import ArgusKit
import Foundation
import Testing

/// A spawned agent's tab mustn't depend on its `agent:started` event arriving.
@MainActor
@Suite("Spawning lists the agent")
struct SpawnListsAgentTests {
  private static let runDir = "/Users/me/.argus/automation-runs/auto-1/run-1"
  private static let session = """
    {"id":"s-1","kind":"automation_host","branch":"","display_name":"Run",
    "description":"","path":"\(runDir)","repo_root":"\(runDir)","status":"ready"}
    """
  private static let agent = #"{"agent_id":"a-new","session_id":"s-1","status":"idle","created_at":1}"#

  @Test("a spawn lists the session's agents without waiting for the event")
  func spawnReloadsAgents() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(command: "get_session", Self.session)
    backend.reply(.agentsSpawn, #"{"agent":\#(Self.agent)}"#)
    backend.reply(.agentsList, #"{"agents":[\#(Self.agent)]}"#)
    await store.attach(backend)
    await store.adoptSession(id: "s-1")

    _ = await store.spawnAgent(sessionId: "s-1")

    #expect(store.agentsByRepo[Self.runDir]?.map(\.agentId) == ["a-new"])
  }
}
