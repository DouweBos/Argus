import ArgusCore
import ArgusKit
import Foundation
import Testing

/// What the client tells the host it shows, so the host keeps a warm agent there.
@MainActor
@Suite("Viewing hint")
struct ViewingTests {
  @Test("reports the session on screen, and nothing once the screen goes")
  func reportsAndClears() async {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)

    let token = await store.reportViewing(sessionId: "s-1", runnerId: "custom:apex")
    #expect(backend.params(.sessionsViewing)?["session_id"] as? String == "s-1")
    #expect(backend.params(.sessionsViewing)?["runner_id"] as? String == "custom:apex")

    await store.stopViewing(token: token)
    #expect(backend.params(.sessionsViewing)?["session_id"] == nil)
    #expect(store.viewingSessionId == nil)
  }

  @Test("a screen that went away doesn't clear what the next one reported")
  func staleScreenKeepsQuiet() async {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)

    let first = await store.reportViewing(sessionId: "s-1")
    await store.reportViewing(sessionId: "s-2")
    await store.stopViewing(token: first)

    #expect(store.viewingSessionId == "s-2")
    #expect(backend.count(.sessionsViewing) == 2)
  }

  @Test("says it again after a reconnect")
  func resendsAfterReconnect() async {
    let store = HostStore()
    let backend = FakeBackend()
    await store.attach(backend)
    await store.reportViewing(sessionId: "s-1")

    backend.emitState(.connecting)
    backend.emitState(.ready)

    #expect(await eventually { backend.count(.sessionsViewing) == 2 })
  }

  @Test("loads a start composer's options for its session")
  func loadsStartOptions() async {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(
      .sessionsStartOptions,
      #"{"capabilities":{"models":[{"value":"opus","displayName":"Opus","description":""}],"commands":[{"name":"review","description":"","argumentHint":""}],"agents":[]}}"#
    )
    await store.attach(backend)

    await store.loadStartOptions(sessionId: "s-1")

    #expect(store.startOptionsBySession["s-1"]?.models.map(\.value) == ["opus"])
    #expect(store.startOptionsBySession["s-1"]?.commands.map(\.name) == ["review"])
  }
}
