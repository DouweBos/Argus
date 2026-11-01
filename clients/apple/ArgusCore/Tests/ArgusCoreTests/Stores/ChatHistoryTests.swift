import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Chat history")
struct ChatHistoryTests {
  private static let session = try! ProtocolCodec.decoder.decode(
    RemoteSession.self,
    from: Data(
      #"{"id":"s-1","kind":"worktree","branch":"feat/a","display_name":"A","description":"","path":"/wt/a","repo_root":"/repo","status":"ready"}"#
        .utf8))

  private static func chat(_ id: String, branch: String, ended: Int, title: String = "chat") -> String {
    #"{"history_id":"\#(id)","runner_session_id":"r-\#(id)","title":"\#(title)","branch":"\#(branch)","message_count":2,"started_at":0,"ended_at":\#(ended),"runner_id":"codex","model":"haiku","permission_mode":"plan","effort":"low"}"#
  }

  private func attached() async -> (HostStore, FakeBackend) {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(
      .agentsStopped,
      #"{"agents":[\#(Self.chat("h1", branch: "feat/a", ended: 1)),\#(Self.chat("h2", branch: "main", ended: 3)),\#(Self.chat("h3", branch: "feat/a", ended: 2, title: "Login fix"))]}"#
    )
    await store.attach(backend)
    return (store, backend)
  }

  @Test("a session's chats are its branch's, newest first")
  func listsByBranch() async throws {
    let (store, _) = await attached()
    let chats = try #require(await store.chatHistory(for: Self.session))
    #expect(chats.map(\.historyId) == ["h3", "h1"])
  }

  @Test("titles narrow at once; the host's hits take over for their query")
  func filters() async throws {
    let (store, _) = await attached()
    let chats = try #require(await store.chatHistory(for: Self.session))
    #expect(HostStore.filterChats(chats, query: "login", hits: nil).map(\.historyId) == ["h3"])
    #expect(HostStore.filterChats(chats, query: "login", hits: ("login", ["h1": []])).map(\.historyId) == ["h1"])
    #expect(HostStore.filterChats(chats, query: "login", hits: ("log", ["h1": []])).map(\.historyId) == ["h3"])
  }

  @Test("resuming a chat keeps the runner, model, mode and effort it ran on")
  func resumePassesRunner() async throws {
    let (store, backend) = await attached()
    backend.reply(.agentsSpawn, #"{"agent":{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1}}"#)
    let chat = try #require(await store.chatHistory(for: Self.session)?.first)

    _ = await store.resumeChat(chat, sessionId: "s-1")

    let params = try #require(backend.params(.agentsSpawn))
    #expect(params["resume_session_id"] as? String == "r-h3")
    #expect(params["runner_id"] as? String == "codex")
    #expect(params["model"] as? String == "haiku")
    #expect(params["permission_mode"] as? String == "plan")
    #expect(backend.params(.agentsSetEffort)?["level"] as? String == "low")
    #expect(store.effortByAgent["a-1"] == "low")
  }

  @Test("a mode the gateway can't spawn resumes on the host's default")
  func resumeDropsTrusted() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(
      .agentsStopped,
      #"{"agents":[{"history_id":"h1","runner_session_id":"r-1","title":"t","branch":"feat/a","message_count":1,"started_at":0,"ended_at":1,"permission_mode":"trusted"}]}"#
    )
    backend.reply(.agentsSpawn, #"{"agent":{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1}}"#)
    await store.attach(backend)
    let chat = try #require(await store.chatHistory(for: Self.session)?.first)

    _ = await store.resumeChat(chat, sessionId: "s-1")

    let params = try #require(backend.params(.agentsSpawn))
    #expect(params["permission_mode"] == nil || params["permission_mode"] is NSNull)
    #expect(backend.count(.agentsSetEffort) == 0)
  }

  @Test("a stopped agent resumes on its own conversation, runner, model, mode and effort")
  func resumeStoppedAgent() async throws {
    let (store, backend) = await attached()
    backend.reply(
      .agentsStatus,
      #"{"agent":{"agent_id":"a-0","session_id":"s-1","status":"stopped","runner_session_id":"cli-0","runner_id":"codex","model":"haiku","permission_mode":"review","effort":"high"}}"#)
    backend.reply(.agentsSpawn, #"{"agent":{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1}}"#)
    #expect(!store.canResume(agentId: "a-0"))
    await store.loadAgentStatus(agentId: "a-0")
    #expect(store.canResume(agentId: "a-0"))

    let resumed = await store.resumeAgent("a-0")

    #expect(resumed?.agentId == "a-1")
    let params = try #require(backend.params(.agentsSpawn))
    #expect(params["session_id"] as? String == "s-1")
    #expect(params["resume_session_id"] as? String == "cli-0")
    #expect(params["runner_id"] as? String == "codex")
    #expect(params["model"] as? String == "haiku")
    #expect(params["permission_mode"] as? String == "review")
    #expect(backend.params(.agentsSetEffort)?["level"] as? String == "high")
  }

  @Test("a match splits around its hit by UTF-16 offsets")
  func matchParts() {
    let match = ChatHistoryMatch(role: .user, snippet: "👋 fix the bug", matchStart: 3, matchEnd: 6)
    #expect(match.parts.before == "👋 ")
    #expect(match.parts.hit == "fix")
    #expect(match.parts.after == " the bug")
    let wild = ChatHistoryMatch(role: .user, snippet: "abc", matchStart: 9, matchEnd: 2)
    #expect(wild.parts.before == "abc" && wild.parts.hit.isEmpty)
  }
}
