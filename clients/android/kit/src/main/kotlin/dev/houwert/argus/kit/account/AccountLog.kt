package dev.houwert.argus.kit.account

import dev.houwert.argus.kit.storage.RemoteEndpoint
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * The account log verifier: one pure function every client runs over the
 * entries the (untrusted) service hands out. A mirror of
 * `packages/remote-protocol/src/account/log.ts`; the check order matters, the fixtures pin reason and index.
 */
object AccountLog {
  /** Verify [entries] on top of [prior] (or from genesis); a [root] pins the account already trusted. */
  fun verify(entries: List<AccountEntry>, root: AccountRoot? = null, prior: AccountLogState? = null): AccountVerifyResult {
    var state = prior
    if (state != null && root != null && state.genesisHash != root.genesisHash) {
      return AccountVerifyResult.Rejected(AccountLogRejectReason.Fork, 0, null)
    }
    for ((index, entry) in entries.withIndex()) {
      try {
        state = state?.let { apply(entry, it) } ?: genesis(entry, root)
      } catch (e: AccountRejection) {
        return AccountVerifyResult.Rejected(e.reason, index, state)
      }
    }
    return state?.let { AccountVerifyResult.Ok(it) } ?: AccountVerifyResult.Rejected(AccountLogRejectReason.Malformed, 0, null)
  }

  private fun reject(reason: AccountLogRejectReason): Nothing = throw AccountRejection(reason)

  private fun genesis(entry: AccountEntry, root: AccountRoot?): AccountLogState {
    val body = AccountBody.parse(entry.body)
    val member = (body.fields as? AccountBody.Fields.Genesis)?.member ?: reject(AccountLogRejectReason.Fork)
    val sig = entry.sigs[body.signer]
    if (sig == null || !AccountCodec.verify(AccountCodec.entrySigningBytes(entry.body), sig, member.signPub)) {
      reject(AccountLogRejectReason.BadSignature)
    }
    if (body.seq != 0 || body.prev.isNotEmpty()) reject(AccountLogRejectReason.Fork)
    if (body.signer != member.id) reject(AccountLogRejectReason.UnknownSigner)
    if (member.isWeb) reject(AccountLogRejectReason.WebApprover)
    val hash = AccountCodec.entryHash(entry.body)
    if (root != null && (root.accountId != body.accountId || root.epoch != body.epoch || root.genesisHash != hash)) {
      reject(AccountLogRejectReason.Fork)
    }
    return AccountLogState(
      body.accountId, body.epoch, hash, AccountHead(0, hash),
      mapOf(member.id to AccountMemberState(member, live = true, requestId = "", sasCommit = "", addedBy = member.id)),
    )
  }

  private fun apply(entry: AccountEntry, prior: AccountLogState): AccountLogState {
    val members = prior.members.toMutableMap()
    val signerId = AccountBody.claimedSigner(entry.body)
    val signer = members[signerId] ?: reject(AccountLogRejectReason.UnknownSigner)
    val sig = entry.sigs[signerId]
    if (sig == null || !AccountCodec.verify(AccountCodec.entrySigningBytes(entry.body), sig, signer.member.signPub)) {
      reject(AccountLogRejectReason.BadSignature)
    }
    val body = AccountBody.parse(entry.body)
    if (body.accountId != prior.accountId || body.epoch != prior.epoch || body.seq != prior.head.seq + 1 || body.prev != prior.head.hash) {
      reject(AccountLogRejectReason.Fork)
    }
    if (!signer.live) reject(AccountLogRejectReason.UnknownSigner)
    val signerIsHost = signer.member.role == AccountMember.Role.Host
    if (signer.member.isWeb && body.fields is AccountBody.Fields.Add) reject(AccountLogRejectReason.WebApprover)

    when (val f = body.fields) {
      is AccountBody.Fields.Genesis -> reject(AccountLogRejectReason.Fork)
      is AccountBody.Fields.Add -> {
        if (members[f.member.id] != null || prior.signKeyInUse(f.member.signPub)) reject(AccountLogRejectReason.Malformed)
        if (!AccountCodec.verify(f.member.proofBytes, f.proof, f.member.signPub)) reject(AccountLogRejectReason.BadSignature)
        members[f.member.id] = AccountMemberState(f.member, live = true, requestId = f.requestId, sasCommit = f.sasCommit, addedBy = signerId)
      }
      is AccountBody.Fields.Revoke -> {
        if (signerIsHost && f.memberId != signerId) reject(AccountLogRejectReason.UnknownSigner)
        val target = prior.liveMember(f.memberId) ?: reject(AccountLogRejectReason.Malformed)
        members[f.memberId] = target.copy(live = false)
      }
      is AccountBody.Fields.Rotate -> {
        if (f.memberId != signerId) reject(AccountLogRejectReason.UnknownSigner)
        val target = prior.liveMember(f.memberId)
        if (target == null || prior.signKeyInUse(f.signPub)) reject(AccountLogRejectReason.Malformed)
        val message = AccountCodec.proofSigningBytes(f.memberId, target.member.role.raw, f.signPub, f.noisePub)
        if (!AccountCodec.verify(message, f.proof, f.signPub)) reject(AccountLogRejectReason.BadSignature)
        members[f.memberId] = target.copy(member = target.member.copy(signPub = f.signPub, noisePub = f.noisePub))
      }
      is AccountBody.Fields.Rename -> {
        if (signerIsHost && f.memberId != signerId) reject(AccountLogRejectReason.UnknownSigner)
        val target = prior.liveMember(f.memberId) ?: reject(AccountLogRejectReason.Malformed)
        members[f.memberId] = target.copy(member = target.member.copy(name = f.name))
      }
    }
    return prior.copy(members = members, head = AccountHead(body.seq, AccountCodec.entryHash(entry.body)))
  }

  /** A presence record only counts when its live host signed it for this account. */
  fun verifyPresence(record: AccountDirectoryRecord, state: AccountLogState): AccountPresence? {
    val host = state.liveMember(record.hostId)?.takeIf { it.member.role == AccountMember.Role.Host } ?: return null
    if (!AccountCodec.verify(AccountCodec.presenceSigningBytes(record.presenceBody), record.presenceSig, host.member.signPub)) return null
    val o = AccountBody.parseJson(record.presenceBody) as? JsonObject ?: return null
    if (JsonField.number(o["v"]) != 1.0) return null
    val accountId = JsonField.string(o["account_id"]) ?: return null
    val epoch = JsonField.nonNegativeInt(o["epoch"]) ?: return null
    val hostId = JsonField.string(o["host_id"]) ?: return null
    val ts = JsonField.number(o["ts"]) ?: return null
    val list = o["endpoints"] as? JsonArray ?: return null
    if (hostId != record.hostId || accountId != state.accountId || epoch != state.epoch) return null
    val endpoints = list.map { item ->
      val e = item as? JsonObject ?: return null
      val kind = JsonField.string(e["kind"])?.let { raw -> RemoteEndpoint.Kind.entries.firstOrNull { it.name.lowercase() == raw } } ?: return null
      val url = JsonField.string(e["url"]) ?: return null
      val priority = JsonField.number(e["priority"]) ?: return null
      RemoteEndpoint(kind, url, priority.toInt())
    }
    return AccountPresence(hostId, ts, endpoints)
  }
}
