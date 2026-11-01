import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Background refresh")
struct BackgroundRefreshTests {
  private func store(_ reported: @escaping @MainActor (String) -> Void) -> HostStore {
    HostStore(hooks: HostStoreHooks(errorReported: { _, scope in reported(scope) }))
  }

  @Test("a lost connection is transient, a refused request is not")
  func classification() {
    #expect(HostStore.isTransient(Transport.TransportError.notReady))
    #expect(HostStore.isTransient(Transport.TransportError.timedOut))
    #expect(HostStore.isTransient(URLError(.networkConnectionLost)))
    #expect(!HostStore.isTransient(Transport.TransportError.gateway(.init(code: "x", message: "no"))))
    #expect(!HostStore.isTransient(URLError(.badURL)))
  }

  @Test("only a background refresh keeps a lost connection quiet")
  func quietOnlyInBackground() async {
    #expect(!HostStore.isQuiet(Transport.TransportError.notReady))
    #expect(HostStore.isQuiet(CancellationError()))
    await BackgroundRefresh.run {
      #expect(HostStore.isQuiet(Transport.TransportError.notReady))
      #expect(HostStore.isQuiet(Transport.TransportError.timedOut))
      #expect(!HostStore.isQuiet(Transport.TransportError.gateway(.init(code: "x", message: "no"))))
      // Tasks a refresh starts inherit it.
      let inherited = await Task { HostStore.isQuiet(Transport.TransportError.notReady) }.value
      #expect(inherited)
    }
  }

  @Test("polls that hit a dropped connection report nothing")
  func pollsStayQuiet() async {
    var reported: [String] = []
    let host = store { reported.append($0) }
    let backend = FakeBackend()
    backend.fail(.proposalsList, with: Transport.TransportError.notReady)
    backend.fail(.usageLimits, with: Transport.TransportError.timedOut)
    await host.attach(backend)
    let proposals = ProposalsStore(host: host)

    await BackgroundRefresh.run {
      await proposals.refresh()
      await host.loadUsageLimits()
      host.report(Transport.TransportError.notReady)
    }
    #expect(reported.isEmpty)
    #expect(proposals.error == nil)
    #expect(host.usageLimitsError == nil)
    #expect(host.lastError == nil)
  }

  @Test("a background refresh still reports a real failure")
  func realFailuresStillReport() async {
    var reported: [String] = []
    let host = store { reported.append($0) }
    let backend = FakeBackend()
    backend.fail(.usageLimits, with: Transport.TransportError.gateway(.init(code: "internal", message: "boom")))
    await host.attach(backend)

    await BackgroundRefresh.run { await host.loadUsageLimits() }
    #expect(reported == ["usage_limits"])
    #expect(host.usageLimitsError == "boom")
  }

  @Test("what the user asked for still surfaces a lost connection")
  func userActionsSurface() async {
    var reported: [String] = []
    let host = store { reported.append($0) }
    let backend = FakeBackend()
    backend.fail(.proposalsList, with: Transport.TransportError.notReady)
    await host.attach(backend)
    let proposals = ProposalsStore(host: host)

    await proposals.refresh()
    host.report(Transport.TransportError.timedOut)
    #expect(reported == ["proposals", "app"])
    #expect(proposals.error != nil)
    #expect(host.lastError == "The computer didn't answer in time.")
  }
}
