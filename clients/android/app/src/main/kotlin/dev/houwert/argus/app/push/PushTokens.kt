package dev.houwert.argus.app.push

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import dev.houwert.argus.app.BuildConfig
import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.storage.SecretStore
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The two keys this install mints: one seals notifications, the other proves senders to the relay. Both 32 bytes, base64. */
@Serializable
data class RelayKeys(val pushKey: String, val authKey: String)

/** FCM registration and the relay keys. */
object PushTokens {
  const val SERVICE = "fcm"
  private const val RELAY_KEYS = "argus.push.keys"
  private val json = Json { ignoreUnknownKeys = true }

  /** False on a build without the Firebase project's config: push is off, everything else works. */
  fun available(context: Context): Boolean =
    BuildConfig.PUSH_CONFIGURED && runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

  /** This install's FCM token, or null when Play services or Firebase can't issue one. */
  suspend fun deviceToken(context: Context): String? {
    if (!available(context)) return null
    return withTimeoutOrNull(10_000) { runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() }
  }

  /** Minted once and kept; the messaging service runs in this process, so it reads the same store. */
  fun relayKeys(secrets: SecretStore): RelayKeys {
    secrets.read(RELAY_KEYS)?.let { stored ->
      runCatching { json.decodeFromString(RelayKeys.serializer(), stored.decodeToString()) }.getOrNull()?.let { return it }
    }
    val keys = RelayKeys(randomKey(), randomKey())
    secrets.write(RELAY_KEYS, json.encodeToString(RelayKeys.serializer(), keys).encodeToByteArray())
    return keys
  }

  fun storedPushKey(secrets: SecretStore): String? = secrets.read(RELAY_KEYS)?.let {
    runCatching { json.decodeFromString(RelayKeys.serializer(), it.decodeToString()).pushKey }.getOrNull()
  }

  fun forgetRelayKeys(secrets: SecretStore) = secrets.delete(RELAY_KEYS)

  private fun randomKey(): String = ArgusBase64.encode(ByteArray(32).also(SecureRandom()::nextBytes))

  enum class RelayResult { Ok, Conflict, Failed }

  /** The relay must know the auth key before the desktop pushes, or it has nothing to verify the signature against. */
  suspend fun registerWithRelay(relayUrl: String, token: String, authKey: String): RelayResult = withContext(Dispatchers.IO) {
    val body = buildJsonObject {
      put("token", token)
      put("service", SERVICE)
      put("auth_key", authKey)
      put("ts", System.currentTimeMillis())
    }.toString()
    runCatching {
      val connection = URL("${relayUrl.trimEnd('/')}/register").openConnection() as HttpURLConnection
      connection.requestMethod = "POST"
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      connection.doOutput = true
      connection.setRequestProperty("content-type", "application/json")
      connection.outputStream.use { it.write(body.encodeToByteArray()) }
      val status = connection.responseCode
      connection.disconnect()
      when {
        status in 200..299 -> RelayResult.Ok
        // A previous install claimed this token; the relay expires registrations, so this resolves itself.
        status == 409 -> RelayResult.Conflict
        else -> RelayResult.Failed
      }
    }.getOrDefault(RelayResult.Failed)
  }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
  addOnCompleteListener { task ->
    if (task.isSuccessful) continuation.resume(task.result) else continuation.resumeWith(Result.failure(task.exception ?: IllegalStateException("task failed")))
  }
}
