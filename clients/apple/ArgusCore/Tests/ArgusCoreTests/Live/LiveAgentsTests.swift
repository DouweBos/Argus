import ArgusCore
import Foundation
import Testing

@MainActor
@Suite("Live agents")
struct LiveAgentsTests {
  static let session =
    #"{"id":"s1","repo_root":"/work/argus","kind":"worktree","branch":"feat-x","description":"","path":"/wt","status":"ready"}"#

  static func agent(_ id: String, _ status: String) -> String {
    #"{"agent_id":"\#(id)","session_id":"s1","status":"\#(status)","created_at":1,"runner_id":"claude"}"#
  }

  static func hydrate(_ agents: String...) -> String {
    #"{"projects":[],"sessions":[\#(session)],"agents":[\#(agents.joined(separator: ","))]}"#
  }

  static func status(_ id: String, _ state: String) -> String {
    #"{"agent_id":"\#(id)","session_id":"s1","status":"\#(state)"}"#
  }

  static let initEvent =
    #"{"type":"system","subtype":"init","session_id":"cli-1","model":"opus","tools":[]}"#

  static func assistantText(_ id: String, _ text: String) -> String {
    #"{"type":"assistant","message":{"id":"\#(id)","content":[{"type":"text","text":"\#(text)"}]}}"#
  }

  static func result(durationMs: Int = 20_000) -> String {
    #"{"type":"result","subtype":"success","duration_ms":\#(durationMs),"total_cost_usd":0.01}"#
  }

  /// A store on a local backend with fast timers, the host listing `agents`.
  static func attached(
    _ agents: String..., focused: Bool = true,
    clicked: (@MainActor @Sendable (String, String) -> Void)? = nil
  ) async -> (HostStore, RecordingBackend) {
    let backend = RecordingBackend()
    backend.reply(
      "state_hydrate",
      #"{"projects":[],"sessions":[\#(session)],"agents":[\#(agents.joined(separator: ","))]}"#)
    let store = HostStore(
      hooks: HostStoreHooks(
        isAppFocused: { focused }, agentNotificationClicked: clicked ?? { _, _ in }))
    var timing = LiveAgents.Timing()
    timing.saveDebounce = .milliseconds(80)
    timing.awaitingAnswerGrace = .milliseconds(30)
    store.liveTiming = timing
    await store.attach(backend)
    return (store, backend)
  }

  @Test("agents the host is running are subscribed and hydrated on attach")
  func discovery() async throws {
    let backend = RecordingBackend()
    backend.reply("state_hydrate", Self.hydrate(Self.agent("a1", "idle")))
    backend.reply(
      "get_agent_snapshot",
      #""{\"messages\":[{\"id\":\"m1\",\"role\":\"user\",\"textBlocks\":[\"hi\"],\"toolCalls\":[],\"timestamp\":1}],\"title\":\"Greeting\"}""#
    )
    let store = HostStore()
    await store.attach(backend)

    #expect(await eventually { store.messagesByAgent["a1"]?.first?.textBlocks == ["hi"] })
    #expect(backend.subscriptions.map(\.0) == ["a1"])
    #expect(store.live?.agents(inSession: "s1").map(\.id) == ["a1"])
    #expect(store.live?.conversation(for: "a1")?.title == "Greeting")
    #expect(backend.calls("agents.transcript").isEmpty)
  }

  @Test("a started agent is subscribed and its events become messages")
  func startedAgentEvents() async throws {
    let (store, backend) = await Self.attached()
    try backend.ipc("agent:started", Self.agent("a2", "idle"))
    #expect(await eventually { backend.subscriptions.contains { $0 == ("a2", true) } })

    try backend.streamEvent("a2", Self.initEvent)
    try backend.streamEvent("a2", Self.assistantText("msg-1", "Hello there"))
    #expect(await eventually { store.messagesByAgent["a2"]?.last?.textBlocks == ["Hello there"] })
    #expect(store.messagesByAgent["a2"]?.last?.role == .assistant)
    #expect(store.live?.conversation(for: "a2")?.sessionId == "cli-1")
    #expect(backend.calls("agents.transcript").isEmpty)
  }

  @Test("a prompted spawn is titled and held running until its turn ends")
  func promptedSpawn() async throws {
    let (store, backend) = await Self.attached()
    backend.reply("generate_session_title", #""Fix the build""#)
    try backend.ipc(
      "agent:started",
      #"{"agent_id":"a3","session_id":"s1","status":"idle","initial_prompt":"fix the build"}"#)
    #expect(await eventually { store.live?.conversation(for: "a3")?.title == "Fix the build" })
    #expect(store.live?.agents["a3"]?.status == .running)
    #expect(backend.calls("generate_session_title").first?.params["firstMessage"] == .string("fix the build"))
  }

  @Test("a prompted turn that ended before we subscribed settles from its result")
  func promptedSpawnSettlesFromResult() async throws {
    let (store, backend) = await Self.attached()
    backend.reply("generate_session_title", #""Fix the build""#)
    try backend.ipc(
      "agent:started",
      #"{"agent_id":"a3","session_id":"s1","status":"idle","initial_prompt":"fix the build"}"#)
    #expect(await eventually { store.live?.agents["a3"]?.status == .running })
    // The host's running→idle came and went unseen; only the result arrives.
    try backend.streamEvent("a3", Self.result())
    #expect(await eventually { store.live?.agents["a3"]?.status == .idle })
  }

  @Test("snapshots publish debounced and history saves on exit")
  func publishAndSave() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "running"))
    #expect(await eventually { backend.subscriptions.count == 1 })

    try backend.streamEvent("a1", Self.initEvent)
    try backend.streamEvent("a1", Self.assistantText("msg-1", "one"))
    try backend.streamEvent("a1", Self.assistantText("msg-2", "two"))
    #expect(await eventually { backend.calls("publish_agent_snapshot").count == 1 })
    try await Task.sleep(for: .milliseconds(150))
    #expect(backend.calls("publish_agent_snapshot").count == 1)

    let published = try #require(backend.calls("publish_agent_snapshot").first?.params["snapshot"]?.stringValue)
    let conv = try JSONDecoder().decode(AgentConversation.self, from: Data(published.utf8))
    #expect(conv.messages.count == 2)

    try backend.ipc("agent:exit:a1", "0")
    #expect(await eventually { store.live?.agents["a1"]?.status == .stopped })
    #expect(await eventually { backend.calls("save_chat_history").count >= 2 })
    let saved = try #require(backend.calls("save_chat_history").last?.params)
    #expect(saved["repoRoot"] == .string("/work/argus"))
    #expect(saved["conversation"]?["agentId"] == .string("a1"))
    #expect(saved["conversation"]?["sessionId"] == .string("cli-1"))
    #expect(saved["conversation"]?["sessionBranch"] == .string("feat-x"))
    #expect(saved["conversation"]?["messageCount"] == .number(2))
    #expect(saved["conversation"]?["title"] == .string("Untitled conversation"))
  }

  @Test("saveAll saves every conversation before quit")
  func saveAll() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "running"))
    #expect(await eventually { backend.subscriptions.count == 1 })
    try backend.streamEvent("a1", Self.initEvent)
    try backend.streamEvent("a1", Self.assistantText("msg-1", "one"))
    #expect(await eventually { store.live?.conversation(for: "a1")?.messages.count == 1 })

