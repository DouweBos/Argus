package dev.houwert.argus.kit.account

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

internal class AccountRejection(val reason: AccountLogRejectReason) : Exception(reason.raw)

/**
 * A parsed log entry body. Mirrors the zod `LogBody` schema in
 * `packages/remote-protocol/src/account/schema.ts`: unknown keys are ignored, anything else off-schema is `malformed`.
 */
internal data class AccountBody(
  val accountId: String,
  val epoch: Int,
  val seq: Int,
  val prev: String,
  val signer: String,
  val fields: Fields,
) {
  sealed interface Fields {
    data class Genesis(val member: AccountMember) : Fields
    data class Add(val member: AccountMember, val requestId: String, val sasCommit: String, val proof: String) : Fields
    data class Revoke(val memberId: String, val reason: String) : Fields
    data class Rotate(val memberId: String, val signPub: String, val noisePub: String, val proof: String) : Fields
    data class Rename(val memberId: String, val name: String) : Fields
  }

  companion object {
    private fun malformed(): Nothing = throw AccountRejection(AccountLogRejectReason.Malformed)

    fun parseJson(body: String): JsonElement? = runCatching { Json.parseToJsonElement(body) }.getOrNull()

    fun parse(body: String): AccountBody = parse(parseJson(body) as? JsonObject ?: malformed())

    /** The signer a body claims, read before anything is trusted so the right key can check it. */
    fun claimedSigner(body: String): String {
      val raw = parseJson(body) ?: malformed()
      if (raw is JsonNull) malformed()
      return JsonField.string((raw as? JsonObject)?.get("signer")) ?: ""
    }

    private fun parse(o: JsonObject): AccountBody {
      if (JsonField.number(o["v"]) != 1.0) malformed()
      val accountId = JsonField.string(o["account_id"], 1) ?: malformed()
      val epoch = JsonField.nonNegativeInt(o["epoch"]) ?: malformed()
      val seq = JsonField.nonNegativeInt(o["seq"]) ?: malformed()
      val prev = JsonField.string(o["prev"]) ?: malformed()
      JsonField.number(o["ts"]) ?: malformed()
      val signer = JsonField.string(o["signer"], 1) ?: malformed()
      val type = JsonField.string(o["type"]) ?: malformed()
      val fields: Fields = when (type) {
        "genesis" -> Fields.Genesis(member(o["member"]) ?: malformed())
        "add_device", "add_host" -> {
          val member = member(o["member"]) ?: malformed()
          if (member.role != (if (type == "add_device") AccountMember.Role.Device else AccountMember.Role.Host)) malformed()
          Fields.Add(
            member,
            JsonField.string(o["request_id"]) ?: malformed(),
            JsonField.string(o["sas_commit"]) ?: malformed(),
            JsonField.string(o["proof"], 1) ?: malformed(),
          )
        }
        "revoke" -> {
          val memberId = JsonField.string(o["member_id"], 1) ?: malformed()
          val reason = JsonField.string(o["reason"]) ?: malformed()
          if (reason !in listOf("removed", "lost", "unlinked")) malformed()
          Fields.Revoke(memberId, reason)
        }
        "rotate" -> Fields.Rotate(
          JsonField.string(o["member_id"], 1) ?: malformed(),
          JsonField.string(o["sign_pub"], 1) ?: malformed(),
          JsonField.string(o["noise_pub"], 1) ?: malformed(),
          JsonField.string(o["proof"], 1) ?: malformed(),
        )
        "rename" -> {
          val memberId = JsonField.string(o["member_id"], 1) ?: malformed()
          val name = JsonField.string(o["name"])?.takeIf { validName(it) } ?: malformed()
          Fields.Rename(memberId, name)
        }
        else -> malformed()
      }
      return AccountBody(accountId, epoch, seq, prev, signer, fields)
    }

    fun member(value: JsonElement?): AccountMember? {
      val o = value as? JsonObject ?: return null
      val id = JsonField.string(o["id"], 1) ?: return null
      val signPub = JsonField.string(o["sign_pub"], 1) ?: return null
      val noisePub = JsonField.string(o["noise_pub"], 1) ?: return null
      val name = JsonField.string(o["name"])?.takeIf { validName(it) } ?: return null
      val createdAt = JsonField.number(o["created_at"]) ?: return null
      return when (JsonField.string(o["role"])) {
        "device" -> {
          val kind = JsonField.string(o["kind"])?.takeIf { validKind(it) } ?: return null
          AccountMember(id, AccountMember.Role.Device, kind = kind, signPub = signPub, noisePub = noisePub, name = name, createdAt = createdAt)
        }
        "host" -> {
          val platform = JsonField.string(o["platform"])?.takeIf { it in listOf("darwin", "linux") } ?: return null
          AccountMember(id, AccountMember.Role.Host, platform = platform, signPub = signPub, noisePub = noisePub, name = name, createdAt = createdAt)
        }
        else -> null
      }
    }

    /**
     * Any short lowercase token, as `MemberDeviceKind` in schema.ts: a kind this build doesn't know is
     * a plain device, not a broken log.
     */
    fun validKind(kind: String): Boolean = KIND.matches(kind)

    private val KIND = Regex("[a-z][a-z0-9_]{0,31}")

    /** 1–64 UTF-16 units (zod counts them that way), no control characters. */
    fun validName(name: String): Boolean = name.length in 1..64 && name.none { it.code < 0x20 || it.code == 0x7f }
  }
}

/** Typed reads off parsed JSON, as `JSON.parse` + zod see them. */
internal object JsonField {
  fun string(value: JsonElement?, min: Int = 0): String? =
    (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.length >= min }

  /** A JSON number: never a boolean, never null. */
  fun number(value: JsonElement?): Double? {
    val p = value as? JsonPrimitive ?: return null
    if (p.isString || p is JsonNull || p.booleanOrNull != null) return null
    return p.doubleOrNull?.takeIf { it.isFinite() }
  }

  fun nonNegativeInt(value: JsonElement?): Int? {
    val d = number(value) ?: return null
    if (d < 0 || d != Math.rint(d) || d > Int.MAX_VALUE) return null
    return d.toInt()
  }
}
