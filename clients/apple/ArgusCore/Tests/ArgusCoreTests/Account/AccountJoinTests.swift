@testable import ArgusCore
import Foundation
import Testing

/// Device approval (§5.4) from both ends: the joining device compares a code
/// and adopts the log only with that code in it; an approver lists, checks and
/// approves waiting devices. Plus renaming and handing entries to a host.
@MainActor
@Suite("Account joins")
struct AccountJoinTests {
  typealias TestKey = AccountStoreTests.TestKey

  let service = FakeAccountService()
  let auth = FakeAccountAuth()
  let phone = TestKey(1)

  func makeStore(vault: AccountVault = .empty) -> (AccountStore, MemoryAccountVault) {
    let memory = MemoryAccountVault(vault)
    let store = AccountStore(
      auth: auth, vault: memory, deviceKind: "mac", deviceName: { "Studio" },
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
    return (store, memory)
  }

  func genesis() -> AccountEntry {
    try! AccountEntryBuilder.make(
      accountId: service.accountId, epoch: 0, head: nil, signer: phone.signer,
      .genesis(member: phone.device("Phone")))
  }

  /// The phone approves `requestId` for `member` with `commit`, as its own device would.
  func phoneApproves(_ requestId: String, member: AccountMember, proof: String, commit: String) throws {
    let head = AccountHead(seq: service.log.count - 1, hash: service.headHash)
    service.inject(
      try AccountEntryBuilder.make(
        accountId: service.accountId, epoch: 0, head: head, signer: phone.signer,
        .addDevice(member: member, requestId: requestId, sasCommit: commit, proof: proof)))
    service.setJoinStatus(requestId, "approved")
  }

  /// A new Mac signed in on the phone's account, its request picked up by the phone.
  func joiningMac() async throws -> (AccountStore, MemoryAccountVault, String, AccountSas) {
    service.seed([genesis()])
    let (store, memory) = makeStore()
    await store.start()
    await store.signIn(with: .github)
    let requestId = try #require(service.joinIds.first)
    let head = service.pickUp(requestId, by: phone.id, signPub: phone.signPub)
    await store.pollJoin()
    let keys = try #require(await memory.vault.keys)
    let sas = try AccountSas.compute(
      .init(
        accountId: service.accountId, epoch: 0, headHash: head.hash, approverSignPub: phone.signPub,
        subjectSignPub: keys.signPub, subjectNoisePub: keys.noisePub, requestId: requestId))
    return (store, memory, requestId, sas)
  }

  @Test("a new device shows the approver's code and joins with it")
  func joins() async throws {
    let (store, memory, requestId, sas) = try await joiningMac()
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    #expect(store.join == .compare(sas: sas.sas, approverName: "Phone"))

    await store.confirmJoinCode()
    #expect(store.join == .confirmed(approverName: "Phone"))
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)
    await store.pollJoin()

    #expect(store.phase == .ready)
    #expect(store.join == .idle)
    #expect(store.members.map(\.id).sorted() == [phone.id, keys.memberId].sorted())
    #expect(await memory.vault.root?.genesisHash == service.log[0].hash)
    #expect(await memory.vault.joinCommit == nil)
    #expect(
      events == [.joinActed(action: .approved, role: .subject), .signedIn(provider: .github, firstDevice: false)])
  }

  @Test("an approval with another code than the one compared is refused")
  func wrongCode() async throws {
    let (store, memory, requestId, _) = try await joiningMac()
    await store.confirmJoinCode()
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: String(repeating: "0", count: 64))
    await store.pollJoin()

    #expect(store.phase == .awaitingApproval)
    guard case .failed = store.join else {
      Issue.record("expected a failure, got \(store.join)")
      return
    }
    #expect(await memory.vault.root == nil)
  }

  @Test("an approval the user never confirmed isn't adopted, even after a relaunch")
  func unconfirmedRelaunch() async throws {
    let (store, memory, requestId, sas) = try await joiningMac()
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)
    await store.pollJoin()
    #expect(store.phase == .awaitingApproval)

    let relaunched = relaunch(memory)
    await relaunched.start()
    #expect(relaunched.phase == .awaitingApproval)
    #expect(relaunched.join == .alreadyApproved(sas: sas.sas, approverName: "Phone"))
    #expect(await memory.vault.root == nil)
  }

  func relaunch(_ memory: MemoryAccountVault) -> AccountStore {
    AccountStore(
      auth: auth, vault: memory, deviceKind: "mac", deviceName: { "Studio" },
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
  }

  @Test("codes that don't match deny the request on the joining device")
  func rejectsCode() async throws {
    let (store, _, requestId, _) = try await joiningMac()
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.rejectJoinCode()
    #expect(store.join == .denied)
    #expect(service.join(requestId)?.status == "denied")
    #expect(events == [.joinActed(action: .denied, role: .subject)])
  }

  @Test("an approver sees a waiting device, compares the code and adds it")
  func approves() async throws {
    let store = await readyPhone()
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    var appended = 0
    store.onLogAppended = { appended += 1 }
    let tablet = TestKey(5)
    let member = tablet.device("Tablet")
    let requestId = service.addJoin(member: member, proof: tablet.proof(member))
    service.addJoin(member: TestKey(6).device("Forged"), proof: tablet.proof(member))

    await store.refreshRequests()
    #expect(store.requests.map(\.requestId) == [requestId])

    await store.approve(try #require(store.requests.first))
    let state = try #require(store.state)
    let expected = try AccountSas.compute(
      .init(
        accountId: state.accountId, epoch: 0, headHash: state.head.hash, approverSignPub: phone.signPub,
        subjectSignPub: member.signPub, subjectNoisePub: member.noisePub, requestId: requestId))
    #expect(store.approval == .confirm(sas: expected.sas, name: "Tablet", role: .device))

    await store.confirmApproval()
    #expect(store.approval == .done(name: "Tablet", role: .device))
    #expect(store.state?.admits(memberId: member.id, requestId: requestId, sasCommit: expected.commit) == true)
    #expect(store.requests.isEmpty)
    #expect(appended == 1)
    #expect(events == [.joinActed(action: .approved, role: .approver)])
  }

  @Test("renaming this device writes a signed rename through its name setting")
  func renames() async throws {
    let store = await readyPhone()
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.rename(memberId: phone.id, to: "  Douwe's iPhone\n")
    #expect(store.members.first?.name == "Douwe's iPhone")
    #expect(events == [.nameChanged(source: .accountList, linked: true)])
  }

  @Test("a connected host on this account gets the entries it's missing")
  func syncsHost() async throws {
    let store = await readyPhone()
    await store.rename(memberId: phone.id, to: "Renamed")
    let pushed = Pushed()
    let hash = AccountCodec.sha256Hex(service.accountId)
    let channel = AccountSyncChannel(
      status: { .init(linked: true, accountIdHash: hash, headSeq: 0) },
      push: { params in await pushed.add(params) })
    await store.sync(over: channel)
    let sent = await pushed.all
    #expect(sent.count == 1)
    #expect(sent.first?.entries.map(\.body) == [service.log[1].body])

    let other = AccountSyncChannel(
      status: { .init(linked: true, accountIdHash: "someone-else", headSeq: 0) },
      push: { params in await pushed.add(params) })
    await store.sync(over: other)
    #expect(await pushed.all.count == 1)
  }

  func readyPhone() async -> AccountStore {
    service.seed([genesis()])
    auth.signedIn = true
    let state = AccountLog.verify(service.log).state!
    let (store, _) = makeStore(
      vault: AccountVault(keys: phone.deviceKeys, root: state.root, entries: service.log))
    await store.start()
    return store
  }

  func proof(_ keys: AccountDeviceKeys) throws -> String {
    try AccountEntryBuilder.proof(for: keys.member, seed: try #require(AccountCodec.fromB64(keys.signSeed)))
  }
}

actor Pushed {
  var all: [ArgusProtocol.MethodsTypes.AccountSyncParams] = []
  func add(_ params: ArgusProtocol.MethodsTypes.AccountSyncParams) { all.append(params) }
}
