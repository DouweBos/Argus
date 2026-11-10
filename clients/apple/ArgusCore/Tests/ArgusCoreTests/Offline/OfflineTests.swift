import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
@Suite("Offline reading and replies")
struct OfflineTests {
  private func files() -> SealedFiles {
    SealedFiles(
      directory: FileManager.default.temporaryDirectory.appendingPathComponent("offline-\(UUID().uuidString)"),
      key: Data(repeating: 7, count: 32))
  }

  private let transcript = #"{"messages":[{"id":"m1","role":"assistant","text_blocks":["Done."],"tool_calls":[]}]}"#

  @Test("saved answers are sealed on disk and survive a relaunch")
  func sealedAcrossLaunches() throws {
    let folder = files()
    let saved = SavedAnswers(files: folder)
    let key = SavedAnswers.key("agents.transcript", ["agent_id": "a1"])
    saved.save(.object(["text": .string("secret words")]), key: key)

    for name in folder.names() {
      let raw = try Data(contentsOf: folder.directory.appendingPathComponent(name))
      #expect(!String(decoding: raw, as: UTF8.self).contains("secret words"))
    }
    let reopened = SavedAnswers(files: folder)
    #expect(reopened.answer(key)?.value == .object(["text": .string("secret words")]))
    #expect(SavedAnswers(files: SealedFiles(directory: folder.directory, key: Data(repeating: 1, count: 32)))
      .answer(key) == nil)
  }

  @Test("the least recently used answers go first once over budget")
  func evictsOldest() {
    let saved = SavedAnswers(files: files(), budget: 300)
    let big = JSONValue.string(String(repeating: "x", count: 120))
    saved.save(big, key: "a", now: Date(timeIntervalSince1970: 1))
    saved.save(big, key: "b", now: Date(timeIntervalSince1970: 2))
    _ = saved.answer("a", now: Date(timeIntervalSince1970: 3))
    saved.save(big, key: "c", now: Date(timeIntervalSince1970: 4))
    #expect(saved.answer("a") != nil)
    #expect(saved.answer("b") == nil)
    #expect(saved.answer("c") != nil)
  }

  @Test("a read the connection can't carry is answered from what was saved")
  func readsFallBack() async throws {
    let folder = files()
    let saved = SavedAnswers(files: folder)
    let live = FakeBackend(kind: .gateway)
    live.reply(.agentsTranscript, transcript)
    let store = HostStore()
    await store.openOffline(saved: saved, outbox: nil)
    await store.attach(live)
    await store.loadTranscript(agentId: "a1")
    #expect(store.messagesByAgent["a1"]?.count == 1)
    await store.detach()

    // A relaunch with no connection at all.
    let offline = HostStore()
    await offline.openOffline(saved: SavedAnswers(files: folder), outbox: nil)
    await offline.loadTranscript(agentId: "a1")
    #expect(offline.messagesByAgent["a1"]?.first?.id == "m1")
    #expect(await eventually { offline.savedAsOf != nil })
    #expect(offline.liveBackend == nil)
  }

  @Test("the computer refusing a read is not papered over")
  func refusalsStand() async {
    let saved = SavedAnswers(files: files())
    saved.save(.object(["status": .object([:])]), key: SavedAnswers.key("sessions.git_status", ["session_id": "s1"]))
    let live = FakeBackend(kind: .gateway)
    live.fail(.sessionsGitStatus, with: Transport.TransportError.gateway(GatewayErrorPayload(code: "x", message: "no")))
    let backend = SavingBackend(live: live, saved: saved)
    struct Params: Encodable, Sendable { let session_id: String }
    await #expect(throws: Transport.TransportError.self) {
      try await backend.request(.sessionsGitStatus, Params(session_id: "s1"), as: JSONValue.self)
    }
  }

  @Test("a reply written offline waits on disk and goes on reconnect")
  func outboxReplays() async throws {
    var events: [StoreEvent] = []
    let folder = files()
    let store = HostStore(hooks: HostStoreHooks(track: { events.append($0) }))
    await store.openOffline(saved: SavedAnswers(files: folder.folder("saved")), outbox: Outbox(files: folder))
    await store.sendMessage(agentId: "a1", message: "ship it")
    #expect(store.outboxByAgent["a1"]?.first?.body == "ship it")
    #expect(store.failedByAgent["a1"] == nil)
    #expect(store.optimisticByAgent["a1"] == nil)

    // Relaunched, still offline: the reply is still waiting.
    let relaunched = HostStore(hooks: HostStoreHooks(track: { events.append($0) }))
    await relaunched.openOffline(saved: SavedAnswers(files: folder.folder("saved")), outbox: Outbox(files: folder))
    #expect(relaunched.outboxByAgent["a1"]?.count == 1)

    let live = FakeBackend(kind: .gateway)
    live.reply(.agentsSend, #"{"queued":false}"#)
    live.reply(.agentsTranscript, #"{"messages":[]}"#)
    await relaunched.attach(live)
    #expect(await eventually { live.count(.agentsSend) == 1 })
    #expect(live.params(.agentsSend)?["message"] as? String == "ship it")
    #expect(relaunched.outboxByAgent["a1"] == nil)
    #expect(Outbox(files: folder).load().isEmpty)
    #expect(events.contains(.offlineReply(action: .queued)))
    #expect(events.contains(.offlineReply(action: .replayed)))
  }

  @Test("an approval given offline is queued, not refused")
  func approvalsQueue() async {
    var undelivered: [String] = []
    let store = HostStore(hooks: HostStoreHooks(decisionUndelivered: { agent, _, _ in undelivered.append(agent) }))
    await store.openOffline(saved: SavedAnswers(files: files()), outbox: Outbox(files: files()))
    await store.respond(agentId: "a1", toolUseId: "t1", decision: "allow")
    #expect(undelivered == ["a1"])
    #expect(store.lastError == nil)
    #expect(store.answered.contains(store.promptKey("a1", "t1")))
  }

  @Test("old replies are dropped rather than sent a day late")
  func outboxExpires() {
    let outbox = Outbox(files: files())
    let message = FailedSend(id: "o1", body: "hi", displayText: nil, images: [])
    outbox.save([Outbox.Entry(agentId: "a1", message: message, at: Date(timeIntervalSince1970: 0))])
    #expect(outbox.load().isEmpty)
    #expect(outbox.load(now: Date(timeIntervalSince1970: 60)).count == 1)
  }
}
