import ArgusKit
import Foundation

/// This device joining an account that already has devices (§5.4): ask,
/// compare a 6-digit code with the device that picks it up, and adopt the log
/// only when its `add_device` carries the code compared here.
public enum JoinFlow: Equatable, Sendable {
  case idle
  case requesting
  /// Asked; no device has picked it up yet.
  case waiting
  /// Compare `sas` with the code on `approverName` before confirming.
  case compare(sas: String, approverName: String)
  /// Codes match here; waiting for `approverName` to finish.
  case confirmed(approverName: String)
  /// `approverName` already added this device, approved while this one wasn't
  /// watching (a relaunch). Check `sas` against the code it lists for this device.
  case alreadyApproved(sas: String, approverName: String)
  case denied
  case expired
  case failed(String)
}

struct PendingJoin {
  var requestId: String
  var info: AccountInfo
  var provider: AccountSignInProvider?
  var approver: AccountRequestStatus.Approver?
  var sas: AccountSas?
  var confirmedCommit: String?
}

/// This device's keys are on the account through an approval it didn't
/// confirm here; adopted only once the user checks its code.
struct ApprovedJoin {
  var entries: [AccountEntry]
  var state: AccountLogState
  var approval: AccountApproval
  var info: AccountInfo
  var provider: AccountSignInProvider?
}

extension AccountStore {
  /// Ask the account's devices to let this one in. Keys are kept, so asking
  /// again after a denial or expiry keeps the same identity.
  func requestJoin(_ info: AccountInfo, provider: AccountSignInProvider?) async {
    stopJoin()
    join = .requesting
    await withdrawPendingJoin()
    for attempt in 0..<2 {
      let keys = attempt == 0 ? currentKeys() : AccountDeviceKeys.generate(kind: deviceKind, name: deviceName(), now: now())
      if vault.keys != keys {
        vault.keys = keys
        await vaultStore.save(vault)
      }
      do {
        guard let seed = AccountCodec.fromB64(keys.signSeed) else { throw AccountStoreError.keys }
        let proof = try AccountEntryBuilder.proof(for: keys.member, seed: seed)
        let ticket = try await client.join(member: keys.member, proof: proof)
        pendingJoin = PendingJoin(requestId: ticket.requestId, info: info, provider: provider)
        vault.pendingJoin = AccountPendingJoin(
          requestId: ticket.requestId, accountId: info.accountId, epoch: info.epoch)
        await vaultStore.save(vault)
        join = .waiting
        onEvent(.joinActed(action: .requested, role: .subject))
        startJoinPolling()
        return
      } catch AccountServiceError.conflict(let headSeq) where headSeq != nil && attempt == 0 {
        // Still on the account: an earlier request was approved. Never ask
        // again with these keys, and only replace them once they were removed.
        if await offerApprovedJoinIfMember(info, provider: provider) { return }
        continue
      } catch AccountServiceError.conflict {
        // The account is empty after all: this device becomes its first.
        await bootstrap(provider: provider)
        return
      } catch {
        join = .failed(Self.describe(error))
        return
      }
    }
  }

  /// After a relaunch: pick the persisted request back up, or file a new one.
  func continueJoin(_ info: AccountInfo, provider: AccountSignInProvider?) async {
    guard let saved = vault.pendingJoin, saved.accountId == info.accountId, saved.epoch == info.epoch else {
      await requestJoin(info, provider: provider)
      return
    }
    stopJoin()
    pendingJoin = PendingJoin(requestId: saved.requestId, info: info, provider: provider)
    join = .waiting
    startJoinPolling()
    await pollJoin()
  }

  /// Withdraw this device's earlier request before filing a new one, so stale
  /// ones don't wait on the account's other devices.
  private func withdrawPendingJoin() async {
    guard let saved = vault.pendingJoin else { return }
    try? await client.deny(requestId: saved.requestId)
    await clearPendingJoin()
  }

  private func clearPendingJoin() async {
    guard vault.pendingJoin != nil else { return }
    vault.pendingJoin = nil
    await vaultStore.save(vault)
  }

  /// Ask again after a denial, an expiry or an error.
  public func retryJoin() async {
    guard phase == .awaitingApproval else { return }
    do {
      let info = try await client.account()
      await requestJoin(info, provider: pendingJoin?.provider)
    } catch {
      join = .failed(Self.describe(error))
    }
  }

