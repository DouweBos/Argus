import ArgusKit
import Foundation

/// Approving a waiting computer or device from this one (§5.4): the same code
/// comparison as a typed link, for requests the account lists.
public enum ApprovalFlow: Equatable, Sendable {
  case idle
  case working(String)
  /// Compare `sas` with the code on `name` before confirming.
  case confirm(sas: String, name: String, role: AccountMember.Role)
  case done(name: String, role: AccountMember.Role)
  case failed(String)
}

extension AccountStore {
  /// Re-read who is waiting. Requests whose keys don't vouch for themselves,
  /// and this device's own, are never shown.
  public func refreshRequests() async {
    guard !galleryFrozen else { return }
    guard phase == .ready, let keys = vault.keys else {
      if !requests.isEmpty { requests = [] }
      return
    }
    guard let fetched = try? await client.joinRequests() else { return }
    let next = fetched.filter { request in
      guard let subject = request.subject, let member = subject.member, subject.proven else { return false }
      return member.signPub != keys.signPub && state?.members[member.id] == nil
    }
    if next != requests { requests = next }
  }

  /// Become the approver of `request` and show the code to compare.
  public func approve(_ request: AccountJoinRequestInfo) async {
    guard phase == .ready, let subject = request.subject, let member = subject.member, subject.proven else {
      approval = .failed("That request can't be approved from here.")
      return
    }
    approval = .working("Checking \(member.name)…")
    do {
      let pending = try await beginApproval(requestId: request.requestId, subject: subject, viaPairing: false)
      pendingApproval = pending
      approval = .confirm(sas: pending.sas.sas, name: member.name, role: member.role)
    } catch {
      approval = .failed(Self.describe(error))
    }
  }

  /// "Codes match": put it on the account. A moved head shows a new code.
  public func confirmApproval() async {
    guard let pending = pendingApproval, let member = pending.subject.member else { return }
    approval = .working("Adding \(member.name)…")
    do {
      if let again = try await writeApproval(pending) {
        pendingApproval = again
        approval = .confirm(sas: again.sas.sas, name: member.name, role: member.role)
        return
      }
      pendingApproval = nil
      approval = .done(name: member.name, role: member.role)
      requests.removeAll { $0.requestId == pending.requestId }
      onEvent(member.role == .host ? .computerAdded(viaPairing: false) : .joinActed(action: .approved, role: .approver))
      await refreshDirectory()
    } catch {
      approval = .failed(Self.describe(error))
    }
  }

  /// "Codes don't match", or the request isn't expected: refuse it.
  public func deny(_ requestId: String) async {
    if pendingApproval?.requestId == requestId {
      pendingApproval = nil
      approval = .idle
    }
    requests.removeAll { $0.requestId == requestId }
    do {
      try await client.deny(requestId: requestId)
      onEvent(.joinActed(action: .denied, role: .approver))
    } catch {
      self.error = Self.describe(error)
    }
  }

  public func denyApproval() async {
    guard let pending = pendingApproval else {
      approval = .idle
      return
    }
    await deny(pending.requestId)
  }

  public func resetApproval() {
    pendingApproval = nil
    approval = .idle
  }

  // MARK: Members

  /// Rename a device or computer on the account.
  /// This device's own name (or the Mac's host) is a setting: the list edits that.
  public func rename(memberId: String, to name: String) async {
    guard let target = state?.liveMember(memberId) else { return }
    if isOwnMember(memberId) {
      await setName(name, source: .accountList)
      return
    }
    let clean = AccountDeviceKeys.memberName(name)
    guard clean != target.member.name else { return }
    error = nil
    do {
      try await appendWithRetry { [self] head in
        [try entry(head: head, .rename(memberId: memberId, name: clean))]
      }
      onEvent(.memberRenamed(role: target.member.role))
    } catch {
      self.error = Self.describe(error)
    }
  }
}