    await store.live?.saveAll()
    #expect(backend.calls("save_chat_history").count == 1)
  }

  @Test("the queue drains when the host reports the turn over")
  func queueDrainsOnIdle() async throws {
    let backend = RecordingBackend()
    backend.reply("state_hydrate", Self.hydrate(Self.agent("a1", "running")))
    backend.reply(
      "agents.queue_list",
      #"{"messages":[{"id":"q1","text":"next please","queued_at":1}]}"#)
    var dequeued = false
    backend.reply("dequeue_message") {
      defer { dequeued = true }
      return dequeued ? "null" : #"{"id":"q1","text":"next please","queued_at":1}"#
    }
    backend.reply("create_checkpoint", #"{"id":"cp1","sha":"abc","createdAt":1,"hasChanges":true}"#)
    let store = HostStore()
    await store.attach(backend)
    #expect(await eventually { store.queuedByAgent["a1"]?.count == 1 })

    try backend.emit("agent.status", agentId: "a1", payload: Self.status("a1", "idle"))
    #expect(await eventually { !backend.calls("send_agent_message").isEmpty })
    let send = try #require(backend.calls("send_agent_message").first)
    #expect(send.params["message"] == .string("next please"))
    #expect(await eventually { store.messagesByAgent["a1"]?.last?.textBlocks == ["next please"] })
    #expect(store.live?.conversation(for: "a1")?.messages.last?.checkpointId == "cp1")
    #expect(store.live?.agents["a1"]?.status == .running)
    #expect(store.statusByAgent["a1"]?.status == .running)
  }

  @Test("a long turn that finishes notifies")
  func finishedNotifies() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "running"), focused: false)
    #expect(await eventually { backend.subscriptions.count == 1 })
    try backend.streamEvent("a1", Self.result(durationMs: 12_000))
    try backend.emit("agent.status", agentId: "a1", payload: Self.status("a1", "idle"))
    #expect(await eventually { !backend.calls("notify_agent").isEmpty })
    let call = try #require(backend.calls("notify_agent").first)
    #expect(call.params["payload"]?["kind"] == .string("finished"))
    #expect(call.params["payload"]?["title"] == .string("argus agent finished"))
    #expect(call.params["payload"]?["body"] == .string("feat-x - Agent completed in 12s"))
    withExtendedLifetime(store) {}
  }

  @Test("a permission request notifies with a local banner when unfocused")
  func permissionNotifies() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "running"), focused: false)
    #expect(await eventually { backend.subscriptions.count == 1 })
    try backend.streamEvent(
      "a1",
      #"{"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#
    )
    try backend.emit(
      "permission.request", agentId: "a1",
      payload: #"{"agent_id":"a1","tool_use_id":"t1","tool_name":"Bash","tool_input":{}}"#)

    #expect(await eventually { backend.calls("notify_agent").count == 1 })
    let call = try #require(backend.calls("notify_agent").first)
    #expect(call.params["showLocal"] == .bool(true))
    #expect(call.params["payload"]?["kind"] == .string("permission"))
    #expect(call.params["payload"]?["tool_use_id"] == .string("t1"))
    #expect(call.params["payload"]?["title"] == .string("argus agent needs approval"))
    #expect(await eventually {
      store.messagesByAgent["a1"]?.last?.toolCalls.first?.pendingPermission == true
    })

    // The same prompt is announced once, whichever path saw it.
    try backend.emit(
      "permission.request", agentId: "a1",
      payload: #"{"agent_id":"a1","tool_use_id":"t1","tool_name":"Bash","tool_input":{}}"#)
    try backend.emit("permission.cancel", agentId: "a1", payload: #"{"agent_id":"a1","tool_use_id":"t1"}"#)
    #expect(await eventually {
      store.messagesByAgent["a1"]?.last?.toolCalls.first?.pendingPermission == nil
    })
    #expect(backend.calls("notify_agent").count == 1)
  }

  @Test("a focused window gets no local banner")
  func focusedSkipsBanner() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "running"), focused: true)
    #expect(await eventually { backend.subscriptions.count == 1 })
    try backend.emit(
      "permission.request", agentId: "a1",
      payload: #"{"agent_id":"a1","tool_use_id":"t9","tool_name":"Edit","tool_input":{}}"#)
    #expect(await eventually { backend.calls("notify_agent").count == 1 })
    #expect(backend.calls("notify_agent").first?.params["showLocal"] == .bool(false))
    withExtendedLifetime(store) {}
  }

  @Test("an unanswered question notifies after the grace period")
  func questionNotifies() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "running"), focused: false)
    #expect(await eventually { backend.subscriptions.count == 1 })
    try backend.streamEvent(
      "a1",
      #"{"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":"q1","name":"AskUserQuestion","input":{}}]}}"#
    )
    #expect(await eventually { backend.calls("notify_agent").count == 1 })
    #expect(
      backend.calls("notify_agent").first?.params["payload"]?["body"]
        == .string("feat-x - Agent asked you a question"))
    withExtendedLifetime(store) {}
  }

  @Test("a reconnect re-subscribes every agent")
  func reconnect() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "idle"))
    #expect(await eventually { backend.subscriptions.count == 1 })

    backend.emitState(.connecting)
    backend.emitState(.ready)
    #expect(await eventually { backend.subscriptions.filter { $0 == ("a1", true) }.count == 2 })
    #expect(backend.calls("state_hydrate").count >= 2)
    withExtendedLifetime(store) {}
  }

  @Test("sending to an idle agent records the bubble and sends raw")
  func sendLocal() async throws {
    var events: [StoreEvent] = []
    let backend = RecordingBackend()
    backend.reply("state_hydrate", Self.hydrate(Self.agent("a1", "idle")))
    let store = HostStore(hooks: HostStoreHooks(track: { events.append($0) }))
    await store.attach(backend)
    #expect(await eventually { store.live?.agents["a1"] != nil })

    await store.sendMessage(agentId: "a1", message: "do it")
    #expect(await eventually { store.messagesByAgent["a1"]?.last?.textBlocks == ["do it"] })
    #expect(store.optimisticByAgent["a1"] == nil)
    #expect(backend.calls("agents.send").isEmpty)
    #expect(backend.calls("send_agent_message").first?.params["message"] == .string("do it"))
    #expect(store.live?.agents["a1"]?.status == .running)
    #expect(events == [.messageSent(queued: false, hasImages: false, length: 5)])

    // Busy now, so the next one queues on the host.
    await store.sendMessage(agentId: "a1", message: "and then")
    #expect(backend.calls("agents.queue_add").count == 1)
  }

  @Test("a failed local send leaves a retryable message, not a bubble")
  func sendLocalFailure() async throws {
    let backend = RecordingBackend()
    backend.reply("state_hydrate", Self.hydrate(Self.agent("a1", "idle")))
    backend.fail("send_agent_message")
    let store = HostStore()
    await store.attach(backend)
    #expect(await eventually { store.live?.agents["a1"] != nil })

    await store.sendMessage(agentId: "a1", message: "lost")
    #expect(store.failedByAgent["a1"]?.map(\.text) == ["lost"])
    #expect(store.live?.conversation(for: "a1")?.messages.isEmpty ?? true)
    #expect(store.live?.agents["a1"]?.status == .idle)
  }

  @Test("stderr becomes a system message, diagnostics a warning")
  func stderr() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "idle"))
    #expect(await eventually { backend.subscriptions.count == 1 })
    try backend.ipc("agent:stderr:a1", #""[claude-code:unrecognized_model] {\"model\":\"x\"}""#)
    try backend.ipc("agent:stderr:a1", #""auth failed""#)
    #expect(await eventually { store.live?.conversation(for: "a1")?.messages.count == 2 })
    let messages = try #require(store.live?.conversation(for: "a1")?.messages)
    #expect(messages[0].tone == "warning")
    #expect(messages[0].textBlocks == ["Unrecognized model", "Model: x"])
    #expect(messages[1].tone == "error")
    #expect(messages[1].textBlocks == ["auth failed"])
  }

  @Test("injected and remote prompts, and model changes, reach the conversation")
  func rawAgentChannels() async throws {
    let (store, backend) = await Self.attached(Self.agent("a1", "idle"))
    #expect(await eventually { backend.subscriptions.count == 1 })
    try backend.ipc(
      "agent:mcp-message:a1",
      #"{"message":"from parent","tool":"send_agent_message","parentAgentId":"p1","timestamp":5}"#)
    try backend.ipc("agent:remote-message:a1", #"{"message":"from phone","author":null}"#)
    try backend.ipc("agent:model-changed:a1", #""sonnet""#)
    try backend.ipc("agent:effort-changed:a1", #""high""#)
    // Events are handled in order, so the last one landing means all did.
    #expect(await eventually { store.effortByAgent["a1"] == "high" })
    #expect(store.live?.conversation(for: "a1")?.model == "sonnet")
    let messages = try #require(store.live?.conversation(for: "a1")?.messages)
    #expect(messages.map(\.role) == [.system, .user])
    #expect(messages[0].source?.parentAgentId == "p1")
    #expect(messages[1].textBlocks == ["from phone"])
    #expect(store.live?.agents["a1"]?.model == "sonnet")
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

  @Test("session progress loads the session's repo")
  func sessionProgress() async throws {
    let (store, backend) = await Self.attached()
    backend.reply(
      "sessions.list",
      #"{"sessions":[{"id":"s1","repo_root":"/work/argus","kind":"worktree","branch":"feat-x","status":"initializing","progress":{"current":3,"total":10}}]}"#
    )
    try backend.ipc("session:progress", #""s1""#)
    #expect(await eventually { store.live?.setupProgress(sessionId: "s1")?.current == 3 })
  }

  @Test("a gateway backend still refetches snapshots")
  func gatewayRefetches() async throws {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("agents.transcript", #"{"messages":[]}"#)
    let store = HostStore()
    await store.attach(backend)
    #expect(store.live == nil)

    try backend.streamEvent("a1", Self.assistantText("m", "hi"))
    #expect(await eventually { backend.calls("agents.transcript").count == 1 })
    #expect(backend.calls("state_hydrate").isEmpty)
    #expect(backend.calls("publish_agent_snapshot").isEmpty)
  }
}

@Suite("CLI diagnostics")
struct CliDiagnosticTests {
  @Test("a structured line spells its payload out")
  func structured() {
    let d = CliDiagnostic.parse(#"[claude-code:non_first_party_base_url] {"base_url":"https://x","extra":{"a":1}}"#)
    #expect(d?.code == "non_first_party_base_url")
    #expect(d?.title == "Non first party base url")
    #expect(d?.details == ["Base url: https://x", #"Extra: {"a":1}"#])
  }

  @Test("anything else is not a diagnostic")
  func plain() {
    #expect(CliDiagnostic.parse("Error: auth") == nil)
    #expect(CliDiagnostic.parse("[claude-code:x] not json")?.details == ["not json"])
    #expect(CliDiagnostic.parse("[claude-code:x]")?.details == [])
  }
}