  func startJoinPolling() {
    joinLoop?.cancel()
    let interval = joinPollInterval
    joinLoop = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: interval)
        guard !Task.isCancelled, let self, self.pendingJoin != nil else { return }
        await self.pollJoin()
      }
    }
  }

  func stopJoin() {
    joinLoop?.cancel()
    joinLoop = nil
    pendingJoin = nil
  }

  private func endJoin(_ flow: JoinFlow, _ action: JoinAction?) async {
    stopJoin()
    await clearPendingJoin()
    join = flow
    if let action { onEvent(.joinActed(action: action, role: .subject)) }
  }

  /// One look at this device's request.
  public func pollJoin() async {
    guard phase == .awaitingApproval, let pending = pendingJoin else { return }
    let status: AccountRequestStatus?
    do {
      status = try await client.joinStatus(requestId: pending.requestId)
    } catch AccountServiceError.http(404, _) {
      // Gone, or filed on another account: over.
      status = nil
    } catch {
      return
    }
    guard pendingJoin?.requestId == pending.requestId else { return }
    let name = status?.status ?? "expired"
    switch name {
    case "denied", "expired":
      // An earlier request may have been approved meanwhile.
      if await offerApprovedJoinIfMember(pending.info, provider: pending.provider) { return }
      if name == "denied" {
        await endJoin(.denied, .denied)
      } else {
        await endJoin(.expired, .expired)
      }
    case "approving", "approved":
      guard let status else { return }
      if pendingJoin?.sas == nil || pendingJoin?.approver != status.approver {
        await showCode(status)
      }
      if status.status == "approved", pendingJoin?.confirmedCommit != nil {
        await finishJoin()
      }
    default:
      break
    }
  }

  /// A device picked the request up. The code binds its key and the head it
  /// approves on, both checked against the log, so a key or head the service
  /// swapped gives a code that doesn't match the approver's.
  private func showCode(_ status: AccountRequestStatus) async {
    guard var pending = pendingJoin, let approver = status.approver, let head = status.head,
      let keys = vault.keys
    else { return }
    guard let entries = try? await client.log(epoch: pending.info.epoch, after: -1) else { return }
    guard head.seq >= 0, head.seq < entries.count,
      case .ok(let atHead) = AccountLog.verify(Array(entries.prefix(head.seq + 1))),
      atHead.head == head, let found = atHead.liveMember(approver.id),
      found.member.signPub == approver.signPub,
      let sas = try? AccountSas.compute(
        .init(
          accountId: atHead.accountId, epoch: atHead.epoch, headHash: head.hash,
          approverSignPub: approver.signPub, subjectSignPub: keys.signPub,
          subjectNoisePub: keys.noisePub, requestId: pending.requestId))
    else {
      await endJoin(.failed(AccountStoreError.untrustedLog.message), nil)
      return
    }
    // Confirmed before a relaunch: the same request and code stay confirmed.
    let confirmed = vault.joinRequestId == pending.requestId && vault.joinCommit == sas.commit
    pending.approver = approver
    pending.sas = sas
    pending.confirmedCommit = confirmed ? sas.commit : nil
    pendingJoin = pending
    join =
      confirmed
      ? .confirmed(approverName: found.member.name) : .compare(sas: sas.sas, approverName: found.member.name)
  }

  /// "Codes match" on this device. The approver still has to confirm too.
  public func confirmJoinCode() async {
    guard var pending = pendingJoin, let sas = pending.sas, case .compare(_, let name) = join else { return }
    pending.confirmedCommit = sas.commit
    pendingJoin = pending
    // Kept so a relaunch only adopts an approval that carries this code.
    vault.joinRequestId = pending.requestId
    vault.joinCommit = sas.commit
    await vaultStore.save(vault)
    join = .confirmed(approverName: name)
    await pollJoin()
  }

  /// "Codes don't match": refuse the request.
  public func rejectJoinCode() async {
    guard let pending = pendingJoin else { return }
    try? await client.deny(requestId: pending.requestId)
    await endJoin(.denied, .denied)
  }

  /// Approved: adopt the log only if it adds this device with the code compared here.
  private func finishJoin() async {
    guard let pending = pendingJoin, let commit = pending.confirmedCommit, let keys = vault.keys else { return }
    guard let entries = try? await client.log(epoch: pending.info.epoch, after: -1) else { return }
    switch AccountLog.verify(entries) {
    case .ok(let verified):
      guard verified.admits(memberId: keys.memberId, requestId: pending.requestId, sasCommit: commit) else {
        await endJoin(.failed("The approval didn't carry the code you compared, so this device didn't join."), nil)
        return
      }
      await adoptJoin(verified, entries: entries, provider: pending.provider)
    case .rejected(let reason, _, _):
      logError = reason
      await endJoin(.failed(AccountStoreError.untrustedLog.message), nil)
    }
  }

  /// Pin and adopt the log that added this device with a code confirmed here.
  private func adoptJoin(_ verified: AccountLogState, entries: [AccountEntry], provider: AccountSignInProvider?) async {
    stopJoin()
    approvedJoin = nil
    vault.root = verified.root
    vault.entries = entries
    vault.joinRequestId = nil
    vault.joinCommit = nil
    vault.pendingJoin = nil
    state = verified
    logError = nil
    await vaultStore.save(vault)
    join = .idle
    phase = .ready
    publishHosts()
    onEvent(.joinActed(action: .approved, role: .subject))
    if let provider { onEvent(.signedIn(provider: provider, firstDevice: false)) }
    await linkLocalHostIfNeeded()
    await flushName()
    await refreshDirectory()
    await syncPushRegistration()
  }

  // MARK: Approved while away

  /// Re-read the log; when this device's keys are live on it, offer that
  /// approval instead of asking again. False when they aren't.
  private func offerApprovedJoinIfMember(_ info: AccountInfo, provider: AccountSignInProvider?) async -> Bool {
    guard let entries = try? await client.log(epoch: info.epoch, after: -1),
      case .ok(let verified) = AccountLog.verify(entries), ownMemberLive(in: verified)
    else { return false }
    if admitsConfirmedJoin(verified) {
      await adoptJoin(verified, entries: entries, provider: provider)
    } else {
      await offerApprovedJoin(verified, entries: entries, info: info, provider: provider)
    }
    return true
  }

  /// This device's keys are live in `verified` through an approval it didn't
  /// confirm here. Show the code that approval was made with, recomputed from
  /// the log, and adopt only once the user checks it against the approver.
  func offerApprovedJoin(
    _ verified: AccountLogState, entries: [AccountEntry], info: AccountInfo, provider: AccountSignInProvider?
  ) async {
    // Withdraw the request still open beside the one that was approved.
    let open = pendingJoin?.requestId ?? vault.pendingJoin?.requestId
    stopJoin()
    await clearPendingJoin()
    if let open, open != verified.liveMember(vault.keys?.memberId ?? "")?.requestId {
      try? await client.deny(requestId: open)
    }
    guard let keys = vault.keys, let found = verified.liveMember(keys.memberId),
      found.member.noisePub == keys.noisePub,
      // A code was confirmed here for this request, and it isn't this one.
      vault.joinRequestId != found.requestId || vault.joinCommit == found.sasCommit,
      let approval = AccountLog.approvals(entries)[keys.memberId],
      let approver = verified.members[approval.approverId]
    else {
      join = .failed(
        "This device is on your account through an approval it can't check. Remove it from your account on another device, then sign out here and in again."
      )
      return
    }
    approvedJoin = ApprovedJoin(entries: entries, state: verified, approval: approval, info: info, provider: provider)
    join = .alreadyApproved(sas: approval.sas.sas, approverName: approver.member.name)
  }

  /// The code matches the one the approver lists for this device: adopt.
  public func confirmApprovedJoin() async {
    guard let held = approvedJoin, case .alreadyApproved = join, let keys = vault.keys,
      held.state.admits(memberId: keys.memberId, requestId: held.approval.requestId, sasCommit: held.approval.sas.commit)
    else { return }
    await adoptJoin(held.state, entries: held.entries, provider: held.provider)
  }

  /// "Not mine": someone else's approval put these keys on the account. Drop
  /// them and sign out; the stray entry has to be removed from a trusted device.
  public func rejectApprovedJoin() async {
    guard approvedJoin != nil else { return }
    approvedJoin = nil
    onEvent(.joinActed(action: .denied, role: .subject))
    await signOut()
    error = "This device signed out because its approval didn't match. Remove it from your account on your other device, then sign in again."
  }

  // MARK: Approval codes

  /// The code `memberId` was approved with, recomputed from the verified log,
  /// so a device approved while away can be checked against it.
  public func approvalCode(for memberId: String) -> String? {
    guard let head = state?.head else { return nil }
    if approvalsCache?.head != head {
      approvalsCache = (head, AccountLog.approvals(vault.entries))
    }
    return approvalsCache?.approvals[memberId]?.sas.sas
  }

  /// A log fetched with no pin yet: adopt it only through the request and
  /// code this device confirmed.
  func admitsConfirmedJoin(_ state: AccountLogState) -> Bool {
    guard let keys = vault.keys, let requestId = vault.joinRequestId, let commit = vault.joinCommit else {
      return false
    }
    return state.admits(memberId: keys.memberId, requestId: requestId, sasCommit: commit)
  }
}
