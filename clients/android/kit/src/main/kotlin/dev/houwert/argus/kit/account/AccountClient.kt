package dev.houwert.argus.kit.account

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * A device's side of the account service (`houwert.dev/argus/account/v1`). It only ever carries signed
 * statements and public keys; nothing it returns is trusted until the log verifier has seen it.
 * A live member signs its requests with its own key; Clerk only proves who you are, for identity routes.
 */
class AccountClient(
  baseUrl: String = DEFAULT_BASE_URL,
  internal val token: suspend () -> String?,
  /** This device's member key while it is a live member, else null (Clerk then). */
  internal val signer: suspend () -> AccountSigner? = { null },
  http: AccountHttp? = null,
  internal val now: () -> Long = System::currentTimeMillis,
  /** The service refused this device's signature and took Clerk: it predates device-key auth. Once per launch. */
  onClerkFallback: () -> Unit = {},
) {
  internal val baseUrl: HttpUrl = baseUrl.toHttpUrl()
  internal val http: AccountHttp = http ?: AccountOkHttp.http
  internal val fallback = ClerkFallback(onClerkFallback)

  /** This launch found a service that only takes Clerk from devices. */
  val usesClerkForMembers: Boolean get() = fallback.active

  suspend fun config(): AccountServiceConfig =
    send("GET", "config", auth = AccountRequestAuth.None) { accountJson.decodeFromString(AccountServiceConfig.serializer(), it) }

  /** Create-or-get the signed-in user's account. */
  suspend fun account(): AccountInfo =
    send("POST", "account", auth = AccountRequestAuth.Identity, body = "{}") { accountJson.decodeFromString(AccountInfo.serializer(), it) }

  /** Every entry after [after] (−1 for the whole log), following pages. */
  suspend fun log(epoch: Int, after: Int): List<AccountEntry> {
    val entries = mutableListOf<AccountEntry>()
    var cursor = after
    while (true) {
      val page = send("GET", "log", listOf("epoch" to "$epoch", "after" to "$cursor")) { accountJson.decodeFromString(AccountLogPage.serializer(), it) }
      entries += page.entries
      val next = page.nextAfter
      if (next == null || next <= cursor || page.entries.isEmpty()) return entries
      cursor = next
    }
  }

  private fun entriesBody(epoch: Int, entries: List<AccountEntry>): String = buildJsonObject {
    put("epoch", epoch)
    put("entries", accountJson.encodeToJsonElement(ListSerializer(AccountEntry.serializer()), entries))
  }.toString()

  /** Append a batch; the service checks it extends the head (409 otherwise). */
  suspend fun append(epoch: Int, entries: List<AccountEntry>): Int =
    send("POST", "log", body = entriesBody(epoch, entries)) { intField(it, "head_seq") ?: throw IllegalStateException() }

  /** Start the account over at [epoch] (current + 1) from this device's genesis; needs a fresh factor (`403` otherwise). */
  suspend fun resetAccount(epoch: Int, entries: List<AccountEntry>): AccountInfo =
    send("POST", "account/reset", auth = AccountRequestAuth.Identity, body = entriesBody(epoch, entries)) {
      accountJson.decodeFromString(AccountInfo.serializer(), it)
    }

  suspend fun directory(): List<AccountDirectoryRecord> =
    send("GET", "directory") { accountJson.decodeFromString(DirectoryResult.serializer(), it).hosts }

  /** Bind a host's link code to this account. */
  suspend fun claim(userCode: String): AccountLinkClaim =
    send("POST", "link/claim", body = buildJsonObject { put("user_code", userCode) }.toString()) {
      AccountLinkClaim.parse(accountJson.parseToJsonElement(it)) ?: throw IllegalStateException()
    }

  /** Ask to join the signed-in account as [member]. */
  suspend fun join(member: AccountMember, proof: String): AccountJoinTicket =
    send("POST", "join", auth = AccountRequestAuth.Identity, body = buildJsonObject { put("member", member.toJson()); put("proof", proof) }.toString()) {
      accountJson.decodeFromString(AccountJoinTicket.serializer(), it)
    }

  /** Where this device's own join request is. */
  suspend fun joinStatus(requestId: String): AccountRequestStatus =
    send("GET", "join/$requestId") { accountJson.decodeFromString(AccountRequestStatus.serializer(), it) }

  suspend fun joinRequests(): List<AccountJoinRequestInfo> = send("GET", "join") { text ->
    ((accountJson.parseToJsonElement(text) as JsonObject)["requests"] as JsonArray).mapNotNull { AccountJoinRequestInfo.parse(it) }
  }

  /** Become a request's approver; returns the head the SAS binds. */
  suspend fun approve(requestId: String, approverId: String): AccountHead =
    send("POST", "join/$requestId/approver", body = buildJsonObject { put("approver_id", approverId) }.toString()) {
      accountJson.decodeFromString(ApproveResult.serializer(), it).head
    }

  /** Register this device's push token and its per-host sealed keys. */
  suspend fun registerPush(registration: AccountPushRegistration) {
    send("PUT", "push/registration", body = accountJson.encodeToString(AccountPushRegistration.serializer(), registration)) { }
  }

  /** Push was switched off on this device. */
  suspend fun unregisterPush(deviceId: String) {
    send("DELETE", "push/registration", body = buildJsonObject { put("device_id", deviceId) }.toString()) { }
  }

  suspend fun deny(requestId: String) {
    send("POST", "join/$requestId/deny", body = "{}") { }
  }

  @Serializable private data class DirectoryResult(val hosts: List<AccountDirectoryRecord>)
  @Serializable private data class ApproveResult(val head: AccountHead)

  companion object {
    const val DEFAULT_BASE_URL = "https://houwert.dev/argus/account/v1"

    private fun intField(text: String, key: String): Int? = JsonField.nonNegativeInt((accountJson.parseToJsonElement(text) as? JsonObject)?.get(key))
  }
}

