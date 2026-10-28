import Foundation

/// A member added through an approval, with the code both sides compared.
public struct AccountApproval: Equatable, Sendable {
  public var memberId: String
  public var requestId: String
  public var approverId: String
  public var sas: AccountSas
}

extension AccountLog {
  /// Approvals whose `sas_commit` is the code for the head they were written
  /// on, the approver's key and the subject's keys, keyed by member id. Anyone
  /// holding the log can recompute these, so both ends can show the code again.
  public static func approvals(_ entries: [AccountEntry]) -> [String: AccountApproval] {
    var out: [String: AccountApproval] = [:]
    var prior: AccountLogState?
    for entry in entries {
      guard case .ok(let next) = verify([entry], prior: prior) else { return out }
      if let prior {
        for (id, added) in next.members where prior.members[id] == nil && !added.requestId.isEmpty {
          guard let approver = prior.liveMember(added.addedBy),
            let sas = try? AccountSas.compute(
              .init(
                accountId: next.accountId, epoch: next.epoch, headHash: prior.head.hash,
                approverSignPub: approver.member.signPub, subjectSignPub: added.member.signPub,
                subjectNoisePub: added.member.noisePub, requestId: added.requestId)),
            sas.commit == added.sasCommit
          else { continue }
          out[id] = AccountApproval(memberId: id, requestId: added.requestId, approverId: added.addedBy, sas: sas)
        }
      }
      prior = next
    }
    return out
  }
}
