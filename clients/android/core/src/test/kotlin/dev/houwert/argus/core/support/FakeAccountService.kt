package dev.houwert.argus.core.support

import dev.houwert.argus.kit.account.AccountAuthenticating
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountDirectoryRecord
import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountHttp
import dev.houwert.argus.kit.account.AccountHttpRequest
import dev.houwert.argus.kit.account.AccountHttpResponse
import dev.houwert.argus.kit.account.AccountLinkSubject
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountProfile
import dev.houwert.argus.kit.account.AccountReverifyError
import dev.houwert.argus.kit.account.AccountServiceConfig
import dev.houwert.argus.kit.account.AccountVerifyResult
import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** An in-memory account service behind [AccountHttp]: the device-side routes, with the same CAS on `POST /log`. */
class FakeAccountService {
  data class LinkRequest(val userCode: String, val subject: AccountLinkSubject, var status: String = "pending")
  data class JoinRequest(
    val member: AccountMember, val proof: String, var status: String = "claimed",
    var approver: Pair<String, String>? = null, var head: AccountHead? = null,
  )

  /** `accepted`: devices sign with their key. `legacy`: refuses a live device's signature (403). */
  enum class DeviceAuth { Accepted, Legacy }

  val accountId = "abcdefghijklmnopqrstuvwxyz"
  var log = mutableListOf<AccountEntry>()
    private set
  var currentEpoch = 0
    private set
  private val oldLogs = mutableMapOf<Int, List<AccountEntry>>()
  val batches = mutableListOf<List<AccountEntry>>()
  private val links = mutableMapOf<String, LinkRequest>()
  private val joins = sortedMapOf<String, JoinRequest>()
  private var nextJoin = 1
  private var directory = listOf<AccountDirectoryRecord>()
  var directoryDown = false
  var appendDown = false
  var configDown = false
  var deviceAuth = DeviceAuth.Accepted
  val pushRegistrations = mutableListOf<JsonObject>()
  val pushUnregistered = mutableListOf<String>()
  private val authLog = mutableListOf<Pair<String, Boolean>>()
  val memberSigned get() = authLog.filter { it.second }.map { it.first }
  val clerkAuthed get() = authLog.filter { !it.second }.map { it.first }
  val headHash get() = log.lastOrNull()?.hash ?: ""
  val joinIds: List<String> get() = joins.keys.toList()

  fun seed(entries: List<AccountEntry>) { log = entries.toMutableList() }
  fun inject(entry: AccountEntry) { log += entry }
  fun setDirectory(records: List<AccountDirectoryRecord>) { directory = records }
  fun addLink(requestId: String, userCode: String, subject: AccountLinkSubject) { links[requestId] = LinkRequest(userCode, subject) }
  fun linkStatus(id: String) = links[id]?.status
  fun join(id: String) = joins[id]
  fun setJoinStatus(id: String, status: String) { joins[id]?.status = status }

  /** Another device reset the account. */
  fun resetElsewhere(genesis: AccountEntry) = applyReset(listOf(genesis))

  private fun applyReset(batch: List<AccountEntry>) {
    oldLogs[currentEpoch] = log.toList()
    currentEpoch += 1
    log = batch.toMutableList()
    joins.values.filter { it.status in listOf("pending", "claimed", "approving") }.forEach { it.status = "denied" }
  }

  fun addJoin(member: AccountMember, proof: String): String {
    val id = "join-${nextJoin++}"
    joins[id] = JoinRequest(member, proof)
    return id
  }

  /** An approver picks a join up; returns the head the code binds. */
  fun pickUp(requestId: String, id: String, signPub: String): AccountHead {
    val head = AccountHead(log.size - 1, headHash)
    joins[requestId]?.apply { status = "approving"; approver = id to signPub; this.head = head }
    return head
  }

  val http: AccountHttp = { handle(it) }

  private fun respond(status: Int, body: JsonElement = JsonObject(emptyMap())) =
    AccountHttpResponse(status, if (status == 204) "" else body.toString())

  private fun obj(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(pairs.associate { (k, v) -> k to toJson(v) })

  private fun toJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    else -> error("unsupported $v")
  }

  private fun entryJson(e: AccountEntry) = buildJsonObject {
    put("body", e.body)
    put("sigs", JsonObject(e.sigs.mapValues { JsonPrimitive(it.value) }))
  }

  private fun entriesOf(body: JsonObject): List<AccountEntry> = (body["entries"] as? JsonArray ?: JsonArray(emptyList())).map { e ->
    val o = e as JsonObject
    AccountEntry(o["body"]!!.jsonPrimitive.content, (o["sigs"] as JsonObject).mapValues { it.value.jsonPrimitive.content })
  }

