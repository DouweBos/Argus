package dev.houwert.argus.kit.account

/** A member added through an approval, with the code both sides compared. */
data class AccountApproval(val memberId: String, val requestId: String, val approverId: String, val sas: AccountSas)

/**
 * Approvals whose `sas_commit` is the code for the head they were written on, the approver's key and the
 * subject's keys, by member id. Anyone holding the log can recompute these, so both ends can show the code again.
 */
fun AccountLog.approvals(entries: List<AccountEntry>): Map<String, AccountApproval> {
  val out = mutableMapOf<String, AccountApproval>()
  var prior: AccountLogState? = null
  for (entry in entries) {
    val next = (verify(listOf(entry), prior = prior) as? AccountVerifyResult.Ok)?.state ?: return out
    prior?.let { before ->
      for ((id, added) in next.members) {
        if (before.members[id] != null || added.requestId.isEmpty()) continue
        val approver = before.liveMember(added.addedBy) ?: continue
        val sas = runCatching {
          AccountSas.compute(
            AccountSas.Input(
              next.accountId, next.epoch, before.head.hash, approver.member.signPub, added.member.signPub,
              added.member.noisePub, added.requestId,
            ),
          )
        }.getOrNull() ?: continue
        if (sas.commit != added.sasCommit) continue
        out[id] = AccountApproval(id, added.requestId, added.addedBy, sas)
      }
    }
    prior = next
  }
  return out
}
