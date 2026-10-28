@testable import ArgusCore
import CryptoKit
import Foundation
import Testing

@MainActor
@Suite("Account store")
struct AccountStoreTests {
  /// A member with a deterministic Ed25519 key.
  struct TestKey {
    let id: String
    let seed: Data
    var signPub: String { try! AccountCodec.signingPublicKey(seed: seed) }
    var noisePub: String { Data(repeating: seed[0] &+ 100, count: 32).base64EncodedString() }
    var signer: AccountSigner { AccountSigner(id: id, seed: seed) }

    init(_ byte: UInt8) {
      id = "00000000-0000-4000-8000-0000000000\(String(format: "%02d", byte))"
      seed = Data(repeating: byte, count: 32)
    }

    func host(_ name: String) -> AccountMember {
      AccountMember(id: id, role: .host, platform: "darwin", signPub: signPub, noisePub: noisePub, name: name, createdAt: 1)
    }

    func device(_ name: String, kind: String = "ios") -> AccountMember {
      .device(id: id, kind: kind, signPub: signPub, noisePub: noisePub, name: name, createdAt: 1)
    }

    func proof(_ member: AccountMember) -> String { try! AccountEntryBuilder.proof(for: member, seed: seed) }

    var deviceKeys: AccountDeviceKeys {
      AccountDeviceKeys(
        memberId: id, signSeed: seed.base64EncodedString(), signPub: signPub,
        noisePriv: Data(repeating: 9, count: 32).base64EncodedString(), noisePub: noisePub, kind: "ios",
        name: "Phone", createdAt: 1)
    }
  }

  let service = FakeAccountService()
  let auth = FakeAccountAuth()

  func makeStore(vault: AccountVault = .empty, localHost: (any AccountLocalHostLinking)? = nil)
    -> (AccountStore, MemoryAccountVault)
  {
    let memory = MemoryAccountVault(vault)
    let store = AccountStore(
      auth: auth, vault: memory, deviceKind: "ios", deviceName: { "Phone" }, localHost: localHost,
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
    return (store, memory)
  }

  func genesis(_ key: TestKey) -> AccountEntry {
    try! AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: nil, signer: key.signer, .genesis(member: key.device("Other")))
  }

  @Test("the first sign-in on an empty account writes genesis and pins it")
  func genesisOnEmpty() async throws {
    let (store, memory) = makeStore()
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.start()
    #expect(store.phase == .signedOut)
    #expect(auth.configuredKey == "pk_test")

    await store.signIn(with: .apple)
    #expect(store.phase == .ready)
    #expect(service.log.count == 1)
    #expect(store.members.map(\.id) == [store.memberId])
    #expect(store.safetyCode?.count == 14)
    #expect(events == [.signedIn(provider: .apple, firstDevice: true)])
    let saved = await memory.vault
    #expect(saved.root?.genesisHash == service.log[0].hash)
    #expect(saved.keys?.kind == "ios")
  }

  @Test("a device already on the account resumes it")
  func resume() async throws {
    let phone = TestKey(1)
    service.seed([genesis(phone)])
    let (store, _) = makeStore(vault: AccountVault(keys: phone.deviceKeys))
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.start()
    await store.signIn(with: .github)
    #expect(store.phase == .ready)
    #expect(service.batches.isEmpty)
    #expect(events == [.signedIn(provider: .github, firstDevice: false)])
  }

  @Test("a second device asks to join and waits for approval")
  func secondDevice() async {
    service.seed([genesis(TestKey(1))])
    let (store, _) = makeStore()
    await store.start()
    await store.signIn(with: .apple)
    #expect(store.phase == .awaitingApproval)
    #expect(store.join == .waiting)
    #expect(service.joinIds.count == 1)
    #expect(service.batches.isEmpty)
  }