  private fun handle(request: AccountHttpRequest): AccountHttpResponse {
    val path = request.path.removePrefix("/argus/account/v1/")
    val method = request.method
    val body = request.body?.decodeToString()?.takeIf { it.isNotEmpty() }?.let { Json.parseToJsonElement(it) as? JsonObject } ?: JsonObject(emptyMap())
    val bearer = request.header("authorization") ?: ""
    val memberId = request.header("x-argus-member")
    if (path != "config" && memberId != null) {
      checkMember(memberId, request)?.let { return it }
      authLog += path to true
    } else if (path != "config") {
      if (!bearer.startsWith("Bearer token")) return respond(401, obj("error" to "unauthorized"))
      authLog += path to false
    }
    when {
      method == "GET" && path == "config" -> {
        if (configDown) throw IOException("offline")
        return respond(200, obj("clerk_publishable_key" to "pk_test", "frontend_api" to "clerk.example"))
      }
      method == "POST" && path == "account" ->
        return respond(200, obj("account_id" to accountId, "epoch" to currentEpoch, "head_seq" to if (log.isEmpty()) null else log.size - 1))
      method == "POST" && path == "account/reset" -> {
        if (bearer != "Bearer token-reverified") return respond(403, obj("error" to "forbidden"))
        val batch = entriesOf(body)
        if (body["epoch"]?.jsonPrimitive?.intOrNull != currentEpoch + 1) return respond(409, obj("error" to "conflict", "epoch" to currentEpoch))
        applyReset(batch)
        return respond(201, obj("account_id" to accountId, "epoch" to currentEpoch, "head_seq" to batch.size - 1))
      }
      method == "GET" && path == "log" -> {
        val after = request.query("after")?.toInt() ?: -1
        val asked = request.query("epoch")?.toInt() ?: currentEpoch
        val page = (if (asked == currentEpoch) log else oldLogs[asked] ?: emptyList()).drop(after + 1)
        return respond(200, obj("epoch" to asked, "entries" to JsonArray(page.map { entryJson(it) }), "next_after" to null))
      }
      method == "POST" && path == "log" -> return appendLog(body)
      method == "GET" && path == "directory" -> {
        if (directoryDown) return respond(503, obj("error" to "unavailable"))
        return respond(200, obj("hosts" to JsonArray(directory.map {
          obj("host_id" to it.hostId, "presence_body" to it.presenceBody, "presence_sig" to it.presenceSig, "last_seen" to it.lastSeen)
        })))
      }
      method == "PUT" && path == "push/registration" -> { pushRegistrations += body; return respond(204) }
      method == "DELETE" && path == "push/registration" -> {
        pushUnregistered += body["device_id"]?.jsonPrimitive?.contentOrNull ?: ""
        return respond(204)
      }
      method == "POST" && path == "link/claim" -> {
        val code = body["user_code"]?.jsonPrimitive?.contentOrNull ?: ""
        val (id, link) = links.entries.firstOrNull { it.value.userCode == code }?.toPair() ?: return respond(404, obj("error" to "not_found"))
        link.status = "claimed"
        val subject = buildJsonObject {
          put("host", link.subject.host.toJson())
          link.subject.device?.let { put("device", it.toJson()) }
          put("proofs", JsonObject(link.subject.proofs.mapValues { JsonPrimitive(it.value) }))
        }
        return respond(200, obj("request_id" to id, "kind" to if (link.subject.device == null) "host" else "computer", "subject" to subject, "account_empty" to log.isEmpty()))
      }
      method == "POST" && path == "join" -> {
        if (log.isEmpty()) return respond(409, obj("error" to "conflict", "head_seq" to null))
        val member = AccountMember.fromJson(body["member"]) ?: return respond(400, obj("error" to "bad_request"))
        val proof = body["proof"]?.jsonPrimitive?.contentOrNull ?: return respond(400, obj("error" to "bad_request"))
        if (log.any { member.signPub in it.body }) return respond(409, obj("error" to "conflict", "head_seq" to log.size - 1))
        return respond(200, obj("request_id" to addJoin(member, proof), "expires_at" to 9_999_999_999_999L))
      }
      method == "GET" && path == "join" -> {
        val listed = joins.filter { it.value.status in listOf("claimed", "approving") }.map { (id, join) ->
          obj(
            "request_id" to id, "kind" to "device", "status" to join.status, "created_at" to 1, "expires_at" to 9_999_999_999_999L,
            "subject" to obj("device" to join.member.toJson(), "proofs" to obj(join.member.id to join.proof)),
          )
        }
        return respond(200, obj("requests" to JsonArray(listed)))
      }
      method == "GET" && path.startsWith("join/") -> {
        val join = joins[path.removePrefix("join/")] ?: return respond(404, obj("error" to "not_found"))
        val out = mutableMapOf<String, JsonElement>("status" to JsonPrimitive(join.status), "account_id" to JsonPrimitive(accountId), "epoch" to JsonPrimitive(currentEpoch))
        join.approver?.takeIf { join.status != "claimed" }?.let { out["approver"] = obj("id" to it.first, "sign_pub" to it.second) }
        join.head?.let { out["head"] = obj("seq" to it.seq, "hash" to it.hash) }
        return respond(200, JsonObject(out))
      }
      method == "POST" && path.endsWith("/approver") -> {
        val id = path.split("/")[1]
        if (joins[id] != null) {
          val head = pickUp(id, body["approver_id"]?.jsonPrimitive?.contentOrNull ?: "", "")
          return respond(200, obj("head" to obj("seq" to head.seq, "hash" to head.hash)))
        }
        links[id]?.status = "approving"
        return respond(200, obj("head" to obj("seq" to log.size - 1, "hash" to headHash)))
      }
      method == "POST" && path.endsWith("/deny") -> {
        val id = path.split("/")[1]
        links[id]?.status = "denied"
        joins[id]?.status = "denied"
        return respond(204)
      }
    }
    return respond(404, obj("error" to "not_found"))
  }

