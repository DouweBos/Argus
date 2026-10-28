@testable import ArgusCore
import Foundation
import Testing

@MainActor
@Suite("Account presence")
struct AccountPresenceTests {
  typealias TestKey = AccountStoreTests.TestKey

  final class Clock {
    var now = Date(timeIntervalSince1970: 1_800_000_000)
  }

  let service = FakeAccountService()
  let auth = FakeAccountAuth()
  let clock = Clock()
  let phone = TestKey(1)
  let mini = TestKey(2)

  /// Signed in on a phone, with the Mini on the account and nothing in the directory yet.
  func readyStore() async throws -> AccountStore {
    let genesis = try AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: nil, signer: phone.signer,
      .genesis(member: phone.device("Phone")))
    let add = try AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: AccountHead(seq: 0, hash: genesis.hash), signer: phone.signer,
      .addHost(member: mini.host("Mini"), requestId: "", sasCommit: "", proof: mini.proof(mini.host("Mini"))))
    let state = try #require(AccountLog.verify([genesis, add]).state)
    service.seed([genesis, add])
    auth.signedIn = true
    let store = AccountStore(
      auth: auth,
      vault: MemoryAccountVault(AccountVault(keys: phone.deviceKeys, root: state.root, entries: [genesis, add])),
      deviceKind: "ios", deviceName: { "Phone" },
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      now: { [clock] in clock.now })
    await store.start()
    #expect(store.phase == .ready)
    return store
  }

  /// The Mini checked in at `lastSeen`.
  func seen(at lastSeen: Date, ts: Int) throws {
    let body = """
      {"v":1,"account_id":"\(service.accountId)","epoch":0,"host_id":"\(mini.id)","ts":\(ts),"endpoints":[{"kind":"cloudflare","url":"wss://mini.example","priority":2}]}
      """
    let sig = try AccountCodec.sign(AccountCodec.presenceSigningBytes(body), seed: mini.seed)
    service.setDirectory([
      AccountDirectoryRecord(
        hostId: mini.id, presenceBody: body, presenceSig: sig, lastSeen: lastSeen.timeIntervalSince1970 * 1000)
    ])
  }

  @Test("a host that comes online while the list is open shows online on the next poll")
  func comesOnline() async throws {
    let store = try await readyStore()
    #expect(store.host(mini.id)?.online == false)
    clock.now += 120
    try seen(at: clock.now, ts: 1)
    await store.refreshDirectory()
    #expect(store.host(mini.id)?.online == true)
  }

  @Test("heartbeats keep a host online across polls")
  func heartbeats() async throws {
    let store = try await readyStore()
    for beat in 1...6 {
      clock.now += 5 * 60
      try seen(at: clock.now, ts: beat)
      await store.refreshDirectory()
      #expect(store.host(mini.id)?.online == true)
    }
  }

  @Test("online is recomputed against now even when the directory can't be reached")
  func goesQuiet() async throws {
    let store = try await readyStore()
    try seen(at: clock.now, ts: 1)
    await store.refreshDirectory()
    #expect(store.host(mini.id)?.online == true)
    service.setDirectoryDown(true)
    clock.now += AccountPresence.onlineWindow + 1
    await store.refreshDirectory()
    #expect(store.host(mini.id)?.online == false)
    #expect(store.host(mini.id)?.endpoints.map(\.url) == ["wss://mini.example"])
  }

  @Test("the online window outlasts several missed heartbeats, and polling is well inside it")
  func windows() {
    let heartbeat: TimeInterval = 5 * 60
    #expect(AccountPresence.onlineWindow >= 3 * heartbeat)
    #expect(AccountStore.presencePollInterval < .seconds(AccountPresence.onlineWindow / 2))
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let ms = now.timeIntervalSince1970 * 1000
    #expect(AccountPresence.isOnline(lastSeenMs: ms - 2 * heartbeat * 1000, now: now))
    #expect(AccountPresence.isOnline(lastSeenMs: ms - AccountPresence.onlineWindow * 1000, now: now))
    #expect(!AccountPresence.isOnline(lastSeenMs: ms - AccountPresence.onlineWindow * 1000 - 1, now: now))
    #expect(!AccountPresence.isOnline(lastSeenMs: nil, now: now))
  }
}
