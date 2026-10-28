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

extension AccountStore {
  /// Ask the account's devices to let this one in. Keys are kept, so asking
  /// again after a denial or expiry keeps the same identity.
  func requestJoin(_ info: AccountInfo, provider: AccountSignInProvider?) async {
    stopJoin()
    join = .requesting
    for attempt in 0..<2 {
      let keys =
        (attempt == 0 ? vault.keys : nil)
        ?? AccountDeviceKeys.generate(kind: deviceKind, name: deviceName(), now: now())
      if vault.keys != keys {
        vault.keys = keys
        await vaultStore.save(vault)
      }
      do {
        guard let seed = AccountCodec.fromB64(keys.signSeed) else { throw AccountStoreError.keys }
        let proof = try AccountEntryBuilder.proof(for: keys.member, seed: seed)
        let ticket = try await client.join(member: keys.member, proof: proof)
        pendingJoin = PendingJoin(requestId: ticket.requestId, info: info, provider: provider)
        join = .waiting
        onEvent(.joinActed(action: .requested, role: .subject))
        startJoinPolling()
        return
      } catch AccountServiceError.conflict(let headSeq) where headSeq != nil && attempt == 0 {
        // These keys were on the account once and were removed: ask with new ones.
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

  private func endJoin(_ flow: JoinFlow, _ action: JoinAction?) {
    stopJoin()
    join = flow
    if let action { onEvent(.joinActed(action: action, role: .subject)) }
  }

  /// One look at this device's request.
  public func pollJoin() async {
    guard phase == .awaitingApproval, let pending = pendingJoin else { return }
    guard let status = try? await client.joinStatus(requestId: pending.requestId),
      pendingJoin?.requestId == pending.requestId
    else { return }
    switch status.status {
    case "denied":
      endJoin(.denied, .denied)
    case "expired":
      endJoin(.expired, .expired)
    case "approving", "approved":
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
      endJoin(.failed(AccountStoreError.untrustedLog.message), nil)
      return
    }
    pending.approver = approver
    pending.sas = sas
    pending.confirmedCommit = nil
    pendingJoin = pending
    join = .compare(sas: sas.sas, approverName: found.member.name)
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
    endJoin(.denied, .denied)
  }

  /// Approved: adopt the log only if it adds this device with the code compared here.
  private func finishJoin() async {
    guard let pending = pendingJoin, let commit = pending.confirmedCommit, let keys = vault.keys else { return }
    guard let entries = try? await client.log(epoch: pending.info.epoch, after: -1) else { return }
    switch AccountLog.verify(entries) {
    case .ok(let verified):
      guard verified.admits(memberId: keys.memberId, requestId: pending.requestId, sasCommit: commit) else {
        endJoin(.failed("The approval didn't carry the code you compared, so this device didn't join."), nil)
        return
      }
      stopJoin()
      vault.root = verified.root
      vault.entries = entries
      vault.joinRequestId = nil
      vault.joinCommit = nil
      state = verified
      logError = nil
      await vaultStore.save(vault)
      join = .idle
      phase = .ready
      publishHosts()
      onEvent(.joinActed(action: .approved, role: .subject))
      if let provider = pending.provider { onEvent(.signedIn(provider: provider, firstDevice: false)) }
      await linkLocalHostIfNeeded()
      await refreshDirectory()
    case .rejected(let reason, _, _):
      logError = reason
      endJoin(.failed(AccountStoreError.untrustedLog.message), nil)
    }
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
