package dev.houwert.argus.kit.account

import java.io.IOException
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** One HTTP exchange, small enough for tests to fake. Header names are lower case. */
data class AccountHttpRequest(val method: String, val url: HttpUrl, val headers: Map<String, String>, val body: ByteArray?) {
  fun header(name: String) = headers[name.lowercase()]
}

data class AccountHttpResponse(val status: Int, val body: String, val headers: Map<String, String> = emptyMap()) {
  fun header(name: String) = headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
}

typealias AccountHttp = suspend (AccountHttpRequest) -> AccountHttpResponse

/** How a request proves who sent it. */
internal enum class AccountRequestAuth {
  None,
  /** Clerk only: genesis, asking to join, reset. Proves the person, not a device. */
  Identity,
  /** The member key while this device is a live member, Clerk before that. */
  Member,
}

/** Set once a service refused a device's signature but took Clerk. */
internal class ClerkFallback(var onFirstUse: () -> Unit = {}) {
  private val used = AtomicBoolean(false)
  val active: Boolean get() = used.get()
  fun use() {
    if (used.compareAndSet(false, true)) onFirstUse()
  }
}

/** The service's signature window is five minutes; past four, blame the clock. */
internal const val CLOCK_SKEW_LIMIT_MS = 4 * 60 * 1000L

internal val accountJson = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

internal suspend fun <R> AccountClient.send(
  method: String, path: String, query: List<Pair<String, String>> = emptyList(), auth: AccountRequestAuth = AccountRequestAuth.Member,
  body: String? = null, parse: (String) -> R,
): R {
  val url = baseUrl.newBuilder().addPathSegments(path).apply { query.forEach { addQueryParameter(it.first, it.second) } }.build()
  val headers = mutableMapOf("accept" to "application/json")
  if (body != null) headers["content-type"] = "application/json"
  val request = AccountHttpRequest(method, url, headers, body?.encodeToByteArray())
  if (auth == AccountRequestAuth.None) return decode(perform(request), parse)
  if (auth == AccountRequestAuth.Member && !fallback.active) {
    signer()?.let { return sendSigned(request, it, parse) }
  }
  return decode(perform(bearer(request)), parse)
}

private suspend fun <R> AccountClient.sendSigned(request: AccountHttpRequest, signer: AccountSigner, parse: (String) -> R): R {
  val response = perform(sign(request, signer))
  if (response.status != 401 && response.status != 403) return decode(response, parse)
  // A service from before device-key auth only takes Clerk from a device: retry with it for this launch.
  val token = runCatching { token() }.getOrNull()
  if (!token.isNullOrEmpty()) {
    val answer = perform(request.copy(headers = request.headers + ("authorization" to "Bearer $token")))
    if (answer.status in 200..299) fallback.use()
    return decode(answer, parse)
  }
  if (clockSkewed(response)) throw AccountServiceError.ClockSkew
  throw AccountServiceError.MemberRefused(response.status)
}

/** `x-argus-member` / `-ts` / `-sig` over `requestSigningBytes`, as hosts sign. */
internal fun AccountClient.sign(request: AccountHttpRequest, signer: AccountSigner): AccountHttpRequest {
  val ts = now()
  val pathAndQuery = request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: "")
  val message = AccountCodec.requestSigningBytes(request.method, pathAndQuery, ts, request.body ?: ByteArray(0))
  return request.copy(
    headers = request.headers + mapOf(
      "x-argus-member" to signer.id,
      "x-argus-ts" to ts.toString(),
      "x-argus-sig" to AccountCodec.sign(message, signer.seed),
    ),
  )
}

private suspend fun AccountClient.bearer(request: AccountHttpRequest): AccountHttpRequest {
  val token = token()
  if (token.isNullOrEmpty()) throw AccountServiceError.NotSignedIn
  return request.copy(headers = request.headers + ("authorization" to "Bearer $token"))
}

private suspend fun AccountClient.perform(request: AccountHttpRequest): AccountHttpResponse =
  try {
    http(request)
  } catch (e: AccountServiceError) {
    throw e
  } catch (e: kotlinx.coroutines.CancellationException) {
    throw e
  } catch (e: Exception) {
    throw AccountServiceError.Transport(e.message ?: e.javaClass.simpleName)
  }

