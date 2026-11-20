package dev.houwert.argus.app.auth

import android.util.Base64
import dev.houwert.argus.kit.account.AccountAuthenticating
import dev.houwert.argus.kit.account.AccountProfile
import dev.houwert.argus.kit.account.AccountReverifyError
import dev.houwert.argus.kit.account.AccountServiceConfig
import dev.houwert.argus.kit.json.arrayValue
import dev.houwert.argus.kit.json.get
import dev.houwert.argus.kit.json.longValue
import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.storage.SecretStore
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * Clerk's Frontend API behind [AccountAuthenticating], as a native client: the client token rides in
 * `Authorization` both ways and is kept in the [SecretStore]. GitHub and Apple go through the browser
 * and come back on [redirectUrl]; email is a code. The instance comes from the account service's `/config`.
 */
class ClerkAuth(
  private val secrets: SecretStore,
  /** Where the browser returns after GitHub or Apple; must be on the Clerk instance's native redirect allowlist. */
  val redirectUrl: String,
  /** Opens a URL in the browser. */
  private val openBrowser: (String) -> Unit,
) : AccountAuthenticating {
  private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
  private var frontendApi: String? = null
  private var client: JsonObject? = null
  private var pendingSignIn: String? = null
  private var pendingSignUp: String? = null
  private var oauth: CompletableDeferred<String>? = null
  private var cachedToken: Pair<String, Long>? = null

  override suspend fun configure(config: AccountServiceConfig) {
    val api = (config.frontendApi ?: frontendApiFromKey(config.clerkPublishableKey) ?: throw ClerkError(NOT_LOADED))
      .let { if (it.startsWith("http")) it else "https://$it" }.trimEnd('/')
    if (api != frontendApi) {
      frontendApi = api
      client = null
      cachedToken = null
    }
    try {
      client = call("GET", "/v1/client").let { it["response"] as? JsonObject }
    } catch (e: ClerkError) {
      throw e
    } catch (e: IOException) {
      throw ClerkError(NOT_LOADED)
    }
  }

  private val session: JsonObject?
    get() {
      val c = client ?: return null
      val id = c["last_active_session_id"].stringValue ?: return null
      return c["sessions"].arrayValue?.firstOrNull { it["id"].stringValue == id && it["status"].stringValue == "active" } as? JsonObject
    }

  override val isSignedIn: Boolean get() = frontendApi != null && session != null

  override val profile: AccountProfile?
    get() {
      val user = session?.get("user") as? JsonObject ?: return null
      val primary = user["primary_email_address_id"].stringValue
      val email = user["email_addresses"].arrayValue?.firstOrNull { it["id"].stringValue == primary }?.get("email_address").stringValue
      return AccountProfile(
        firstName = user["first_name"].stringValue,
        lastName = user["last_name"].stringValue,
        username = user["username"].stringValue,
        email = email,
        // Without an upload Clerk serves a generated picture; initials read better.
        imageUrl = if ((user["has_image"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true") user["image_url"].stringValue else null,
      )
    }

  override suspend fun signInWithApple(idToken: String?) = signInWithOAuth("oauth_apple")

  override suspend fun signInWithGitHub() = signInWithOAuth("oauth_github")

  /** Back from the browser: the redirect carries the nonce that finishes the sign-in. */
  fun handleRedirect(url: String): Boolean {
    if (!url.startsWith(redirectUrl)) return false
    oauth?.complete(url)
    return true
  }

  private suspend fun signInWithOAuth(strategy: String) {
    val created = call("POST", "/v1/client/sign_ins", mapOf("strategy" to strategy, "redirect_url" to redirectUrl, "action_complete_redirect_url" to redirectUrl))
    val signIn = created["response"] as? JsonObject ?: throw ClerkError(INCOMPLETE)
    val external = signIn["first_factor_verification"]["external_verification_redirect_url"].stringValue ?: throw ClerkError(INCOMPLETE)
    val waiting = CompletableDeferred<String>().also { oauth = it }
    openBrowser(external)
    val back = waiting.await()
    oauth = null
    // A custom scheme, which OkHttp's URL parser refuses.
    val nonce = android.net.Uri.parse(back).getQueryParameter("rotating_token_nonce")
    val id = signIn["id"].stringValue ?: throw ClerkError(INCOMPLETE)
    val finished = call("GET", "/v1/client/sign_ins/$id", query = listOfNotNull(nonce?.let { "rotating_token_nonce" to it }))["response"] as? JsonObject
    // A first-time GitHub or Apple user has no account yet: Clerk hands the sign-in over to a sign-up.
    if (finished?.get("first_factor_verification")?.get("status").stringValue == "transferable") {
      call("POST", "/v1/client/sign_ups", mapOf("transfer" to "true"))
    }
    activateSession()
  }

  /** Sign in when the address has an account, sign up when it doesn't; either way Clerk mails a code. */
  override suspend fun sendEmailCode(email: String) {
    pendingSignIn = null
    pendingSignUp = null
    val address = email.trim()
    try {
      val signIn = call("POST", "/v1/client/sign_ins", mapOf("identifier" to address))["response"] as JsonObject
      val factor = signIn["supported_first_factors"].arrayValue?.firstOrNull { it["strategy"].stringValue == "email_code" }
        ?: throw ClerkError(INCOMPLETE)
      val id = signIn["id"].stringValue!!
      call("POST", "/v1/client/sign_ins/$id/prepare_first_factor", mapOf("strategy" to "email_code", "email_address_id" to (factor["email_address_id"].stringValue ?: "")))
      pendingSignIn = id
    } catch (e: ClerkError) {
      if (e.code != "form_identifier_not_found") throw e
      val signUp = call("POST", "/v1/client/sign_ups", mapOf("email_address" to address))["response"] as JsonObject
      val id = signUp["id"].stringValue!!
      call("POST", "/v1/client/sign_ups/$id/prepare_verification", mapOf("strategy" to "email_code"))
      pendingSignUp = id
    }
  }

  override suspend fun verifyEmailCode(code: String) {
    val trimmed = code.trim()
    val signIn = pendingSignIn
    val signUp = pendingSignUp
    when {
      signIn != null -> call("POST", "/v1/client/sign_ins/$signIn/attempt_first_factor", mapOf("strategy" to "email_code", "code" to trimmed))
      signUp != null -> call("POST", "/v1/client/sign_ups/$signUp/attempt_verification", mapOf("strategy" to "email_code", "code" to trimmed))
      else -> throw ClerkError(NO_PENDING_CODE)
    }
    pendingSignIn = null
    pendingSignUp = null
    activateSession()
  }

  /** A finished flow leaves an active session; anything else (a step this app doesn't offer) is an error. */
  private suspend fun activateSession() {
    if (session == null) client = call("GET", "/v1/client")["response"] as? JsonObject
    val id = session?.get("id").stringValue ?: throw ClerkError(INCOMPLETE)
    call("POST", "/v1/client/sessions/$id/touch", emptyMap())
    cachedToken = null
  }

  override suspend fun token(): String? = token(skipCache = false)

  private suspend fun token(skipCache: Boolean): String? {
    if (frontendApi == null) return null
    val id = session?.get("id").stringValue ?: return null
    cachedToken?.let { (jwt, exp) -> if (!skipCache && System.currentTimeMillis() < exp - 10_000) return jwt }
    val jwt = call("POST", "/v1/client/sessions/$id/tokens", emptyMap())["jwt"].stringValue ?: return null
    cachedToken = jwt to (expiry(jwt) ?: (System.currentTimeMillis() + 50_000))
    return jwt
  }

  override fun isReverified(withinMinutes: Int): Boolean {
    val age = session?.get("factor_verification_age").arrayValue?.firstOrNull().longValue ?: return false
    return age in 0..withinMinutes
  }

  override suspend fun startReverification(): String {
    val s = session ?: throw AccountReverifyError.Unavailable
    val user = s["user"] as? JsonObject
    val primary = user?.get("primary_email_address_id").stringValue ?: throw AccountReverifyError.Unavailable
    val email = user["email_addresses"].arrayValue?.firstOrNull { it["id"].stringValue == primary }?.get("email_address").stringValue
      ?: throw AccountReverifyError.Unavailable
    val id = s["id"].stringValue!!
    call("POST", "/v1/client/sessions/$id/verify", mapOf("level" to "first_factor"))
    call("POST", "/v1/client/sessions/$id/verify/prepare_first_factor", mapOf("strategy" to "email_code", "email_address_id" to primary))
    return email
  }

  override suspend fun finishReverification(code: String) {
    val id = session?.get("id").stringValue ?: throw AccountReverifyError.Unavailable
    val result = call("POST", "/v1/client/sessions/$id/verify/attempt_first_factor", mapOf("strategy" to "email_code", "code" to code.trim()))
    if ((result["response"] as? JsonObject)?.get("status").stringValue != "complete") throw AccountReverifyError.Incomplete
    token(skipCache = true)
  }

  override suspend fun signOut() {
    val id = session?.get("id").stringValue ?: return
    call("POST", "/v1/client/sessions/$id/remove", emptyMap())
    cachedToken = null
  }

  // Transport

  private suspend fun call(method: String, path: String, form: Map<String, String>? = null, query: List<Pair<String, String>> = emptyList()): JsonObject {
    val base = frontendApi ?: throw ClerkError(NOT_LOADED)
    val url = (base + path).toHttpUrl().newBuilder().addQueryParameter("_is_native", "true")
      .apply { query.forEach { addQueryParameter(it.first, it.second) } }.build()
    val builder = Request.Builder().url(url).header("Accept", "application/json")
    secrets.read(CLIENT_ITEM)?.decodeToString()?.let { builder.header("Authorization", it) }
    if (form != null) builder.method(method, FormBody.Builder().apply { form.forEach { (k, v) -> add(k, v) } }.build())
    else builder.method(method, null)
    http.newCall(builder.build()).await().use { response ->
      response.header("Authorization")?.takeIf { it.isNotEmpty() }?.let { secrets.write(CLIENT_ITEM, it.encodeToByteArray()) }
      val text = response.body?.string().orEmpty()
      val json = runCatching { Json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: JsonObject(emptyMap())
      (json["client"] as? JsonObject)?.let { client = it }
      if (json.containsKey("client") && json["client"] is JsonNull && path != "/v1/client") client = null
      if (response.code !in 200..299) {
        val error = json["errors"].arrayValue?.firstOrNull()
        throw ClerkError(error?.get("long_message").stringValue ?: error?.get("message").stringValue ?: "Sign-in failed (${response.code}).", error?.get("code").stringValue)
      }
      return json
    }
  }

  private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
      override fun onResponse(call: Call, response: Response) = cont.resume(response)
      override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { cancel() }
  }

  class ClerkError(message: String, val code: String? = null) : Exception(message)

  companion object {
    private const val CLIENT_ITEM = "argus.clerk.client"
    const val NOT_LOADED = "Couldn't reach the sign-in service. Check your connection and try again."
    const val INCOMPLETE = "Sign-in needs a step this app doesn't support yet."
    const val NO_PENDING_CODE = "Ask for a new code first."

    /** `pk_live_<base64("clerk.example.com$")>` names the Frontend API host. */
    fun frontendApiFromKey(key: String): String? {
      val encoded = key.substringAfter("pk_live_", key.substringAfter("pk_test_", "")).ifEmpty { return null }
      return runCatching { String(Base64.decode(encoded, Base64.DEFAULT)).trimEnd('$') }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    private fun expiry(jwt: String): Long? = runCatching {
      val payload = String(Base64.decode(jwt.split(".")[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
      (Json.parseToJsonElement(payload)["exp"].longValue ?: return null) * 1000
    }.getOrNull()
  }

}
