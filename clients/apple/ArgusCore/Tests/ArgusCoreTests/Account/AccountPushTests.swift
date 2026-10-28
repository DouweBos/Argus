@testable import ArgusCore
import ArgusKit
import Foundation
import Testing

/// Push through the account (phase 3): the phone seals its push key for every
/// host on the account and re-seals when they change; a wake-up re-reads the
/// account so removals apply and new join requests are announced once.
@MainActor
@Suite("Account push")
struct AccountPushTests {
  typealias TestKey = AccountStoreTests.TestKey

  let service = FakeAccountService()
  let auth = FakeAccountAuth()
  let keys = AccountDeviceKeys.generate(kind: "ios", name: "Phone")
  let pushKey = Data(repeating: 7, count: 32)

  var token: AccountPushToken {
    AccountPushToken(token: "apns-token", environment: "sandbox", pushKey: AccountCodec.b64(pushKey))
  }

  func host(_ key: TestKey, noise: NoiseKeypair, name: String) -> AccountMember {
    AccountMember(
      id: key.id, role: .host, platform: "darwin", signPub: key.signPub, noisePub: AccountCodec.b64(noise.pub),
      name: name, createdAt: 1)
  }

  func append(_ fields: AccountEntryBuilder.Fields, signer: AccountSigner) throws {
    let head = service.log.isEmpty ? nil : AccountHead(seq: service.log.count - 1, hash: service.headHash)
    service.inject(
      try AccountEntryBuilder.make(accountId: service.accountId, epoch: 0, head: head, signer: signer, fields))
  }

  /// This phone's account with one host, already resumed.
  func readyStore(hostNoise: NoiseKeypair) async throws -> (AccountStore, AccountMember) {
    let signer = try #require(keys.signer)
    try append(.genesis(member: keys.member), signer: signer)
    let mini = TestKey(2)
    let member = host(mini, noise: hostNoise, name: "Mini")
    try append(.addHost(member: member, requestId: "", sasCommit: "", proof: mini.proof(member)), signer: signer)
    let state = try #require(AccountLog.verify(service.log).state)
    auth.signedIn = true
    let store = AccountStore(
      auth: auth, vault: MemoryAccountVault(AccountVault(keys: keys, root: state.root, entries: service.log)),
      deviceKind: "ios", deviceName: { "Phone" }, baseURL: URL(string: "https://example.test/argus/account/v1")!,
      http: service.http, joinPollInterval: .seconds(3600))
    await store.start()
    #expect(store.phase == .ready)
    return (store, member)
  }

  func waitFor(_ condition: () -> Bool) async {
    for _ in 0..<200 where !condition() { try? await Task.sleep(for: .milliseconds(5)) }
  }

  @Test("seals the push key for each host, and re-seals when a host joins")
  func registers() async throws {
    let miniNoise = NoiseCrypto.generateKeypair()
    let (store, mini) = try await readyStore(hostNoise: miniNoise)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }

    await store.setPushToken(token)
    let first = try #require(service.pushRegistrations.first)
    #expect(first["device_id"] as? String == keys.memberId)
    #expect(first["token"] as? String == "apns-token")
    let sealed = try #require((first["sealed_keys"] as? [String: String])?[mini.id])
    let opened = AccountPushKey.open(
      sealed, hostNoisePriv: miniNoise.priv, deviceNoisePub: try #require(AccountCodec.fromB64(keys.noisePub)),
      deviceId: keys.memberId, hostId: mini.id)
    #expect(opened == pushKey)
    #expect(events == [.pushRegistered(success: true)])

    await store.setPushToken(token)
    #expect(service.pushRegistrations.count == 1)

    let studio = TestKey(3)
    let studioMember = host(studio, noise: NoiseCrypto.generateKeypair(), name: "Studio")
    try append(
      .addHost(member: studioMember, requestId: "", sasCommit: "", proof: studio.proof(studioMember)),
      signer: try #require(keys.signer))
    await store.refresh()
    await waitFor { service.pushRegistrations.count == 2 }
    let second = try #require(service.pushRegistrations.last?["sealed_keys"] as? [String: String])
    #expect(Set(second.keys) == [mini.id, studio.id])

    await store.setPushToken(nil)
    #expect(service.pushUnregistered == [keys.memberId])
  }

  @Test("a wake-up announces each new join request once")
  func wakeAnnouncesJoins() async throws {
    let (store, _) = try await readyStore(hostNoise: NoiseCrypto.generateKeypair())
    let tablet = TestKey(5)
    let requestId = service.addJoin(member: tablet.device("Tablet"), proof: tablet.proof(tablet.device("Tablet")))

    let woken = await store.handleWake(alreadySeen: [], pushToken: token)
    #expect(woken.reached)
    #expect(woken.newRequests.map(\.requestId) == [requestId])
    #expect(service.pushRegistrations.count == 1)

    let again = await store.handleWake(alreadySeen: [requestId])
    #expect(again.newRequests.isEmpty)
  }

  @Test("a wake-up applies this device's removal")
  func wakeAppliesRemoval() async throws {
    let (store, _) = try await readyStore(hostNoise: NoiseCrypto.generateKeypair())
    let tablet = TestKey(5)
    let member = tablet.device("Tablet")
    try append(
      .addDevice(member: member, requestId: "", sasCommit: "", proof: tablet.proof(member)),
      signer: try #require(keys.signer))
    try append(.revoke(memberId: keys.memberId, reason: "removed"), signer: tablet.signer)

    let woken = await store.handleWake(alreadySeen: [])
    #expect(woken.removed)
    #expect(store.phase == .signedOut)
  }
}