  @Test("a launch shows the cached hosts before the service answers")
  func cachedLaunch() async throws {
    let phone = TestKey(1)
    let mini = TestKey(2)
    let g = genesis(phone)
    let add = try AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: AccountHead(seq: 0, hash: g.hash), signer: phone.signer,
      .addHost(member: mini.host("Mini"), requestId: "", sasCommit: "", proof: mini.proof(mini.host("Mini"))))
    let state = try #require(AccountLog.verify([g, add]).state)
    service.seed([g, add])
    auth.signedIn = true
    let (store, _) = makeStore(vault: AccountVault(keys: phone.deviceKeys, root: state.root, entries: [g, add]))
    var published: [DeviceIdentity] = []
    store.onHostsChanged = { published = $0 }
    await store.start()
    #expect(store.phase == .ready)
    #expect(published.map(\.accountHostId) == [mini.id])
    #expect(published.first?.desktopPubB64 == mini.noisePub)
    #expect(published.first?.devPubB64 == phone.noisePub)
    #expect(published.first?.source == .account)
  }

  func readyStore() async -> AccountStore {
    let (store, _) = makeStore()
    await store.start()
    await store.signIn(with: .apple)
    return store
  }

  @Test("linking a code writes add_host and the window's add_device in one batch")
  func linkWithDevice() async throws {
    let store = await readyStore()
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    let mini = TestKey(2)
    let window = TestKey(3)
    let host = mini.host("Mini")
    let device = window.device("Mini window", kind: "electron")
    service.addLink(
      requestId: "req-1", userCode: "WDJB-MJHT",
      subject: AccountLinkSubject(host: host, device: device, proofs: [host.id: mini.proof(host), device.id: window.proof(device)]))

    await store.link(code: "wdjb mjht")
    guard case .confirm(let sas, let name) = store.link else {
      Issue.record("expected the code to compare, got \(store.link)")
      return
    }
    #expect(name == "Mini")
    let state = try #require(store.state)
    let expected = try AccountSas.compute(
      .init(
        accountId: state.accountId, epoch: 0, headHash: state.head.hash,
        approverSignPub: try #require(store.members.first?.signPub), subjectSignPub: host.signPub,
        subjectNoisePub: host.noisePub, requestId: "req-1"))
    #expect(sas == expected.sas)

    await store.confirmLink()
    #expect(store.link == .done(hostName: "Mini"))
    let batch = try #require(service.batches.last)
    #expect(batch.count == 2)
    let bodies = batch.map { try! JSONSerialization.jsonObject(with: Data($0.body.utf8)) as! [String: Any] }
    #expect(bodies.map { $0["type"] as? String } == ["add_host", "add_device"])
    #expect(bodies.allSatisfy { $0["request_id"] as? String == "req-1" })
    #expect(bodies.allSatisfy { $0["sas_commit"] as? String == expected.commit })
    #expect(store.state?.admits(memberId: host.id, requestId: "req-1", sasCommit: expected.commit) == true)
    #expect(store.hosts.map(\.id) == [host.id])
    #expect(events == [.computerAdded(viaPairing: false)])
    #expect(service.linkStatus("req-1") == "approved")
  }

  @Test("a moved head on append goes back to comparing a new code")
  func linkConflictRetries() async throws {
    let store = await readyStore()
    let mini = TestKey(2)
    let host = mini.host("Mini")
    service.addLink(
      requestId: "req-2", userCode: "BCDF-GHJK",
      subject: AccountLinkSubject(host: host, proofs: [host.id: mini.proof(host)]))
    await store.link(code: "BCDF-GHJK")
    guard case .confirm(let firstSas, _) = store.link else {
      Issue.record("expected confirm")
      return
    }

    // Another device renames this one meanwhile, signed with its own key.
    let phoneSeed = Data(base64Encoded: try #require(await storeKeysSeed(store)))!
    let signer = AccountSigner(id: try #require(store.memberId), seed: phoneSeed)
    let state = try #require(store.state)
    service.inject(
      try AccountEntryBuilder.make(
        accountId: state.accountId, epoch: 0, head: state.head, signer: signer,
        .rename(memberId: signer.id, name: "Renamed")))

    await store.confirmLink()
    guard case .confirm(let secondSas, _) = store.link else {
      Issue.record("expected a new code, got \(store.link)")
      return
    }
    #expect(store.state?.head.seq == 1)
    #expect(secondSas != firstSas || store.state?.head.hash != state.head.hash)

    await store.confirmLink()
    #expect(store.link == .done(hostName: "Mini"))
    #expect(service.log.count == 3)
  }

  @Test("codes that don't match deny the request")
  func deny() async {
    let store = await readyStore()
    let mini = TestKey(2)
    let host = mini.host("Mini")
    service.addLink(
      requestId: "req-3", userCode: "BCDF-GHJK",
      subject: AccountLinkSubject(host: host, proofs: [host.id: mini.proof(host)]))
    await store.link(code: "BCDF-GHJK")
    await store.denyLink()
    #expect(store.link == .idle)
    #expect(service.linkStatus("req-3") == "denied")
    #expect(service.log.count == 1)
  }

  @Test("removing a host revokes it")
  func removeHost() async throws {
    let store = await readyStore()
    let mini = TestKey(2)
    let host = mini.host("Mini")
    service.addLink(requestId: "r", userCode: "BCDF-GHJK", subject: AccountLinkSubject(host: host, proofs: [host.id: mini.proof(host)]))
    await store.link(code: "BCDF-GHJK")
    await store.confirmLink()
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.remove(memberId: host.id)
    #expect(store.hosts.isEmpty)
    #expect(events == [.memberRemoved(role: .host)])
  }

  @Test("signing out revokes this device and forgets its keys")
  func signOut() async throws {
    let store = await readyStore()
    let me = try #require(store.memberId)
    await store.signOut()
    #expect(store.phase == .signedOut)
    #expect(auth.signedOut)
    #expect(store.memberId == nil)
    let last = try #require(service.log.last)
    #expect(last.body.contains("\"unlinked\""))
    #expect(AccountLog.verify(service.log).state?.liveMember(me) == nil)
  }

  @Test("presence is verified against the log; online means seen in 15 minutes")
  func directory() async throws {
    let store = await readyStore()
    let mini = TestKey(2)
    let host = mini.host("Mini")
    service.addLink(requestId: "r", userCode: "BCDF-GHJK", subject: AccountLinkSubject(host: host, proofs: [host.id: mini.proof(host)]))
    await store.link(code: "BCDF-GHJK")
    await store.confirmLink()

    let body = """
      {"v":1,"account_id":"\(service.accountId)","epoch":0,"host_id":"\(host.id)","ts":5,"endpoints":[{"kind":"cloudflare","url":"wss://new.example","priority":2}]}
      """
    let sig = try AccountCodec.sign(AccountCodec.presenceSigningBytes(body), seed: mini.seed)
    let forged = try AccountCodec.sign(AccountCodec.presenceSigningBytes(body), seed: Data(repeating: 7, count: 32))
    let now = Date().timeIntervalSince1970 * 1000
    service.setDirectory([
      AccountDirectoryRecord(hostId: host.id, presenceBody: body, presenceSig: forged, lastSeen: now),
      AccountDirectoryRecord(hostId: host.id, presenceBody: body, presenceSig: sig, lastSeen: now),
    ])
    var published: [DeviceIdentity] = []
    store.onHostsChanged = { published = $0 }
    await store.refreshDirectory()
    #expect(store.host(host.id)?.online == true)
    #expect(store.host(host.id)?.endpoints.map(\.url) == ["wss://new.example"])
    #expect(published.first?.url == "wss://new.example")
  }

  @Test("the Mac's first sign-in links its bundled host with no code")
  func localHostLink() async throws {
    let mac = TestKey(4)
    let local = FakeLocalHost(member: mac.host("This Mac"), proof: mac.proof(mac.host("This Mac")))
    let (store, _) = makeStore(localHost: local)
    await store.start()
    await store.signIn(with: .apple)
    #expect(store.phase == .ready)
    #expect(service.log.count == 2)
    let body = try JSONSerialization.jsonObject(with: Data(service.log[1].body.utf8)) as! [String: Any]
    #expect(body["type"] as? String == "add_host")
    #expect(body["request_id"] as? String == "")
    #expect(body["sas_commit"] as? String == "")
    #expect(local.finished?.genesisHash == service.log[0].hash)
    #expect(store.localHostLinked)
    #expect(store.hosts.first?.isLocal == true)
    #expect(store.hostIdentities.isEmpty)
  }

  private func storeKeysSeed(_ store: AccountStore) async -> String? {
    store.vault.keys?.signSeed
  }
}

@MainActor
final class FakeLocalHost: AccountLocalHostLinking {
  let member: AccountMember
  let proof: String
  var finished: AccountRoot?

  init(member: AccountMember, proof: String) {
    self.member = member
    self.proof = proof
  }

  func begin() async throws -> (host: AccountMember, proof: String) { (member, proof) }
  func finish(root: AccountRoot) async throws { finished = root }
}
