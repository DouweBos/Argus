import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Local backend agents")
struct LocalAgentsTests {
  static let session =
    #"{"id":"s1","repo_root":"/work/argus","kind":"worktree","branch":"feat-x","description":"","path":"/wt","status":"ready"}"#

  static func agent(_ id: String, _ status: String) -> String {
    #"{"agent_id":"\#(id)","session_id":"s1","status":"\#(status)","created_at":1,"runner_id":"claude"}"#
  }

  static func attached(
    _ agents: String..., clicked: (@MainActor @Sendable (String, String) -> Void)? = nil
  ) async -> (HostStore, RecordingBackend) {
    let backend = RecordingBackend()
    backend.reply(
      "state_hydrate",
      #"{"projects":[],"sessions":[\#(session)],"agents":[\#(agents.joined(separator: ","))]}"#)
    let store = HostStore(hooks: HostStoreHooks(agentNotificationClicked: clicked ?? { _, _ in }))
    await store.attach(backend)
    return (store, backend)
  }

  @Test("every running agent is subscribed on attach and again after a reconnect")
  func followsEveryAgent() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "idle"))
    #expect(await eventually { backend.subscriptions.map(\.0) == ["a1"] })

    backend.emitState(.connecting)
    backend.emitState(.ready)
    #expect(await eventually { backend.subscriptions.filter { $0 == ("a1", true) }.count == 2 })
    withExtendedLifetime(store) {}
  }

  @Test("a view closing doesn't unsubscribe an agent the store follows")
  func watchKeepsSubscription() async throws {
    let (store, backend) = await Self.attached()
    await store.watchAgent("a1", on: true)
    await store.watchAgent("a1", on: false)
    #expect(backend.subscriptions.map(\.1) == [true])
  }

  @Test("a started agent is subscribed and its repo's agents reloaded")
  func startedAgent() async throws {
    let (store, backend) = await Self.attached()
    backend.reply("sessions.list", #"{"sessions":[\#(Self.session)]}"#)
    await store.loadSessions(repoRoot: "/work/argus")
    backend.reply("agents.list", #"{"agents":[\#(Self.agent("a2", "running"))]}"#)

    try backend.ipc("agent:started", Self.agent("a2", "running"))
    #expect(await eventually { store.agentsByRepo["/work/argus"]?.map(\.agentId) == ["a2"] })
    #expect(backend.subscriptions.contains { $0 == ("a2", true) })
  }

  @Test("an exit, effort and mode change reach the agent's status")
  func agentChannels() async throws {
    let (store, backend) = await Self.attached()
    try backend.emit("agent.status", payload: Self.agent("a1", "running"))
    #expect(await eventually { store.statusByAgent["a1"]?.status == .running })

    try backend.ipc("agent:effort-changed:a1", #""high""#)
    try backend.ipc("agent:permission-mode-changed:a1", #""plan""#)
    try backend.ipc("agent:exit:a1", "1")
    #expect(await eventually { store.statusByAgent["a1"]?.status == .error })
    #expect(store.effortByAgent["a1"] == "high")
    #expect(store.statusByAgent["a1"]?.permissionMode == "plan")
  }

  @Test("only an agent on screen is refetched per event")
  func refetchesOnlyWatched() async throws {
    let (store, backend) = await Self.attached()
    backend.reply("agents.transcript", #"{"messages":[]}"#)
    try backend.emit("agent.event", agentId: "a1", payload: #"{"agent_id":"a1","event":{}}"#)
    try await Task.sleep(for: .milliseconds(400))
    #expect(backend.calls("agents.transcript").isEmpty)

    await store.watchAgent("a1", on: true)
    try backend.emit("agent.event", agentId: "a1", payload: #"{"agent_id":"a1","event":{}}"#)
    #expect(await eventually { backend.calls("agents.transcript").count == 1 })
  }

  @Test("a clicked notification reaches the app")
  func notificationClicked() async throws {
    var clicked: [String] = []
    let (store, backend) = await Self.attached(clicked: { agent, session in
      clicked.append("\(agent)@\(session)")
    })
    try backend.ipc("agent_notification_clicked", #"{"agent_id":"a1","session_id":"s1"}"#)
    #expect(await eventually { clicked == ["a1@s1"] })
    withExtendedLifetime(store) {}
  }

  @Test("session progress lists the session's repo")
  func sessionProgress() async throws {
    let (store, backend) = await Self.attached()
    backend.reply(
      "sessions.list",
      #"{"sessions":[{"id":"s1","repo_root":"/work/argus","kind":"worktree","branch":"feat-x","status":"initializing","progress":{"current":3,"total":10}}]}"#
    )
    try backend.ipc("session:progress", #""s1""#)
    #expect(await eventually { store.sessionsByRepo["/work/argus"]?.first?.progress?.current == 3 })
  }

  @Test("a send goes through the host, which queues or records it")
  func sendsThroughHost() async throws {
    let (store, backend) = await Self.attached()
    backend.reply("agents.send", #"{"accepted":true}"#)
    backend.reply("agents.transcript", #"{"messages":[]}"#)
    await store.sendMessage(agentId: "a1", message: "hello")
    #expect(backend.calls("agents.send").first?.params["message"] == .string("hello"))
    #expect(backend.calls("send_agent_message").isEmpty)
    #expect(store.optimisticByAgent["a1"]?.count == 1)
  }
}
