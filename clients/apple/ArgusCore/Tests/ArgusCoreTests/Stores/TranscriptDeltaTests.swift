import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Transcript deltas")
struct TranscriptDeltaTests {
  private static func message(_ id: String, _ text: String, at timestamp: Int = 1) -> String {
    #"{"id":"\#(id)","role":"assistant","text_blocks":["\#(text)"],"tool_calls":[],"timestamp":\#(timestamp)}"#
  }

  private static func page(_ messages: [String], epoch: String? = "e1", revision: Int = 3) -> String {
    let position = epoch.map { #","epoch":"\#($0)","revision":\#(revision)"# } ?? ""
    return #"{"messages":[\#(messages.joined(separator: ","))]\#(position)}"#
  }

  private static func delta(
    _ revision: Int, epoch: String = "e1", messages: [String] = [], removed: [String] = [],
    title: String? = nil, pendingTool: String? = nil, followUps: [String]? = nil
  ) -> String {
    let title = title.map { #""\#($0)""# } ?? "null"
    let tool = pendingTool.map { #""\#($0)""# } ?? "null"
    let replies = followUps.map { items in
      #","follow_ups":[\#(items.map { #""\#($0)""# }.joined(separator: ","))]"#
    } ?? ""
    return #"""
      {"agent_id":"a1","epoch":"\#(epoch)","revision":\#(revision),"total":100,\#
      "messages":[\#(messages.joined(separator: ","))],\#
      "removed_ids":[\#(removed.map { #""\#($0)""# }.joined(separator: ","))],\#
      "title":\#(title),"model":null,"pending_tool_name":\#(tool),"tasks":null,"todos":null\#(replies)}
      """#
  }

  /// A store following `a1` from a tail page at revision 3.
  private func following() async -> (HostStore, FakeBackend) {
    let store = HostStore()
    let backend = FakeBackend(kind: .gateway)
    backend.reply(.agentsTranscript, Self.page([Self.message("m1", "one"), Self.message("m2", "two")]))
    await store.attach(backend)
    await store.watchAgent("a1", on: true)
    await store.loadTranscript(agentId: "a1")
    return (store, backend)
  }

  private func texts(_ store: HostStore) -> [String] {
    (store.messagesByAgent["a1"] ?? []).map { $0.textBlocks.joined() }
  }

  @Test("deltas in order upsert, append and remove without a refetch")
  func appliesInOrder() async throws {
    let (store, backend) = await following()
    let before = store.messagesByAgent["a1"]?.first

    try backend.emit(
      "agent.transcript", agentId: "a1",
      payload: Self.delta(4, messages: [Self.message("m2", "two!"), Self.message("m3", "three")], pendingTool: "Bash"))
    #expect(await eventually { texts(store) == ["one", "two!", "three"] })
    #expect(store.pendingToolByAgent["a1"] == "Bash")
    #expect(store.messagesByAgent["a1"]?.first == before)

    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(5, removed: ["m1"]))
    #expect(await eventually { texts(store) == ["two!", "three"] })
    #expect(store.pendingToolByAgent["a1"] == nil)
    #expect(backend.count(.agentsTranscript) == 1)
    #expect(store.followsTranscriptDeltas("a1"))
  }

  @Test("a delta carrying a title retitles the agent")
  func title() async throws {
    let (store, backend) = await following()
    try backend.emit("agent.status", payload: #"{"agent_id":"a1","session_id":"s1","status":"idle"}"#)
    #expect(await eventually { store.statusByAgent["a1"] != nil })

    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(4, title: "Fix the build"))
    #expect(await eventually { store.statusByAgent["a1"]?.title == "Fix the build" })
    #expect(store.recentAgents.first?.title == "Fix the build")
  }

  @Test("a delta's suggested replies replace the last, and an empty list clears them")
  func followUps() async throws {
    let (store, backend) = await following()
    try backend.emit(
      "agent.transcript", agentId: "a1", payload: Self.delta(4, followUps: ["Add tests", "Commit it"]))
    #expect(await eventually { store.followUpsByAgent["a1"] == ["Add tests", "Commit it"] })

    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(5, followUps: []))
    #expect(await eventually { store.followUpsByAgent["a1"] == nil })
  }

  @Test("a stale delta is dropped")
  func dropsStale() async throws {
    let (store, backend) = await following()
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(3, messages: [Self.message("m9", "old")]))
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(4, messages: [Self.message("m3", "new")]))
    #expect(await eventually { texts(store) == ["one", "two", "new"] })
    #expect(backend.count(.agentsTranscript) == 1)
  }

  @Test("a gap or a new epoch refetches the tail")
  func gapRefetches() async throws {
    let (store, backend) = await following()
    backend.reply(
      .agentsTranscript,
      Self.page([Self.message("m1", "one"), Self.message("m2", "two"), Self.message("m3", "three")], revision: 6))
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(6, messages: [Self.message("m3", "three")]))
    #expect(await eventually { backend.count(.agentsTranscript) == 2 })
    #expect(await eventually { texts(store) == ["one", "two", "three"] })

    // Back in line from the refetched page.
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(7, messages: [Self.message("m4", "four")]))
    #expect(await eventually { texts(store).last == "four" })

    backend.reply(.agentsTranscript, Self.page([Self.message("n1", "restarted")], epoch: "e2", revision: 1))
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(1, epoch: "e2"))
    #expect(await eventually { texts(store) == ["restarted"] })
    #expect(backend.count(.agentsTranscript) == 3)
  }

  @Test("deltas that land during a tail fetch replay after it")
  func buffersDuringFetch() async throws {
    let (store, backend) = await following()
    backend.reply(
      .agentsTranscript,
      Self.page([Self.message("m1", "one"), Self.message("m2", "two"), Self.message("m3", "three")], revision: 5))
    backend.hold(.agentsTranscript)
    let fetch = Task { await store.loadTranscript(agentId: "a1") }
    try await Task.sleep(for: .milliseconds(20))

    // Already in the page, then newer than it.
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(5, messages: [Self.message("m3", "three")]))
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(6, messages: [Self.message("m4", "four")]))
    try await Task.sleep(for: .milliseconds(50))
    #expect(texts(store) == ["one", "two"])

    backend.release(.agentsTranscript)
    await fetch.value
    #expect(texts(store) == ["one", "two", "three", "four"])
    #expect(backend.count(.agentsTranscript) == 2)
  }

  @Test("once deltas flow, agent events stop refetching")
  func eventsStopRefetching() async throws {
    let (store, backend) = await following()
    try backend.emit("agent.transcript", agentId: "a1", payload: Self.delta(4))
    #expect(await eventually { store.followsTranscriptDeltas("a1") })
    try backend.emit("agent.event", agentId: "a1", payload: #"{"agent_id":"a1","event":{}}"#)
    try backend.emit("permission.cancel", payload: #"{"agent_id":"a1","tool_use_id":"t1"}"#)
    try await Task.sleep(for: .milliseconds(400))
    #expect(backend.count(.agentsTranscript) == 1)

    await store.refreshTranscript(agentId: "a1")
    #expect(backend.count(.agentsTranscript) == 1)
  }

  @Test("an older host without deltas keeps refetching on events and polling")
  func oldHostFallback() async throws {
    let store = HostStore()
    let backend = FakeBackend(kind: .gateway)
    backend.reply(.agentsTranscript, Self.page([Self.message("m1", "one")], epoch: nil))
    await store.attach(backend)
    await store.watchAgent("a1", on: true)
    await store.loadTranscript(agentId: "a1")
    #expect(!store.followsTranscriptDeltas("a1"))

    try backend.emit("agent.event", agentId: "a1", payload: #"{"agent_id":"a1","event":{}}"#)
    #expect(await eventually { backend.count(.agentsTranscript) == 2 })

    await store.refreshTranscript(agentId: "a1")
    #expect(backend.count(.agentsTranscript) == 3)
  }

  @Test("an unknown older message waits for its page instead of landing at the end")
  func olderUnknownMessage() async throws {
    let store = HostStore()
    let backend = FakeBackend(kind: .gateway)
    backend.reply(
      .agentsTranscript,
      #"{"messages":[\#(Self.message("m5", "five", at: 50))],"prev_before":4,"epoch":"e1","revision":3}"#)
    await store.attach(backend)
    await store.loadTranscript(agentId: "a1")
    #expect(store.hasOlderMessages(for: "a1"))

    try backend.emit(
      "agent.transcript", agentId: "a1",
      payload: Self.delta(4, messages: [Self.message("m1", "old", at: 10), Self.message("m6", "six", at: 60)]))
    #expect(await eventually { texts(store) == ["five", "six"] })
  }
}
