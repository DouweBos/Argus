package dev.houwert.argus.kit.account

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The member that signs an entry: its id and Ed25519 seed. */
class AccountSigner(val id: String, val seed: ByteArray)

/**
 * Writing log entries. A body is serialized once and that exact string is
 * signed and stored, so no canonical JSON is ever needed. Mirrors `entries.ts`.
 */
object AccountEntryBuilder {
  sealed interface Fields {
    data class Genesis(val member: AccountMember) : Fields
    data class AddDevice(val member: AccountMember, val requestId: String, val sasCommit: String, val proof: String) : Fields
    data class AddHost(val member: AccountMember, val requestId: String, val sasCommit: String, val proof: String) : Fields
    data class Revoke(val memberId: String, val reason: String) : Fields
    data class Rename(val memberId: String, val name: String) : Fields
  }

  /** Sign one entry that extends [head] (null for genesis). */
  fun make(accountId: String, epoch: Int, head: AccountHead?, ts: Long = nowMs(), signer: AccountSigner, fields: Fields): AccountEntry {
    val body = sortedMapOf<String, JsonElement>(
      "v" to JsonPrimitive(1),
      "account_id" to JsonPrimitive(accountId),
      "epoch" to JsonPrimitive(epoch),
      "seq" to JsonPrimitive(head?.let { it.seq + 1 } ?: 0),
      "prev" to JsonPrimitive(head?.hash ?: ""),
      "ts" to JsonPrimitive(ts),
      "signer" to JsonPrimitive(signer.id),
    )
    when (fields) {
      is Fields.Genesis -> {
        body["type"] = JsonPrimitive("genesis")
        body["member"] = fields.member.toJson()
      }
      is Fields.AddDevice -> add(body, "add_device", fields.member, fields.requestId, fields.sasCommit, fields.proof)
      is Fields.AddHost -> add(body, "add_host", fields.member, fields.requestId, fields.sasCommit, fields.proof)
      is Fields.Revoke -> {
        body["type"] = JsonPrimitive("revoke")
        body["member_id"] = JsonPrimitive(fields.memberId)
        body["reason"] = JsonPrimitive(fields.reason)
      }
      is Fields.Rename -> {
        body["type"] = JsonPrimitive("rename")
        body["member_id"] = JsonPrimitive(fields.memberId)
        body["name"] = JsonPrimitive(fields.name)
      }
    }
    val text = JsonObject(body).toString()
    return AccountEntry(text, mapOf(signer.id to AccountCodec.sign(AccountCodec.entrySigningBytes(text), signer.seed)))
  }

  private fun add(body: MutableMap<String, JsonElement>, type: String, member: AccountMember, requestId: String, sasCommit: String, proof: String) {
    body["type"] = JsonPrimitive(type)
    body["member"] = member.toJson()
    body["request_id"] = JsonPrimitive(requestId)
    body["sas_commit"] = JsonPrimitive(sasCommit)
    body["proof"] = JsonPrimitive(proof)
  }

  /** A member's own key vouching for its id and keys. */
  fun proof(member: AccountMember, seed: ByteArray): String = AccountCodec.sign(member.proofBytes, seed)

  fun nowMs(): Long = System.currentTimeMillis()
}
