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

  @Test("a branch switched outside Argus re-reads the session's git status")
  func branchSwitchRefreshesGitStatus() async throws {
    func status(_ branch: String, ahead: Int) -> String {
      #"{"status":{"branch":"\#(branch)","upstream":"origin/\#(branch)","ahead":\#(ahead),"behind":0,"dirty_count":0,"stash_count":0,"conflict_count":0,"detached":false}}"#
    }
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    backend.reply(.sessionsList, #"{"sessions":[\#(Self.session)]}"#)
    await store.loadSessions(repoRoot: "/repo")
    backend.reply(.sessionsGitStatus, status("main", ahead: 0))
    await store.loadGitStatus(sessionId: "s1")

    backend.reply(.sessionsGitStatus, status("feature", ahead: 2))
    backend.reply(
      .sessionsList, #"{"sessions":[\#(Self.session.replacingOccurrences(of: "\"main\"", with: "\"feature\""))]}"#)
    try backend.emit("sessions.changed", payload: #"{"repo_root":"/repo"}"#)

    #expect(await eventually { store.gitStatusBySession["s1"]?.branch == "feature" })
    #expect(store.gitStatusBySession["s1"]?.ahead == 2)
    #expect(store.sessionsByRepo["/repo"]?.first?.branch == "feature")
  }

  @Test("a push announced by the host refreshes the sidebar's ahead count")
  func gitStatusChangedRefreshesAheadCount() async throws {
    func status(ahead: Int) -> String {
      #"{"status":{"branch":"main","upstream":"origin/main","ahead":\#(ahead),"behind":0,"dirty_count":0,"stash_count":0,"conflict_count":0,"detached":false}}"#
    }
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    backend.reply(.sessionsGitStatus, status(ahead: 23))
    await store.loadGitStatus(sessionId: "s1")
    #expect(store.gitStatusBySession["s1"]?.ahead == 23)

    backend.reply(.sessionsGitStatus, status(ahead: 0))
    try backend.emit("ipc", payload: #"{"channel":"git_status_changed","args":[{"sessionId":"s1"}]}"#)
    #expect(await eventually { store.gitStatusBySession["s1"]?.ahead == 0 })
  }

  @Test("a burst of git_status_changed reads once more, and only what is shown")
  func gitStatusChangedCoalesces() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    backend.reply(
      .sessionsGitStatus,
      #"{"status":{"branch":"main","upstream":null,"ahead":0,"behind":0,"dirty_count":0,"stash_count":0,"conflict_count":0,"detached":false}}"#)
    await store.loadGitStatus(sessionId: "s1")

    backend.hold(.sessionsGitStatus)
    let first = Task { await store.refreshGitStatus(sessionId: "s1") }
    // Let the first read reach the backend and park there.
    try await Task.sleep(for: .milliseconds(50))
    for _ in 0..<3 { await store.refreshGitStatus(sessionId: "s1") }
    await store.refreshGitStatus(sessionId: "s9")
    backend.release(.sessionsGitStatus)
    await first.value

    #expect(backend.count(.sessionsGitStatus) == 3)
  }

  @Test("refreshing held lists refetches every repo already listed")
  func refreshHeldLists() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    backend.reply(.sessionsList, #"{"sessions":[]}"#)
    await store.loadSessions(repoRoot: "/repo")

    backend.reply(.projectsList, #"{"projects":[]}"#)
    backend.reply(.sessionsList, #"{"sessions":[\#(Self.session)]}"#)
    await store.refreshHeldLists()
    #expect(store.sessionsByRepo["/repo"]?.count == 1)
    #expect(store.projectsLoaded)
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

  @Test("an answer to a prompt the host no longer holds leaves it settled")
  func goneDecision() async {
    let backend = FakeBackend()
    let gone = Transport.TransportError.gateway(
      GatewayErrorPayload(code: "bad_request", message: "no such outstanding prompt"))
    backend.fail(.permissionRespond, with: gone)
    let store = HostStore()
    await store.attach(backend)
    await store.respond(agentId: "a1", toolUseId: "t1", decision: "deny", message: "Postgres")
    #expect(store.answered.contains(store.promptKey("a1", "t1")))
    #expect(store.lastError?.hasPrefix("That prompt is no longer waiting") == true)
  }

  private static func call(_ fields: String) -> RemoteToolCall {
    let json =
      #"{"id":"q1","name":"AskUserQuestion","input":{},\#(fields)}"#
    return try! JSONDecoder().decode(RemoteToolCall.self, from: Data(json.utf8))
  }

  @Test("a prompt the host settled as expired is not actionable")
  func expiredPrompt() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    try backend.emit("agent.status", payload: Self.status("a1", "idle"))
    #expect(await eventually { store.statusByAgent["a1"]?.status == .idle })

    // Restored history or a turn that moved on: the host sends it settled.
    let expired = Self.call(
      #""status":"done","expired":true,"result_blocks":[{"type":"text","text":"Not answered"}]"#)
    #expect(!store.isToolCallPending(agentKey: "a1", call: expired))
    #expect(store.pendingCalls(agentKey: "a1", in: [Self.message(expired)]).isEmpty)
  }

  @Test("a prompt the host is holding is actionable")
  func livePrompt() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    try backend.emit("agent.status", payload: Self.status("a1", "idle"))
    #expect(await eventually { store.statusByAgent["a1"]?.status == .idle })

    let pending = Self.call(#""result_blocks":[],"status":"pending","pending_permission":true"#)
    #expect(store.isToolCallPending(agentKey: "a1", call: pending))
    let running = Self.call(#""result_blocks":[],"status":"running""#)
    #expect(!store.isToolCallPending(agentKey: "a1", call: running))
    try backend.emit(
      "permission.request",
      payload: #"{"agent_id":"a1","tool_use_id":"q1","tool_name":"AskUserQuestion","tool_input":{}}"#)
    #expect(await eventually { store.isToolCallPending(agentKey: "a1", call: running) })
    #expect(store.pendingCalls(agentKey: "a1", in: [Self.message(running)]).map(\.id) == ["q1"])
  }

  private static func message(_ call: RemoteToolCall) -> RemoteMessage {
    let json = #"{"id":"m1","role":"assistant","text_blocks":[],"tool_calls":[]}"#
    var message = try! JSONDecoder().decode(RemoteMessage.self, from: Data(json.utf8))
    message.toolCalls = [call]
    return message
  }

  @Test("always allow from a phone asks the gateway for the rule")
  func alwaysAllowOverGateway() async {
    let backend = FakeBackend(kind: .gateway)
    backend.reply(.permissionRespond, #"{"accepted":true,"allow_rule":"Bash(npm *)"}"#)
    let store = HostStore()
    await store.attach(backend)
    await store.respond(agentId: "a1", toolUseId: "t1", decision: "allow", alwaysAllow: "Bash(npm *)")
    #expect(backend.params(.permissionRespond)?["always_allow"] as? Bool == true)
    #expect(store.lastError == nil)

    backend.reply(.permissionRespond, #"{"accepted":true}"#)
    await store.respond(agentId: "a1", toolUseId: "t2", decision: "allow", alwaysAllow: "Bash(npm *)")
    #expect(store.lastError == HostStore.alwaysAllowUnsupported)

    await store.respond(agentId: "a1", toolUseId: "t3", decision: "allow")
    #expect(backend.params(.permissionRespond)?["always_allow"] == nil)
  }

  @Test("a host too old for a method explains itself instead of erroring")
  func unsupportedByHost() async {
    var reported: [String] = []
    let store = HostStore(hooks: HostStoreHooks(errorReported: { error, _ in
      reported += HostStore.unsupportedMethod(error).map { [$0] } ?? []
    }))
    let backend = FakeBackend()
    backend.fail(
      .usageLimits, with: Transport.TransportError.unsupported(method: "usage.limits", hostVersion: "0.68.0"))
    await store.attach(backend)
    await store.loadUsageLimits()
    #expect(
      store.usageLimitsError
        == "This needs a newer version of Argus. The host you're connected to is running 0.68.0.")
    #expect(reported == ["usage.limits"])
    #expect(HostStore.unsupportedMethod(Transport.TransportError.timedOut) == nil)
  }

  @Test("a cancelled request never reaches the user")
  func cancellationIsSilent() async {
    var reported: [String] = []
    let store = HostStore(hooks: HostStoreHooks(errorReported: { _, scope in reported.append(scope) }))
    let backend = FakeBackend()
    backend.fail(.githubPullRequests, with: CancellationError())
    await store.attach(backend)
    let pulls = PullRequestsStore(host: store)
    await pulls.refresh()
    store.report(URLError(.cancelled))
    #expect(pulls.error == nil)
    #expect(store.lastError == nil)
    #expect(reported.isEmpty)
    #expect(!HostStore.isCancellation(Transport.TransportError.timedOut))
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

  @Test("an empty list reads as not loaded until the computer answers")
  func listsLoaded() async {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    await store.refreshProjects()
    #expect(!store.projectsLoaded)

    backend.reply(.projectsList, #"{"projects":[]}"#)
    backend.reply(.devicesList, #"{"devices":[]}"#)
    await store.refreshProjects()
    await store.refreshDevices()
    #expect(store.projectsLoaded && store.projects.isEmpty)
    #expect(store.devicesLoaded)

    store.reset()
    #expect(!store.projectsLoaded && !store.devicesLoaded)
  }
}
