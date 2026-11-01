import ArgusCore
import Foundation
import Testing

@MainActor
@Suite("Load phase")
struct LoadPhaseTests {
  @Test func tellsLoadingFromEmptyFromFailed() {
    #expect(LoadPhase(loaded: false, error: nil, isEmpty: true) == .loading)
    #expect(LoadPhase(loaded: true, error: nil, isEmpty: true) == .empty)
    #expect(LoadPhase(loaded: true, error: "nope", isEmpty: true) == .failed("nope"))
    #expect(LoadPhase(loaded: false, error: "nope", isEmpty: true) == .failed("nope"))
  }

  @Test func rowsOnScreenAlwaysWin() {
    #expect(LoadPhase(loaded: false, error: nil, isEmpty: false) == .content)
    #expect(LoadPhase(loaded: true, error: "refresh failed", isEmpty: false) == .content)
    #expect(LoadPhase(loaded: true, error: nil, isEmpty: false).showsContent)
    #expect(!LoadPhase(loaded: false, error: nil, isEmpty: true).showsContent)
  }

  // A screen left mid-load cancels its request; that must not read as "none".

  @Test func cancelledPullRequestsStayLoading() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.cancel("github.pull_requests")
    let host = HostStore()
    await host.attach(backend)
    let store = PullRequestsStore(host: host)

    await store.refresh()
    #expect(!store.loaded)
    #expect(store.error == nil)

    let fresh = RecordingBackend(kind: .gateway)
    fresh.reply("github.pull_requests", #"{"pull_requests":[]}"#)
    await host.attach(fresh)
    await store.refresh()
    #expect(store.loaded)
  }

  @Test func failedPullRequestsSettleWithTheError() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.fail("github.pull_requests")
    let host = HostStore()
    await host.attach(backend)
    let store = PullRequestsStore(host: host)

    await store.refresh()
    #expect(store.loaded)
    #expect(store.error != nil)
  }

  @Test func cancelledAutomationsStayLoading() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.cancel("automations.list")
    backend.cancel("automations.runs")
    let host = HostStore()
    await host.attach(backend)
    let store = AutomationsStore(host: host)

    let task = Task { await store.refresh() }
    task.cancel()
    await task.value
    #expect(store.phase == .loading)
  }

  @Test func automationsWithNothingAreEmpty() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("automations.list", #"{"automations":[]}"#)
    backend.reply("automations.runs", #"{"runs":[]}"#)
    let host = HostStore()
    await host.attach(backend)
    let store = AutomationsStore(host: host)

    #expect(store.phase == .loading)
    await store.refresh()
    #expect(store.phase == .empty)
  }

  @Test func automationsThatFailedSayWhy() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.fail("automations.list")
    backend.fail("automations.runs")
    let host = HostStore()
    await host.attach(backend)
    let store = AutomationsStore(host: host)

    await store.refresh()
    #expect(store.phase == .failed("Couldn't read automations."))
  }

  @Test func cancelledProposalsStayLoading() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.cancel("proposals.list")
    let host = HostStore()
    await host.attach(backend)
    let store = ProposalsStore(host: host)

    await store.refresh()
    #expect(!store.loaded)
    #expect(store.error == nil)
  }

  @Test func cancelledInboxStaysLoading() async {
    let backend = RecordingBackend()
    backend.cancel("proposals_list")
    backend.cancel("automation_runs_list")
    let host = HostStore()
    await host.attach(backend)
    let store = InboxStore(host: host)

    let task = Task { await store.refresh() }
    task.cancel()
    await task.value
    #expect(!store.loaded)
    #expect(store.error == nil)
  }
}
