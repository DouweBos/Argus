@testable import ArgusCore
import Foundation
import Testing

/// The Mac's bundled host when it's already linked somewhere (§5.2b).
@MainActor
@Suite("Account local host")
struct AccountLocalHostTests {
  typealias TestKey = AccountStoreTests.TestKey

  let service = FakeAccountService()
  let auth = FakeAccountAuth()

  func makeStore(vault: AccountVault, localHost: FakeLocalHost) -> AccountStore {
    AccountStore(
      auth: auth, vault: MemoryAccountVault(vault), deviceKind: "mac", deviceName: { "Studio" },
      localHost: localHost, baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
  }

  /// This Mac (key 1) signed in; its host (key 4) on the account too unless `hostOnLog` is
  /// false. Either way the vault has forgotten which host is its own.
  func signedIn(hostOnLog: Bool = true) throws -> (AccountVault, FakeLocalHost, TestKey) {
    let mac = TestKey(1)
    let hostKey = TestKey(4)
    let host = hostKey.host("Studio")
    let g = try AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: nil, signer: mac.signer, .genesis(member: mac.device("Studio")))
    let add = try AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: AccountHead(seq: 0, hash: g.hash), signer: mac.signer,
      .addHost(member: host, requestId: "", sasCommit: "", proof: hostKey.proof(host)))
    let log = hostOnLog ? [g, add] : [g]
    let state = try #require(AccountLog.verify(log).state)
    service.seed(log)
    auth.signedIn = true
    let local = FakeLocalHost(member: host, proof: hostKey.proof(host))
    return (AccountVault(keys: mac.deviceKeys, root: state.root, entries: log), local, hostKey)
  }

  @Test("a host already on this account is taken as this Mac's, with nothing appended")
  func adoptsLinkedHost() async throws {
    let (vault, local, hostKey) = try signedIn()
    local.linked = .init(accountId: service.accountId, epoch: 0, hostId: hostKey.id)
    local.beginError = Transport.TransportError.gateway(
      .init(code: "error", message: "This computer is already linked to an account"))
    let store = makeStore(vault: vault, localHost: local)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.start()
    #expect(store.phase == .ready)
    #expect(store.localHostLinked)
    #expect(store.localLinkError == nil)
    #expect(store.hosts.first?.isLocal == true)
    #expect(service.batches.isEmpty)
    #expect(local.finished == nil)
    #expect(events == [.localHost(outcome: .adopted)])
  }

  @Test("a host on another account is offered the move, and moves when asked")
  func movesHostFromOtherAccount() async throws {
    let (vault, _, _) = try signedIn(hostOnLog: false)
    // Unlinked from the other account, it comes back with fresh keys.
    let fresh = TestKey(5)
    let moved = FakeLocalHost(member: fresh.host("Studio"), proof: fresh.proof(fresh.host("Studio")))
    moved.linked = .init(accountId: "acct-other", epoch: 0, hostId: "someone-else")
    let store = makeStore(vault: vault, localHost: moved)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.start()
    #expect(!store.localHostLinked)
    #expect(store.localLinkConflict)
    #expect(store.localLinkError == "This Mac's host is on another Argus account.")
    #expect(service.batches.isEmpty)

    await store.moveLocalHost()
    #expect(moved.unlinked)
    #expect(store.localHostLinked)
    #expect(!store.localLinkConflict)
    #expect(moved.finished?.accountId == service.accountId)
    #expect(events == [.localHost(outcome: .conflict), .localHost(outcome: .moved)])
  }

  @Test("a host still on the account from before a reset says so")
  func staleEpoch() async throws {
    let (vault, local, hostKey) = try signedIn()
    local.linked = .init(accountId: service.accountId, epoch: 1, hostId: hostKey.id)
    let store = makeStore(vault: vault, localHost: local)
    await store.start()
    #expect(store.localLinkConflict)
    #expect(store.localLinkError == "This Mac's host is still on your account from before it was reset.")
  }

  @Test("the host's refusal shows its own words, not a Foundation error code")
  func hostRefusalText() async throws {
    // The host isn't linked and isn't on the log, but refuses to begin.
    let (vault, local, _) = try signedIn(hostOnLog: false)
    local.beginError = Transport.TransportError.gateway(.init(code: "error", message: "The account's log didn't check out"))
    let store = makeStore(vault: vault, localHost: local)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.start()
    #expect(!store.localHostLinked)
    #expect(store.localLinkError == "The account's log didn't check out")
    #expect(!store.localLinkConflict)
    #expect(events == [.localHost(outcome: .failed)])
  }
}
