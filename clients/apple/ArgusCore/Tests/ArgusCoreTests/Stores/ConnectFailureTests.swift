import ArgusCore
import ArgusKit
import Testing

@MainActor
@Suite("Connect failure")
struct ConnectFailureTests {
  @Test("a later connection clears the failure instead of surfacing it")
  func clearsOnAttach() async {
    let store = HostStore()
    store.beginConnecting()
    store.connectFailed("Couldn't reach this computer on any known address.")

    await store.attach(FakeBackend())

    #expect(store.lastError == nil)
  }
}
