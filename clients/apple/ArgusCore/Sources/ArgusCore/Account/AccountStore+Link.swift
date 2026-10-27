import ArgusKit
import Foundation

/// Adding a computer by the code it shows (§5.2a): claim the code, become its
/// approver, compare the 6-digit code, then write `add_host` — plus the
/// Electron window's `add_device` — in one batch.
public enum LinkFlow: Equatable, Sendable {
  case idle
  case working(String)
  /// Compare `sas` with the code on the computer before confirming.
  case confirm(sas: String, hostName: String)
  case done(hostName: String)
  case failed(String)
}

struct PendingLink {
  var viaPairing: Bool
  var claim: AccountLinkClaim
  var head: AccountHead
  var sas: AccountSas
}

extension AccountStore {
  /// Claim a typed `XXXX-XXXX` code and show the code to compare.
  /// `viaPairing` when a QR-paired computer handed the code over (`account.request_link`).
  public func link(code: String, viaPairing: Bool = false) async {
    guard phase == .ready, let keys = vault.keys else {
      link = .failed(AccountStoreError.notReady.message)
      return
    }
    let normalized = AccountCodec.normalizeUserCode(code)
    guard normalized.count == 9 else {
      link = .failed("Codes look like WDJB-MJHT.")
      return
    }
    link = .working("Checking the code…")
    do {
      let claim = try await client.claim(userCode: normalized)
      guard !claim.accountEmpty else {
        link = .failed("Finish on the computer: it becomes the first on your account.")
        return
      }
      if state?.members[claim.subject.host.id] != nil
        || state?.members.values.contains(where: { $0.member.signPub == claim.subject.host.signPub }) == true
      {
        link = .failed("\(claim.subject.host.name) is already on your account.")
        return
      }
      try await approve(claim, viaPairing: viaPairing, approverId: keys.memberId, approverSignPub: keys.signPub)
    } catch AccountServiceError.conflict {
      link = .failed("That code is already being used by another account.")
    } catch {
      link = .failed(Self.describe(error))
    }
  }

  /// Become the request's approver and work out the code for its head.
  private func approve(
    _ claim: AccountLinkClaim, viaPairing: Bool, approverId: String, approverSignPub: String
  ) async throws {
    let head = try await client.approve(requestId: claim.requestId, approverId: approverId)
    if let current = state, current.head.seq < head.seq { await refreshLog() }
    guard let current = state, current.head == head else { throw AccountStoreError.headMoved }
    let sas = try AccountSas.compute(
      .init(
        accountId: current.accountId, epoch: current.epoch, headHash: head.hash,
        approverSignPub: approverSignPub, subjectSignPub: claim.subject.host.signPub,
        subjectNoisePub: claim.subject.host.noisePub, requestId: claim.requestId))
    pendingLink = PendingLink(viaPairing: viaPairing, claim: claim, head: head, sas: sas)
    link = .confirm(sas: sas.sas, hostName: claim.subject.host.name)
  }

  /// "Codes match": write the computer onto the account. When the log moved
  /// meanwhile the code changes too, so it goes back to comparing.
  public func confirmLink() async {
    guard let pending = pendingLink, let keys = vault.keys else { return }
    let claim = pending.claim
    link = .working("Adding \(claim.subject.host.name)…")
    do {
      guard let hostProof = claim.subject.proofs[claim.subject.host.id] else {
        throw AccountStoreError.keys
      }
      var entries = [
        try entry(
          head: pending.head,
          .addHost(
            member: claim.subject.host, requestId: claim.requestId, sasCommit: pending.sas.commit,
            proof: hostProof))
      ]
      if let device = claim.subject.device, let proof = claim.subject.proofs[device.id] {
        entries.append(
          try entry(
            head: AccountHead(seq: pending.head.seq + 1, hash: entries[0].hash),
            .addDevice(member: device, requestId: claim.requestId, sasCommit: pending.sas.commit, proof: proof)))
      }
      guard let epoch = state?.epoch else { throw AccountStoreError.notReady }
      do {
        try await client.append(epoch: epoch, entries: entries)
      } catch AccountServiceError.conflict {
        await refreshLog()
        try await approve(
          claim, viaPairing: pending.viaPairing, approverId: keys.memberId, approverSignPub: keys.signPub)
        return
      }
      try await applyOwn(entries)
      pendingLink = nil
      link = .done(hostName: claim.subject.host.name)
      onEvent(.computerAdded(viaPairing: pending.viaPairing))
      await refreshDirectory()
    } catch {
      link = .failed(Self.describe(error))
    }
  }

  /// "Codes don't match": refuse the request so the computer stops waiting.
  public func denyLink() async {
    guard let pending = pendingLink else {
      link = .idle
      return
    }
    pendingLink = nil
    link = .idle
    try? await client.deny(requestId: pending.claim.requestId)
  }

  public func resetLink() {
    pendingLink = nil
    link = .idle
  }
}
