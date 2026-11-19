package dev.houwert.argus.kit.account

import dev.houwert.argus.kit.storage.RemoteEndpoint
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A device or host on the account, as its log entry names it. */
@Serializable(with = AccountMemberSerializer::class)
data class AccountMember(
  val id: String,
  val role: Role,
  /** `ios` / `mac` / `electron` / `web`, for a device. */
  val kind: String? = null,
  /** `darwin` / `linux`, for a host. */
  val platform: String? = null,
  /** Ed25519, standard base64. */
  val signPub: String,
  /** X25519 Noise static key, standard base64: what a client pins. */
  val noisePub: String,
  val name: String,
  val createdAt: Double,
) {
  enum class Role(val raw: String) { Device("device"), Host("host") }

  /** The hosted web client: it may sign revokes and renames, never approvals. */
  val isWeb: Boolean get() = role == Role.Device && kind == "web"

  /** The proof-of-possession message this member's key signs. */
  val proofBytes: ByteArray get() = AccountCodec.proofSigningBytes(id, role.raw, signPub, noisePub)

  /** Sorted keys; whole milliseconds stay integers, as `Date.now()` writes them. */
  fun toJson(): JsonObject = buildJsonObject {
    put("created_at", jsonNumber(createdAt))
    put("id", id)
    kind?.let { put("kind", it) }
    put("name", name)
    put("noise_pub", noisePub)
    platform?.let { put("platform", it) }
    put("role", role.raw)
    put("sign_pub", signPub)
  }

  companion object {
    fun device(id: String, kind: String, signPub: String, noisePub: String, name: String, createdAt: Double) =
      AccountMember(id, Role.Device, kind = kind, signPub = signPub, noisePub = noisePub, name = name, createdAt = createdAt)

    /** Decoded like Swift's synthesized `Codable`: required fields present, role known. */
    fun fromJson(element: JsonElement?): AccountMember? {
      val o = element as? JsonObject ?: return null
      fun str(key: String) = (o[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
      val role = Role.entries.firstOrNull { it.raw == str("role") } ?: return null
      return AccountMember(
        id = str("id") ?: return null,
        role = role,
        kind = str("kind"),
        platform = str("platform"),
        signPub = str("sign_pub") ?: return null,
        noisePub = str("noise_pub") ?: return null,
        name = str("name") ?: return null,
        createdAt = JsonField.number(o["created_at"]) ?: return null,
      )
    }
  }
}

internal fun jsonNumber(value: Double): JsonPrimitive =
  if (value == Math.rint(value) && kotlin.math.abs(value) < 9.007199254740992E15) JsonPrimitive(value.toLong()) else JsonPrimitive(value)

object AccountMemberSerializer : KSerializer<AccountMember> {
  override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor
  override fun serialize(encoder: Encoder, value: AccountMember) = (encoder as JsonEncoder).encodeJsonElement(value.toJson())
  override fun deserialize(decoder: Decoder): AccountMember =
    AccountMember.fromJson((decoder as JsonDecoder).decodeJsonElement()) ?: throw SerializationException("bad member")
}

/** One log entry exactly as stored and transmitted: the signed body string and its signatures, by member id. */
@Serializable
data class AccountEntry(val body: String, val sigs: Map<String, String>) {
  val hash: String get() = AccountCodec.entryHash(body)
}

/** What a verifier pins on first use. */
@Serializable
data class AccountRoot(
  @SerialName("account_id") val accountId: String,
  val epoch: Int,
  @SerialName("genesis_hash") val genesisHash: String,
) {
  val safetyCode: String get() = AccountCodec.safetyCode(genesisHash)
}

@Serializable
data class AccountHead(val seq: Int, val hash: String)

data class AccountMemberState(
  val member: AccountMember,
  val live: Boolean,
  /** The request the member joined through; "" for genesis and local links. */
  val requestId: String,
  val sasCommit: String,
  /** The member that wrote its `add_*` (itself for genesis). */
  val addedBy: String,
)

/** Everything a verified log says: who is on the account and where its head is. */
data class AccountLogState(
  val accountId: String,
  val epoch: Int,
  val genesisHash: String,
  val head: AccountHead,
  val members: Map<String, AccountMemberState>,
) {
  val root: AccountRoot get() = AccountRoot(accountId, epoch, genesisHash)

  fun liveMember(id: String): AccountMemberState? = members[id]?.takeIf { it.live }

  /** Live members, oldest first. */
  val liveMembers: List<AccountMember>
    get() = members.values.filter { it.live }.map { it.member }.sortedWith(compareBy({ it.createdAt }, { it.id }))

  internal fun signKeyInUse(signPub: String) = members.values.any { it.member.signPub == signPub }

  /** The subject's own check before adopting a log: in it, live, added through the request and code it confirmed. */
  fun admits(memberId: String, requestId: String, sasCommit: String): Boolean {
    val found = liveMember(memberId) ?: return false
    return found.requestId == requestId && found.sasCommit == sasCommit
  }
}

enum class AccountLogRejectReason(val raw: String) {
  BadSignature("bad_signature"),
  Fork("fork"),
  Malformed("malformed"),
  UnknownSigner("unknown_signer"),
  /** A browser member approved a join or started an account; it may only take trust away. */
  WebApprover("web_approver"),
}

sealed interface AccountVerifyResult {
  val state: AccountLogState?

  data class Ok(override val state: AccountLogState) : AccountVerifyResult

  /** [state] is the last good state, or null when nothing verified. */
  data class Rejected(val reason: AccountLogRejectReason, val index: Int, override val state: AccountLogState?) : AccountVerifyResult
}

/** A directory row as the service returns it; untrusted until verified. */
@Serializable
data class AccountDirectoryRecord(
  @SerialName("host_id") val hostId: String,
  @SerialName("presence_body") val presenceBody: String,
  @SerialName("presence_sig") val presenceSig: String,
  @SerialName("last_seen") val lastSeen: Double,
)

/** A verified presence record: where a host says it can be reached. */
data class AccountPresence(val hostId: String, val ts: Double, val endpoints: List<RemoteEndpoint>) {
  companion object {
    /** How long a host may go quiet before it shows as offline. */
    const val ONLINE_WINDOW_MS = 15 * 60 * 1000.0

    fun isOnline(lastSeenMs: Double?, nowMs: Double = System.currentTimeMillis().toDouble()): Boolean =
      lastSeenMs != null && nowMs - lastSeenMs <= ONLINE_WINDOW_MS
  }
}
