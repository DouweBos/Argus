@testable import ArgusCore
import Foundation
import Testing

/// A live member works on its own key: losing the Clerk session takes nothing
/// away; only a removal, a reset or a sign-out does.
@MainActor
@Suite("Account member auth")
struct AccountMemberAuthTests {
  typealias TestKey = AccountStoreTests.TestKey

  let service = FakeAccountService()
  let auth = FakeAccountAuth()
  let phone = TestKey(1)
  let tablet = TestKey(3)
  let recorded = Recorded()

  /// Events from the launch on, the ones `start()` sends included.
  @MainActor final class Recorded {
    var events: [AccountStore.Event] = []
  }

  func genesis() -> AccountEntry {
    try! AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: nil, ts: 1, signer: phone.signer,
      .genesis(member: phone.device("Phone")))
  }

  /// This phone, cached on a one-device account, launched with or without a Clerk session.
  func launch(signedIn: Bool, log extra: [AccountEntry] = []) async throws -> (AccountStore, MemoryAccountVault) {
    let g = genesis()
    let state = try #require(AccountLog.verify([g]).state)
    service.seed([g] + extra)
    auth.signedIn = signedIn
    let memory = MemoryAccountVault(AccountVault(keys: phone.deviceKeys, root: state.root, entries: [g]))
    let store = AccountStore(
      auth: auth, vault: memory, deviceKind: "ios", deviceName: { "Phone" },
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
    store.onEvent = { [recorded] in recorded.events.append($0) }
    await store.start()
    return (store, memory)
  }

  /// Another device took this one off the account.
  func revokePhone(by other: TestKey) throws {
    let log = service.log
    let head = AccountHead(seq: log.count - 1, hash: log.last!.hash)
    service.inject(
      try AccountEntryBuilder.make(
        accountId: service.accountId, epoch: 0, head: head, signer: other.signer,
        .revoke(memberId: phone.id, reason: "removed")))
  }

  /// The tablet, added by the phone, so it can later remove the phone.
  func tabletEntry() throws -> AccountEntry {
    let g = genesis()
    let member = tablet.device("Tablet")
    return try AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: AccountHead(seq: 0, hash: g.hash), signer: phone.signer,
      .addDevice(member: member, requestId: "", sasCommit: "", proof: tablet.proof(member)))
  }

  @Test("no Clerk session: the device stays on and syncs on its own key")
  func noSessionStaysOn() async throws {
    let (store, memory) = try await launch(signedIn: false)
    await store.refresh()
    #expect(store.phase == .ready)
    #expect(store.error == nil)
    #expect(recorded.events.isEmpty)
    #expect(!store.removedNotice)
    #expect(await memory.load().keys == phone.deviceKeys)
    #expect(service.memberSigned.contains("log"))
    #expect(service.memberSigned.contains("directory"))
    #expect(service.clerkAuthed.isEmpty)
  }

  @Test("signed in, a live member still uses its key for everything but identity")
  func signedInStillSigns() async throws {
    let (store, _) = try await launch(signedIn: true)
    await store.refresh()
    #expect(store.phase == .ready)
    #expect(!service.memberSigned.isEmpty)
    #expect(service.clerkAuthed.isEmpty)
  }

  @Test("a removal another device made reaches a device with no session: removed, keys gone")
  func removedWithoutSession() async throws {
    let (store, memory) = try await launch(signedIn: false, log: [try tabletEntry()])
    try revokePhone(by: tablet)
    await store.refresh()
    #expect(store.phase == .signedOut)
    #expect(store.removedNotice)
    #expect(store.error == "This device was removed from your account.")
    #expect(recorded.events == [.memberAuth(outcome: .removed)])
    #expect(await memory.load().keys == nil)
    store.dismissRemovedNotice()
    #expect(!store.removedNotice)
  }

  @Test("signing in after a removal asks to join again")
  func joinAfterRemoval() async throws {
    let (store, _) = try await launch(signedIn: false, log: [try tabletEntry()])
    try revokePhone(by: tablet)
    await store.refresh()
    await store.signIn(with: .github)
    #expect(store.phase == .awaitingApproval)
    #expect(!store.removedNotice)
  }

  @Test("a deliberate sign-out never shows the removed notice")
  func signOutNoNotice() async throws {
    let (store, _) = try await launch(signedIn: true)
    await store.signOut()
    #expect(store.phase == .signedOut)
    #expect(!store.removedNotice)
    #expect(auth.signedOut)
  }

  @Test("an old service: one Clerk retry, then Clerk for the launch, reported once")
  func legacyServiceFallsBack() async throws {
    service.setDeviceAuth(.legacy)
    let (store, _) = try await launch(signedIn: true)
    await store.refresh()
    await store.refresh()
    // The fallback report hops to the main actor.
    for _ in 0..<10 where recorded.events.isEmpty { await Task.yield() }
    #expect(store.phase == .ready)
    #expect(store.error == nil)
    #expect(service.memberSigned.isEmpty)
    #expect(service.clerkAuthed.contains("log"))
    #expect(recorded.events.filter { $0 == .memberAuth(outcome: .clerkFallback) }.count == 1)
  }

  @Test("an old service and no session: still on the account, just not syncing")
  func legacyServiceNoSession() async throws {
    service.setDeviceAuth(.legacy)
    let (store, memory) = try await launch(signedIn: false)
    await store.refresh()
    await store.refresh()
    #expect(store.phase == .ready)
    #expect(store.error == AccountServiceError.memberRefused(status: 403).message)
    #expect(recorded.events == [.memberAuth(outcome: .refused)])
    #expect(await memory.load().keys == phone.deviceKeys)
  }

  @Test("a reset elsewhere reaches a member through its refused signature")
  func resetElsewhere() async throws {
    let (store, memory) = try await launch(signedIn: false)
    let other = TestKey(4)
    service.resetElsewhere(
      try AccountEntryBuilder.make(
        accountId: service.accountId, epoch: 1, head: nil, signer: other.signer,
        .genesis(member: other.device("Other phone"))))
    await store.refresh()
    #expect(store.phase == .signedOut)
    #expect(store.resetNotice?.epoch == 1)
    #expect(store.resetNotice?.byName == "Other phone")
    #expect(recorded.events == [.accountReset(action: .seen)])
    #expect(await memory.load().keys == nil)
  }

  @Test("a reset with no sign-in asks for one first, and nothing leaves the account")
  func resetNeedsSignIn() async throws {
    let (store, _) = try await launch(signedIn: false)
    #expect(store.canReset)
    await store.beginReset()
    #expect(store.signInNeeded == .reset)
    #expect(store.reset == .idle)
    #expect(store.phase == .ready)
    #expect(recorded.events == [.accountReset(action: .signInNeeded)])

    await store.signIn(with: .github)
    #expect(store.phase == .ready)
    #expect(store.signInNeeded == nil)
    #expect(service.batches.isEmpty)
  }

  @Test("a vault a lost session flagged signed out comes back on its own")
  func oldSignedOutVaultResumes() async throws {
    let g = genesis()
    let state = try #require(AccountLog.verify([g]).state)
    var json = try #require(
      try JSONSerialization.jsonObject(
        with: JSONEncoder().encode(AccountVault(keys: phone.deviceKeys, root: state.root, entries: [g])))
        as? [String: Any])
    json["signedOut"] = true
    json["signedOutReason"] = "expired"
    let vault = try JSONDecoder().decode(AccountVault.self, from: JSONSerialization.data(withJSONObject: json))
    service.seed([g])
    let store = AccountStore(
      auth: auth, vault: MemoryAccountVault(vault), deviceKind: "ios", deviceName: { "Phone" },
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
    await store.start()
    #expect(store.phase == .ready)
  }
}
