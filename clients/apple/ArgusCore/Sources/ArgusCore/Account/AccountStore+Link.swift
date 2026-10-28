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

/// A request this device is approving: whom the code is about, and the head
/// and code it was computed for.
struct PendingLink {
  var viaPairing: Bool
  var requestId: String
  var subject: AccountRequestSubject
  var head: AccountHead
  var sas: AccountSas

  var name: String { subject.member?.name ?? "" }
}

extension AccountStore {
  /// Claim a typed `XXXX-XXXX` code and show the code to compare.
  /// `viaPairing` when a QR-paired computer handed the code over (`account.request_link`).
  public func link(code: String, viaPairing: Bool = false) async {
    guard phase == .ready else {
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
      let subject = AccountRequestSubject(
        host: claim.subject.host, device: claim.subject.device, proofs: claim.subject.proofs)
      pendingLink = try await beginApproval(requestId: claim.requestId, subject: subject, viaPairing: viaPairing)
      link = .confirm(sas: pendingLink!.sas.sas, hostName: claim.subject.host.name)
    } catch AccountServiceError.conflict {
      link = .failed("That code is already being used by another account.")
    } catch {
      link = .failed(Self.describe(error))
    }
  }

  /// Become the request's approver and work out the code for its head, which
  /// must be the head this device holds.
  func beginApproval(requestId: String, subject: AccountRequestSubject, viaPairing: Bool) async throws
    -> PendingLink
  {
    guard let keys = vault.keys, let member = subject.member else { throw AccountStoreError.notReady }
    let head = try await client.approve(requestId: requestId, approverId: keys.memberId)
    if let current = state, current.head.seq < head.seq { await refreshLog() }
    guard let current = state, current.head == head else { throw AccountStoreError.headMoved }
    let sas = try AccountSas.compute(
      .init(
        accountId: current.accountId, epoch: current.epoch, headHash: head.hash,
        approverSignPub: keys.signPub, subjectSignPub: member.signPub,
        subjectNoisePub: member.noisePub, requestId: requestId))
    return PendingLink(viaPairing: viaPairing, requestId: requestId, subject: subject, head: head, sas: sas)
  }

  /// Write the request's members onto the account on the head the code was
  /// computed for. Nil when the log moved first: the caller shows the new
  /// code from the returned approval instead.
  func writeApproval(_ pending: PendingLink) async throws -> PendingLink? {
    var entries: [AccountEntry] = []
    var head = pending.head
    // A link writes its computer first, then the window riding along with it.
    for member in [pending.subject.host, pending.subject.device].compactMap({ $0 }) {
      guard let proof = pending.subject.proofs[member.id] else { throw AccountStoreError.keys }
      let fields: AccountEntryBuilder.Fields =
        member.role == .host
        ? .addHost(member: member, requestId: pending.requestId, sasCommit: pending.sas.commit, proof: proof)
        : .addDevice(member: member, requestId: pending.requestId, sasCommit: pending.sas.commit, proof: proof)
      let next = try entry(head: head, fields)
      entries.append(next)
      head = AccountHead(seq: head.seq + 1, hash: next.hash)
    }
    guard let epoch = state?.epoch else { throw AccountStoreError.notReady }
    do {
      try await client.append(epoch: epoch, entries: entries)
    } catch AccountServiceError.conflict {
      await refreshLog()
      return try await beginApproval(
        requestId: pending.requestId, subject: pending.subject, viaPairing: pending.viaPairing)
    }
    try await applyOwn(entries)
    return nil
  }

  /// "Codes match": write the computer onto the account. When the log moved
  /// meanwhile the code changes too, so it goes back to comparing.
  public func confirmLink() async {
    guard let pending = pendingLink else { return }
    link = .working("Adding \(pending.name)…")
    do {
      if let again = try await writeApproval(pending) {
        pendingLink = again
        link = .confirm(sas: again.sas.sas, hostName: again.name)
        return
      }
      pendingLink = nil
      link = .done(hostName: pending.name)
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
    try? await client.deny(requestId: pending.requestId)
  }

  public func resetLink() {
    pendingLink = nil
    link = .idle
  }
}