@Serializable
data class AccountServiceConfig(
  @SerialName("clerk_publishable_key") val clerkPublishableKey: String,
  @SerialName("frontend_api") val frontendApi: String? = null,
  @SerialName("min_client") val minClient: Map<String, String>? = null,
)

@Serializable
data class AccountInfo(
  @SerialName("account_id") val accountId: String,
  val epoch: Int,
  /** Null for an account with no log yet. */
  @SerialName("head_seq") val headSeq: Int? = null,
)

@Serializable
internal data class AccountLogPage(val epoch: Int, val entries: List<AccountEntry>, @SerialName("next_after") val nextAfter: Int? = null)

private fun proofsOf(value: JsonElement?): Map<String, String> =
  (value as? JsonObject)?.mapNotNull { (k, v) -> JsonField.string(v)?.let { k to it } }?.toMap() ?: emptyMap()

/** Who a link request is for: the host, an Electron window riding along, and each one's proof of possession. */
data class AccountLinkSubject(val host: AccountMember, val device: AccountMember? = null, val proofs: Map<String, String>)

data class AccountLinkClaim(
  val requestId: String,
  /** `host`, or `computer` when an Electron window rides along. */
  val kind: String,
  val subject: AccountLinkSubject,
  val accountEmpty: Boolean,
) {
  companion object {
    fun parse(element: JsonElement): AccountLinkClaim? {
      val o = element as? JsonObject ?: return null
      val s = o["subject"] as? JsonObject ?: return null
      val host = AccountMember.fromJson(s["host"]) ?: return null
      // Proofs belong in `subject`; accept them beside it too.
      val proofs = proofsOf(s["proofs"]).ifEmpty { proofsOf(o["proofs"]) }
      return AccountLinkClaim(
        requestId = JsonField.string(o["request_id"]) ?: return null,
        kind = JsonField.string(o["kind"]) ?: "host",
        subject = AccountLinkSubject(host, s["device"]?.let { AccountMember.fromJson(it) }, proofs),
        accountEmpty = (o["account_empty"] as? JsonPrimitive)?.booleanOrNull ?: false,
      )
    }
  }
}

/** Who a pending request is for: a computer (with a window riding along), or a device that signed in. */
data class AccountRequestSubject(val host: AccountMember? = null, val device: AccountMember? = null, val proofs: Map<String, String>) {
  /** The member the code is about: the computer of a link, else the device. */
  val member: AccountMember? get() = host ?: device

  /** Every member's own key vouches for it; nothing unproven is shown. */
  val proven: Boolean
    get() {
      val members = listOfNotNull(host, device)
      return members.isNotEmpty() && members.all { m -> proofs[m.id]?.let { AccountCodec.verify(m.proofBytes, it, m.signPub) } ?: false }
    }

  companion object {
    fun parse(element: JsonElement?): AccountRequestSubject? {
      val o = element as? JsonObject ?: return null
      val host = o["host"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.let { AccountMember.fromJson(it) ?: return null }
      val device = o["device"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.let { AccountMember.fromJson(it) ?: return null }
      return AccountRequestSubject(host, device, proofsOf(o["proofs"]))
    }
  }
}

@Serializable
data class AccountJoinTicket(@SerialName("request_id") val requestId: String, @SerialName("expires_at") val expiresAt: Double)

/** `GET /join/:id`: untrusted, only tells the joining device whom to compare with. */
@Serializable
data class AccountRequestStatus(
  val status: String,
  @SerialName("account_id") val accountId: String? = null,
  val epoch: Int? = null,
  val approver: Approver? = null,
  val head: AccountHead? = null,
  @SerialName("through_seq") val throughSeq: Int? = null,
) {
  @Serializable
  data class Approver(val id: String, @SerialName("sign_pub") val signPub: String)
}

data class AccountJoinRequestInfo(
  val requestId: String,
  val kind: String,
  val subject: AccountRequestSubject?,
  val status: String = "claimed",
  val createdAt: Double? = null,
  val expiresAt: Double? = null,
) {
  val id: String get() = requestId

  companion object {
    fun parse(element: JsonElement): AccountJoinRequestInfo? {
      val o = element as? JsonObject ?: return null
      return AccountJoinRequestInfo(
        requestId = JsonField.string(o["request_id"]) ?: return null,
        kind = JsonField.string(o["kind"]) ?: "host",
        subject = AccountRequestSubject.parse(o["subject"]),
        status = JsonField.string(o["status"]) ?: "claimed",
        createdAt = JsonField.number(o["created_at"]),
        expiresAt = JsonField.number(o["expires_at"]),
      )
    }
  }
}