private fun <R> decode(response: AccountHttpResponse, parse: (String) -> R): R {
  if (response.status !in 200..299) throw AccountServiceError.from(response.status, response.body)
  return try {
    parse(response.body.ifEmpty { "{}" })
  } catch (e: Exception) {
    throw AccountServiceError.Decoding
  }
}

/** The service's `Date` is far from ours: a refused signature is the clock, not a removal. */
internal fun AccountClient.clockSkewed(response: AccountHttpResponse): Boolean {
  val header = response.header("Date") ?: return false
  val served = runCatching { ZonedDateTime.parse(header, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrNull()
    ?: return false
  return kotlin.math.abs(served - now()) > CLOCK_SKEW_LIMIT_MS
}

sealed class AccountServiceError(override val message: String) : Exception(message) {
  data object NotSignedIn : AccountServiceError("You're signed out. Sign in again.")
  /** The service refused this device's own signature: removed (401), or a service without device keys and no Clerk. */
  data class MemberRefused(val status: Int) : AccountServiceError(
    if (status == 401) "This device was removed from your account." else "The account service doesn't accept this device yet. Sign in again.",
  )
  /** A signature refused while this device's clock is off by minutes. */
  data object ClockSkew : AccountServiceError("This device's clock is off, so the account service refused it. Check the date and time.")
  /** This device's epoch is over: the account was reset (`410 account_reset`). */
  data class AccountReset(val epoch: Int, val genesis: AccountEntry?) : AccountServiceError("Your account was reset.")
  /** The log moved on underneath an append. */
  data class Conflict(val headSeq: Int?) : AccountServiceError("Your account changed at the same time. Try again.")
  data class InvalidEntry(val index: Int?, val reason: String?) : AccountServiceError("The account service refused the change.")
  data class Http(val status: Int, val code: String?) : AccountServiceError(
    when (status) {
      410 -> "That code has expired. Start again on the computer."
      404 -> "That code wasn't found. Check it and try again."
      429 -> "Too many attempts. Wait a few minutes and try again."
      else -> "The account service answered $status."
    },
  )
  data class Transport(val detail: String) : AccountServiceError("Couldn't reach the account service.")
  data object Decoding : AccountServiceError("The account service's answer couldn't be read.")

  @Serializable
  private data class Payload(
    val error: String? = null,
    @SerialName("head_seq") val headSeq: Int? = null,
    val index: Int? = null,
    val reason: String? = null,
    val epoch: Int? = null,
    val genesis: AccountEntry? = null,
  )

  companion object {
    fun from(status: Int, data: String): AccountServiceError {
      val payload = runCatching { accountJson.decodeFromString(Payload.serializer(), data) }.getOrNull()
      return when {
        status == 401 -> NotSignedIn
        status == 409 -> Conflict(payload?.headSeq)
        status == 410 && payload?.error == "account_reset" ->
          payload.epoch?.let { AccountReset(it, payload.genesis) } ?: Http(status, "account_reset")
        status == 422 -> InvalidEntry(payload?.index, payload?.reason)
        else -> Http(status, payload?.error)
      }
    }
  }
}

/** The default transport: OkHttp with a 20 s timeout. */
internal object AccountOkHttp {
  private val client = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()

  val http: AccountHttp = { request ->
    val builder = Request.Builder().url(request.url)
    request.headers.forEach { (k, v) -> builder.header(k, v) }
    val body = request.body?.toRequestBody((request.header("content-type") ?: "application/json").toMediaType())
    builder.method(request.method, body ?: if (request.method in listOf("POST", "PUT", "DELETE")) ByteArray(0).toRequestBody() else null)
    client.newCall(builder.build()).await().use { response ->
      AccountHttpResponse(response.code, response.body?.string() ?: "", response.headers.toMap())
    }
  }

  private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
      override fun onResponse(call: Call, response: Response) = cont.resume(response)
      override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { cancel() }
  }
}
