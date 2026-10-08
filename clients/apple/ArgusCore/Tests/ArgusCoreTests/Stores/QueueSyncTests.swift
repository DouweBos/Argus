import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Queue sync")
struct QueueSyncTests {
  private static let queued = #"{"id":"q1","text":"hi","queued_at":1}"#

  private static func event(_ messages: String) -> String {
    #"{"agent_id":"a1","messages":[\#(messages)]}"#
  }

  @Test("the host draining a message drops it from the queue")
  func drainDropsEntry() async throws {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    backend.reply("agents.queue_list", #"{"messages":[\#(Self.queued)]}"#)
    await store.loadQueue(agentId: "a1")
    #expect(store.queuedByAgent["a1"]?.map(\.id) == ["q1"])

    try backend.emit("agent.queue", agentId: "a1", payload: Self.event(""))
    #expect(await eventually { store.queuedByAgent["a1"]?.isEmpty == true })
  }

  @Test("a list answered before the drain can't bring the message back")
  func staleListIgnored() async throws {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    try backend.emit("agent.queue", agentId: "a1", payload: Self.event(Self.queued))
    try backend.emit("agent.queue", agentId: "a1", payload: Self.event(""))
    #expect(await eventually { store.queuedByAgent["a1"]?.isEmpty == true })

    backend.responseSeq = 1
    backend.reply("agents.queue_list", #"{"messages":[\#(Self.queued)]}"#)
    await store.loadQueue(agentId: "a1")
    #expect(store.queuedByAgent["a1"]?.isEmpty == true)
  }

  @Test("a reconnect re-reads the queue and replaces stale entries")
  func reconnectReplaces() async throws {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    try backend.emit("agent.queue", agentId: "a1", payload: Self.event(Self.queued))
    #expect(await eventually { store.queuedByAgent["a1"]?.count == 1 })

    // Drained while we were away; the new connection numbers from zero again.
    backend.responseSeq = 0
    backend.reply("agents.queue_list", #"{"messages":[]}"#)
    backend.emitState(.connecting)
    backend.emitState(.ready)
    #expect(await eventually { store.queuedByAgent["a1"]?.isEmpty == true })
    #expect(!backend.calls("agents.queue_list").isEmpty)
  }

  @Test("removing a queued message hides it before the host answers")
  func optimisticRemove() async throws {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    try backend.emit("agent.queue", agentId: "a1", payload: Self.event(Self.queued))
    #expect(await eventually { store.queuedByAgent["a1"]?.count == 1 })

    backend.responseSeq = 5
    backend.reply("agents.queue_list", #"{"messages":[]}"#)
    await store.removeQueued(agentId: "a1", id: "q1")
    #expect(store.queuedByAgent["a1"]?.isEmpty == true)
    #expect(backend.calls("agents.queue_remove").count == 1)
  }
}