  /** A valid signature from a live member of the current epoch; one of an earlier epoch is told about the reset. */
  private fun checkMember(memberId: String, request: AccountHttpRequest): AccountHttpResponse? {
    val live = (AccountLog.verify(log) as? AccountVerifyResult.Ok)?.state?.liveMember(memberId)?.member
    val earlier = oldLogs.values.firstNotNullOfOrNull { (AccountLog.verify(it) as? AccountVerifyResult.Ok)?.state?.liveMember(memberId)?.member }
    val member = live ?: earlier
    if (member == null || !signed(request, member)) return respond(401, obj("error" to "unauthorized"))
    if (live == null) return respond(410, obj("error" to "account_reset", "epoch" to currentEpoch, "genesis" to (log.firstOrNull()?.let { entryJson(it) } ?: JsonObject(emptyMap()))))
    if (deviceAuth == DeviceAuth.Legacy && member.role == AccountMember.Role.Device) return respond(403, obj("error" to "forbidden"))
    return null
  }

  private fun signed(request: AccountHttpRequest, member: AccountMember): Boolean {
    val ts = request.header("x-argus-ts")?.toLongOrNull() ?: return false
    val sig = request.header("x-argus-sig") ?: return false
    return AccountCodec.verify(AccountCodec.requestSigningBytes(request.method, request.pathAndQuery, ts, request.body ?: ByteArray(0)), sig, member.signPub)
  }

  /** Called before a `POST /log` is applied; returning true answers 409 instead. */
  var beforeAppend: ((FakeAccountService) -> Boolean)? = null

  private fun appendLog(body: JsonObject): AccountHttpResponse {
    val batch = entriesOf(body)
    if (appendDown) return respond(503, obj("error" to "unavailable"))
    if (beforeAppend?.invoke(this) == true) return respond(409, obj("error" to "conflict", "head_seq" to log.size - 1))
    val first = batch.firstOrNull()?.let { Json.parseToJsonElement(it.body) as? JsonObject }
    if (first == null || first["seq"]?.jsonPrimitive?.intOrNull != log.size || first["prev"]?.jsonPrimitive?.contentOrNull != headHash) {
      return respond(409, obj("error" to "conflict", "head_seq" to log.size - 1))
    }
    log += batch
    batches += batch
    for (entry in batch) {
      val id = (Json.parseToJsonElement(entry.body) as JsonObject)["request_id"]?.jsonPrimitive?.contentOrNull
      if (!id.isNullOrEmpty()) {
        links[id]?.status = "approved"
        joins[id]?.status = "approved"
      }
    }
    return respond(201, obj("head_seq" to log.size - 1))
  }

}

/** Clerk stand-in: signed in after any sign-in call, with a fixed token. */
class FakeAccountAuth : AccountAuthenticating {
  var signedIn = false
  var configuredKey: String? = null
  var signedOut = false
  var user: AccountProfile? = null
  /** The session proved a factor recently; the service then accepts a reset. */
  var reverified = false
  var reverifyEmail: String? = "me@example.test"
  var sentReverifyCodes = 0

  override val isSignedIn get() = signedIn
  override suspend fun configure(config: AccountServiceConfig) { configuredKey = config.clerkPublishableKey }
  override suspend fun signInWithApple(idToken: String?) { signedIn = true }
  /** Clerk refuses a second sign-in while a session is live. */
  override suspend fun signInWithGitHub() {
    if (signedIn) throw IllegalStateException("already signed in")
    signedIn = true
  }
  override suspend fun sendEmailCode(email: String) {}
  override suspend fun verifyEmailCode(code: String) { signedIn = true }
  override suspend fun token(): String? = if (signedIn) (if (reverified) "token-reverified" else "token") else null
  override fun isReverified(withinMinutes: Int) = reverified
  override suspend fun startReverification(): String {
    val email = reverifyEmail ?: throw AccountReverifyError.Unavailable
    sentReverifyCodes += 1
    return email
  }
  override suspend fun finishReverification(code: String) {
    if (code != "424242") throw AccountReverifyError.Incomplete
    reverified = true
  }
  override val profile get() = if (signedIn) user else null
  override suspend fun signOut() {
    signedIn = false
    signedOut = true
  }
}
