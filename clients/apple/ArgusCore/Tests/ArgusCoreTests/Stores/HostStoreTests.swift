import ArgusCore
import Foundation
import ArgusKit
import Testing

@MainActor
@Suite("Host store")
struct HostStoreTests {
  private static func status(_ id: String, _ state: String) -> String {
    #"{"agent_id":"\#(id)","session_id":"s1","status":"\#(state)"}"#
  }

  private static let session =
    #"{"id":"s1","repo_root":"/repo","kind":"worktree","branch":"main","status":"ready"}"#

  @Test("agent.status updates the agent everywhere it is listed")
  func agentStatus() async throws {
    var seen: [String] = []
    let store = HostStore(hooks: HostStoreHooks(agentsSeen: { seen += $0 }))
    let backend = FakeBackend()
    await store.attach(backend)
    #expect(store.connection == .ready)

    try backend.emit("agent.status", payload: Self.status("a1", "running"))
    #expect(await eventually { store.statusByAgent["a1"]?.status == .running })
    #expect(store.recentAgents.map(\.agentId) == ["a1"])
    #expect(seen == ["a1"])

    try backend.emit("agent.status", payload: Self.status("a1", "idle"))
    #expect(await eventually { store.statusByAgent["a1"]?.status == .idle })
    #expect(store.recentAgents.count == 1)
  }

  @Test("raw ipc channels reach observers with their seq until they stop")
  func observeIpc() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    var seen: [String] = []
    let stop = store.observeIpc { channel, args, seq in
      seen.append("\(channel) \(args.first?.stringValue ?? "") \(seq)")
    }

    try backend.emit("ipc", payload: #"{"channel":"browser_view:nav","args":["s1"]}"#)
    #expect(await eventually { seen.count == 1 })
    #expect(seen.first?.hasPrefix("browser_view:nav s1 ") == true)

    stop()
    try await Task.sleep(for: .milliseconds(20))
    try backend.emit("ipc", payload: #"{"channel":"browser_view:nav","args":["s2"]}"#)
    try await Task.sleep(for: .milliseconds(50))
    #expect(seen.count == 1)
  }

  @Test("a permission request shows until it is cancelled")
  func permissionRequest() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)

    try backend.emit(
      "permission.request",
      payload: #"{"agent_id":"a1","tool_use_id":"t1","tool_name":"Bash","tool_input":{}}"#)
    #expect(await eventually { store.prompt(agentKey: "a1", toolUseId: "t1") != nil })
    #expect(store.prompt(agentKey: "a1", toolUseId: "t1")?.toolName == "Bash")

    try backend.emit("permission.cancel", payload: #"{"agent_id":"a1","tool_use_id":"t1"}"#)
    #expect(await eventually { store.prompts.isEmpty })
  }

  @Test("sessions.changed refetches a repo the store already holds")
  func sessionsChanged() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    backend.reply(.sessionsList, #"{"sessions":[]}"#)
    await store.loadSessions(repoRoot: "/repo")
    #expect(store.sessionsByRepo["/repo"] == [])

    backend.reply(.sessionsList, #"{"sessions":[\#(Self.session)]}"#)
    try backend.emit("sessions.changed", payload: #"{"repo_root":"/repo"}"#)
    #expect(await eventually { store.sessionsByRepo["/repo"]?.count == 1 })
    #expect(store.repoRoot(forSessionId: "s1") == "/repo")
  }

  @Test("sessions.changed ignores a repo nobody listed")
  func sessionsChangedUnknown() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    try backend.emit("sessions.changed", payload: #"{"repo_root":"/elsewhere"}"#)
    try backend.emit("agent.status", payload: Self.status("a1", "idle"))
    #expect(await eventually { store.statusByAgent["a1"] != nil })
    #expect(!backend.requested.contains(RemoteMethod.sessionsList.rawValue))
  }

  @Test("a send the host refuses lands in failed sends")
  func sendFailure() async {
    var events: [StoreEvent] = []
    var scopes: [String] = []
    let store = HostStore(
      hooks: HostStoreHooks(
        track: { events.append($0) }, errorReported: { _, scope in scopes.append(scope) }))
    let backend = FakeBackend()
    backend.fail(.agentsSend)
    await store.attach(backend)

    await store.sendMessage(agentId: "a1", message: "hello")
    #expect(store.failedByAgent["a1"]?.map(\.text) == ["hello"])
    #expect(store.optimisticByAgent["a1"] == nil)
    #expect(store.lastError != nil)
    #expect(scopes == ["agent:send"])
    #expect(events == [.messageSendFailed(retried: false)])
  }

  @Test("a retry that succeeds leaves the failed list")
  func retry() async {
    var events: [StoreEvent] = []
    let store = HostStore(hooks: HostStoreHooks(track: { events.append($0) }))
    await store.sendMessage(agentId: "a1", message: "offline")
    let failed = try! #require(store.failedByAgent["a1"]?.first)

    let backend = FakeBackend()
    backend.reply(.agentsSend, #"{"queued":false}"#)
    backend.reply(.agentsTranscript, #"{"messages":[]}"#)
    await store.attach(backend)
    await store.retryFailed(agentId: "a1", id: failed.id)
    #expect(store.failedByAgent["a1"] == nil)
    #expect(events.last == .messageSent(queued: false, hasImages: false, length: 7))
  }

  @Test("an undeliverable answer is handed to the app")
  func undeliveredDecision() async {
    var undelivered: [String] = []
    let store = HostStore(
      hooks: HostStoreHooks(decisionUndelivered: { agent, tool, decision in
        undelivered.append("\(agent):\(tool):\(decision)")
      }))
    await store.respond(agentId: "a1", toolUseId: "t1", decision: "allow")
    #expect(undelivered == ["a1:t1:allow"])
    #expect(store.answered.contains(store.promptKey("a1", "t1")))
  }

  @Test("an answer the host refuses brings its prompt back")
  func refusedDecision() async {
    let backend = FakeBackend()
    backend.fail(.permissionRespond)
    let store = HostStore()
    await store.attach(backend)
    await store.respond(agentId: "a1", toolUseId: "t1", decision: "allow")
    #expect(!store.answered.contains(store.promptKey("a1", "t1")))
    #expect(store.lastError?.hasPrefix("Your answer didn't reach the agent") == true)
    let gone = Transport.TransportError.gateway(GatewayErrorPayload(code: "bad_request", message: "no such outstanding prompt"))
    #expect(HostStore.refusedAnswerMessage(gone).hasPrefix("That prompt is no longer waiting"))
  }

  @Test("reset forgets the previous computer")
  func reset() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    try backend.emit("agent.status", payload: Self.status("a1", "idle"))
    #expect(await eventually { !store.recentAgents.isEmpty })

    await store.detach()
    #expect(store.connection == .offline)
    #expect(store.backend == nil)
    store.reset()
    #expect(store.recentAgents.isEmpty)
    #expect(store.statusByAgent.isEmpty)
  }

  @Test("connection state follows the backend")
  func connectionState() async {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    backend.emitState(.offline)
    #expect(await eventually { store.connection == .offline })
  }
}
