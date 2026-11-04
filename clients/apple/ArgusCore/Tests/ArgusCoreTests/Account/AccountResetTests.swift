@testable import ArgusCore
import Foundation
import Testing

/// Starting the account over (§5.8): only after a fresh factor, with keys the
/// account never saw; and a device on the old epoch noticing and asking again.
@MainActor
@Suite("Account reset")
struct AccountResetTests {
  typealias TestKey = AccountStoreTests.TestKey

  let service = FakeAccountService()
  let auth = FakeAccountAuth()
  let phone = TestKey(1)

  func makeStore() -> (AccountStore, MemoryAccountVault) {
    let memory = MemoryAccountVault(.empty)
    let store = AccountStore(
      auth: auth, vault: memory, deviceKind: "mac", deviceName: { "Studio" },
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
    return (store, memory)
  }

  func phoneGenesis(epoch: Int) -> AccountEntry {
    try! AccountEntryBuilder.make(
      accountId: service.accountId, epoch: epoch, head: nil, signer: phone.signer,
      .genesis(member: phone.device("Phone")))
  }

  /// Signed in on an account whose only device is gone: asking to join, nobody to approve.
  func stranded() async throws -> (AccountStore, MemoryAccountVault, String) {
    service.seed([phoneGenesis(epoch: 0)])
    let (store, memory) = makeStore()
    await store.start()
    await store.signIn(with: .github)
    #expect(store.phase == .awaitingApproval)
    return (store, memory, try #require(service.joinIds.first))
  }

  @Test("a stranded device resets after confirming a code, with fresh keys")
  func resetsAfterCode() async throws {
    let (store, memory, requestId) = try await stranded()
    let joiningKeys = try #require(await memory.vault.keys)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    #expect(store.canReset)

    await store.beginReset()
    #expect(store.reset == .awaitingCode(email: "me@example.test"))
    await store.confirmResetCode("000000")
    #expect(store.reset == .awaitingCode(email: "me@example.test"))
    #expect(store.error != nil)

    await store.confirmResetCode("424242")

    #expect(store.phase == .ready)
    #expect(store.reset == .idle)
    #expect(service.currentEpoch == 1)
    let keys = try #require(await memory.vault.keys)
    #expect(keys.memberId != joiningKeys.memberId)
    #expect(keys.signPub != joiningKeys.signPub)
    #expect(store.members.map(\.id) == [keys.memberId])
    #expect(await memory.vault.root?.epoch == 1)
    #expect(service.join(requestId)?.status == "denied")
    #expect(auth.sentReverifyCodes == 1)
    #expect(events == [.accountReset(action: .started), .accountReset(action: .completed)])
  }

  @Test("a recently reverified session resets without another code")
  func resetsWhenReverified() async throws {
    let (store, _, _) = try await stranded()
    auth.reverified = true

    await store.beginReset()

    #expect(store.phase == .ready)
    #expect(auth.sentReverifyCodes == 0)
    #expect(service.currentEpoch == 1)
  }

  @Test("the service's refusal falls back to a code")
  func serviceWantsFresherFactor() async throws {
    let (store, _, _) = try await stranded()
    auth.reverified = false

    await store.beginReset()

    #expect(store.reset == .awaitingCode(email: "me@example.test"))
    #expect(service.currentEpoch == 0)
  }

  @Test("a device on the old epoch notices, drops its keys and asks to join again")
  func followsReset() async throws {
    let (store, memory) = makeStore()
    await store.start()
    await store.signIn(with: .github)
    #expect(store.phase == .ready)
    let oldKeys = try #require(await memory.vault.keys)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    let genesis = phoneGenesis(epoch: 1)
    service.resetElsewhere(genesis)

    await store.refresh()

    #expect(store.phase == .awaitingApproval)
    #expect(store.resetNotice?.epoch == 1)
    #expect(store.resetNotice?.byName == "Phone")
    #expect(store.resetNotice?.at != nil)
    #expect(store.hosts.isEmpty)
    let keys = try #require(await memory.vault.keys)
    #expect(keys.memberId != oldKeys.memberId)
    #expect(await memory.vault.root == nil)
    #expect(service.joinIds.count == 1)
    #expect(events.first == .accountReset(action: .seen))
  }
}
