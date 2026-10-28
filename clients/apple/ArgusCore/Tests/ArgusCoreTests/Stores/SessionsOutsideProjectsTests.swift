import ArgusCore
import ArgusKit
import Foundation
import Testing

/// An automation run's session lives in the run's own folder, which no
/// project lists — and the host refuses to list agents by a folder it has no
/// project for.
@MainActor
@Suite("Sessions outside projects")
struct SessionsOutsideProjectsTests {
  private static let runDir = "/Users/me/.argus/automation-runs/auto-1/run-1"
  private static let runSession = """
    {"id":"s-run","kind":"automation_host","branch":"","display_name":"Maestro E2E Triage",
    "description":"","path":"\(runDir)","repo_root":"\(runDir)","status":"ready"}
    """
  private static let agents =
    #"{"agents":[{"agent_id":"a-run","session_id":"s-run","status":"running","created_at":1}]}"#

  @Test("a run's agents are listed by session, so its running agent shows")
  func runAgentsBySession() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(command: "get_session", Self.runSession)
    backend.reply(.agentsList, Self.agents)
    await store.attach(backend)

    await store.adoptSession(id: "s-run")
    let session = try #require(store.adoptedSessions["s-run"])
    await store.loadAgents(repoRoot: session.repoRoot)

    let sent = try #require(backend.params(.agentsList))
    #expect(sent["session_id"] as? String == "s-run")
    #expect(sent["repo_root"] == nil)
    #expect(store.agentsByRepo[Self.runDir]?.map(\.agentId) == ["a-run"])
    #expect(store.repoRoot(forSessionId: "s-run") == Self.runDir)
  }

  @Test("a project's agents are still listed by repo")
  func projectAgentsByRepo() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.agentsList, #"{"agents":[]}"#)
    await store.attach(backend)

    await store.loadAgents(repoRoot: "/repo")

    let sent = try #require(backend.params(.agentsList))
    #expect(sent["repo_root"] as? String == "/repo")
    #expect(sent["session_id"] == nil)
  }

  @Test("a run is named for what it is, never its folder's run id")
  func placeName() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(command: "get_session", Self.runSession)
    await store.attach(backend)
    await store.adoptSession(id: "s-run")

    let session = try #require(store.adoptedSessions["s-run"])
    #expect(session.isOutsideProjects)
    #expect(store.placeName(of: session) == "Automation")
  }

  @Test("a saved chat an older host won't read says so instead of looking empty")
  func stoppedTranscriptRefused() async {
    let store = HostStore()
    let backend = FakeBackend()
    backend.fail(
      .agentsStoppedTranscript,
      with: Transport.TransportError.gateway(GatewayErrorPayload(code: "not_found", message: "unknown repo_root")))
    await store.attach(backend)

    let key = HostStore.stoppedKey(repoRoot: Self.runDir, historyId: "h1")
    await store.loadTranscript(agentId: key)

    #expect(store.visibleMessages(for: key).isEmpty)
    #expect(
      store.transcriptErrorByAgent[key]
        == "Reading chats saved outside a project needs a newer version of Argus on the host.")
  }
}
