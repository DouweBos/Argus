@testable import ArgusCore
import Foundation
import Testing

/// A joining device that restarts mid-join resumes its own request, and one
/// approved while it was away adopts only after the user checks the code.
extension AccountJoinTests {
  @Test("a relaunch resumes the persisted request instead of filing another")
  func resumesRequest() async throws {
    let (_, memory, requestId, sas) = try await joiningMac()
    #expect(await memory.vault.pendingJoin?.requestId == requestId)

    let relaunched = relaunch(memory)
    await relaunched.start()
    #expect(relaunched.join == .compare(sas: sas.sas, approverName: "Phone"))
    #expect(service.joinIds == [requestId])
  }

  @Test("a code confirmed before a relaunch stays confirmed and joins")
  func resumesConfirmed() async throws {
    let (store, memory, requestId, sas) = try await joiningMac()
    await store.confirmJoinCode()

    let relaunched = relaunch(memory)
    await relaunched.start()
    #expect(relaunched.join == .confirmed(approverName: "Phone"))

    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)
    await relaunched.pollJoin()
    #expect(relaunched.phase == .ready)
    #expect(await memory.vault.pendingJoin == nil)
    #expect(service.joinIds == [requestId])
  }

  @Test("approved and confirmed before a relaunch: adopted silently")
  func relaunchAfterConfirmedApproval() async throws {
    let (store, memory, requestId, sas) = try await joiningMac()
    await store.confirmJoinCode()
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)

    let relaunched = relaunch(memory)
    await relaunched.start()
    #expect(relaunched.phase == .ready)
    #expect(relaunched.join == .idle)
    #expect(await memory.vault.root?.genesisHash == service.log[0].hash)
  }

  @Test("approved while away: the code is shown again and adopted once checked")
  func confirmsApprovalAfterRelaunch() async throws {
    let (_, memory, requestId, sas) = try await joiningMac()
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)

    let relaunched = relaunch(memory)
    var events: [AccountStore.Event] = []
    relaunched.onEvent = { events.append($0) }
    await relaunched.start()
    #expect(relaunched.join == .alreadyApproved(sas: sas.sas, approverName: "Phone"))
    #expect(service.joinIds == [requestId])
    #expect(await memory.vault.keys == keys)

    await relaunched.confirmApprovedJoin()
    #expect(relaunched.phase == .ready)
    #expect(relaunched.members.map(\.id).sorted() == [phone.id, keys.memberId].sorted())
    #expect(await memory.vault.root?.genesisHash == service.log[0].hash)
    #expect(events == [.joinActed(action: .approved, role: .subject)])
  }

  @Test("the approver lists the code it approved a device with")
  func approverShowsCode() async throws {
    let (_, memory, requestId, sas) = try await joiningMac()
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)
    let state = AccountLog.verify(service.log).state!
    let (store, _) = makeStore(vault: AccountVault(keys: phone.deviceKeys, root: state.root, entries: service.log))
    await store.start()
    #expect(store.approvalCode(for: keys.memberId) == sas.sas)
    #expect(store.approvalCode(for: phone.id) == nil)
  }

  @Test("\"not mine\" on an approval made while away signs out and forgets the keys")
  func rejectsApprovalAfterRelaunch() async throws {
    let (_, memory, requestId, sas) = try await joiningMac()
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)

    let relaunched = relaunch(memory)
    await relaunched.start()
    await relaunched.rejectApprovedJoin()
    #expect(relaunched.phase == .signedOut)
    #expect(relaunched.error != nil)
    #expect(await memory.vault == .empty)
    #expect(auth.signedOut)
  }

  @Test("an approval whose code the log doesn't yield is never offered")
  func refusesUncheckableApproval() async throws {
    let (_, memory, requestId, _) = try await joiningMac()
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: String(repeating: "0", count: 64))

    let relaunched = relaunch(memory)
    await relaunched.start()
    guard case .failed = relaunched.join else {
      Issue.record("expected a failure, got \(relaunched.join)")
      return
    }
    await relaunched.confirmApprovedJoin()
    #expect(relaunched.phase == .awaitingApproval)
    #expect(service.joinIds == [requestId])
  }

  @Test("already a member: asking again offers that approval instead of a new request")
  func memberDoesNotAskAgain() async throws {
    let (store, memory, requestId, sas) = try await joiningMac()
    service.setJoinStatus(requestId, "expired")
    await store.pollJoin()
    #expect(store.join == .expired)
    #expect(await memory.vault.pendingJoin == nil)

    await store.retryJoin()
    let second = try #require(service.joinIds.first { $0 != requestId })
    #expect(await memory.vault.pendingJoin?.requestId == second)

    // The first request's code was approved after all, while this one waits.
    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)
    await store.retryJoin()
    #expect(store.join == .alreadyApproved(sas: sas.sas, approverName: "Phone"))
    #expect(service.joinIds.count == 2)
    #expect(await memory.vault.keys == keys)
    #expect(service.join(second)?.status == "denied")
  }

  @Test("an approval landing on an older request is picked up when the open one expires")
  func pollingFindsOlderApproval() async throws {
    let (store, memory, requestId, sas) = try await joiningMac()
    service.setJoinStatus(requestId, "expired")
    await store.pollJoin()
    await store.retryJoin()
    let second = try #require(service.joinIds.first { $0 != requestId })

    let keys = try #require(await memory.vault.keys)
    try phoneApproves(requestId, member: keys.member, proof: proof(keys), commit: sas.commit)
    service.setJoinStatus(second, "expired")
    await store.pollJoin()
    #expect(store.join == .alreadyApproved(sas: sas.sas, approverName: "Phone"))
  }
}
